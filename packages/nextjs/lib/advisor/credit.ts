import { createHash, randomUUID } from "node:crypto";

import { getAddress, isAddress, isHex, size, type Address, type Hex } from "viem";

import { isCreditRequestId, type VerifiedCreditAction } from "../credits/auth";
import type {
  CreditComponent,
  CreditLedgerService,
  MicroUsdc,
  PriceSnapshot,
  ServiceType,
} from "../credits/ledger";
import type { AdvisorResearchConfig } from "./config";

/**
 * The advisor's only seam to Customer Credits.
 *
 * It imports the upstream verified-action and ledger handoff contracts and nothing else: no credit
 * database, vault, credential, or provider implementation detail. Every micro-USDC amount is
 * derived here from the immutable configured rate snapshot and measured provider usage, so no
 * caller — public or internal — can submit a provider amount or move a credit balance.
 */

export const ADVISOR_SERVICE_TYPE: ServiceType = "advisor";

const MICRO_USDC_PER_MILLION_TOKENS = 1_000_000n;
const CONTEXT_HASH_PATTERN = /^[0-9a-f]{64}$/;
const CORRELATION_PREFIX = "advisor-";
const CORRELATION_UUID_PATTERN =
  /^advisor-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type AdvisorCreditComponents = Readonly<Record<CreditComponent, MicroUsdc>>;

/** Only the upstream handoff methods the advisor is allowed to reach. */
export type AdvisorCreditLedger = Pick<
  CreditLedgerService,
  "authorize" | "finalize" | "prepareAuthorization"
>;

export type AdvisorCreditQuote = {
  contextHash: string;
  correlationId: string;
  expiresAt: Date;
  pricing: PriceSnapshot;
  serviceType: ServiceType;
  wallet: Address;
};

export type AdvisorContextInput = {
  completionTokenAllowance: number;
  philosophyVersion: string;
  priceVersion: string;
  promptTokens: number;
  routerModel: string;
  segments: readonly string[];
};

export type AdvisorProviderUsage = {
  completionTokens: number;
  promptTokens: number;
};

export type AdvisorOutcome = "failed" | "succeeded";

export type AdvisorAuthorizationCode =
  | "action-expired"
  | "correlation"
  | "quote-expired"
  | "unavailable"
  | "wallet";

export type AdvisorActionCheck =
  | { kind: "usable" }
  | { code: AdvisorAuthorizationCode; kind: "declined" };

export type AdvisorAuthorizationResult =
  | { authorizationId: string; expiresAt: Date; kind: "authorized"; reservationId: Hex }
  | { code: AdvisorAuthorizationCode; kind: "declined" };

function tokenCount(value: number, label: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a whole, non-negative token count.`);
  }
  return BigInt(value);
}

function ceilingDivision(value: bigint, divisor: bigint): bigint {
  return (value + divisor - 1n) / divisor;
}

function zeroGMicroUsdc(
  config: AdvisorResearchConfig,
  usage: AdvisorProviderUsage,
): MicroUsdc {
  return (
    ceilingDivision(
      tokenCount(usage.promptTokens, "Prompt") *
        config.router.maxPromptPriceMicroUsdcPerMillionTokens,
      MICRO_USDC_PER_MILLION_TOKENS,
    ) +
    ceilingDivision(
      tokenCount(usage.completionTokens, "Completion") *
        config.router.maxCompletionPriceMicroUsdcPerMillionTokens,
      MICRO_USDC_PER_MILLION_TOKENS,
    )
  );
}

export function createAdvisorCorrelationId(): string {
  return `${CORRELATION_PREFIX}${randomUUID()}`;
}

export function isAdvisorCorrelationId(value: string): boolean {
  return CORRELATION_UUID_PATTERN.test(value) && isCreditRequestId(value);
}

/**
 * Binds the priced request: the model, philosophy, price version, token budgets, and the ordered
 * digests of every context segment the run may send. Only digests are hashed here, so no prompt
 * text crosses this boundary.
 */
export function advisorContextHash(input: AdvisorContextInput): string {
  const canonical = JSON.stringify({
    completionTokenAllowance: tokenCount(
      input.completionTokenAllowance,
      "Completion allowance",
    ).toString(),
    philosophyVersion: input.philosophyVersion,
    priceVersion: input.priceVersion,
    promptTokens: tokenCount(input.promptTokens, "Prompt").toString(),
    routerModel: input.routerModel,
    segments: [...input.segments],
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function advisorQuotePricing(
  config: AdvisorResearchConfig,
  usage: AdvisorProviderUsage,
): PriceSnapshot {
  const components: AdvisorCreditComponents = {
    "0g": zeroGMicroUsdc(config, usage),
    fmp: config.pricing.fmpMicroUsdc,
    legService: config.pricing.legServiceMicroUsdc,
  };
  const maximumCharge = components["0g"] + components.fmp + components.legService;
  if (maximumCharge <= 0n) {
    throw new Error("Advisor pricing must disclose a positive maximum charge.");
  }
  return { components, maximumCharge, version: config.pricing.version };
}

export function createAdvisorCreditQuote(
  config: AdvisorResearchConfig,
  input: {
    completionTokens: number;
    contextHash: string;
    correlationId: string;
    now: Date;
    promptTokens: number;
    wallet: Address;
  },
): AdvisorCreditQuote {
  if (!isAdvisorCorrelationId(input.correlationId)) {
    throw new Error("Advisor correlation identifier is invalid.");
  }
  if (!CONTEXT_HASH_PATTERN.test(input.contextHash)) {
    throw new Error("Advisor context hash is invalid.");
  }
  if (!isAddress(input.wallet)) {
    throw new Error("Advisor wallet is invalid.");
  }
  // The whole prepared context is priced before authorization; nothing may be truncated afterwards.
  if (tokenCount(input.promptTokens, "Prompt") > BigInt(config.pricing.maxPromptTokens)) {
    throw new Error("Advisor prompt context exceeds the configured prompt budget.");
  }
  if (
    tokenCount(input.completionTokens, "Completion") >
    BigInt(config.pricing.completionTokenAllowance)
  ) {
    throw new Error("Advisor completion request exceeds the configured completion allowance.");
  }

  return {
    contextHash: input.contextHash,
    correlationId: input.correlationId,
    expiresAt: new Date(input.now.getTime() + config.pricing.quoteTtlSeconds * 1_000),
    pricing: advisorQuotePricing(config, {
      completionTokens: input.completionTokens,
      promptTokens: input.promptTokens,
    }),
    serviceType: ADVISOR_SERVICE_TYPE,
    wallet: getAddress(input.wallet),
  };
}

export function advisorUsageComponents(
  config: AdvisorResearchConfig,
  input: {
    fmpRequested: boolean;
    outcome: AdvisorOutcome;
    usage: AdvisorProviderUsage | null;
  },
): AdvisorCreditComponents {
  if (input.usage === null) {
    if (input.fmpRequested) {
      throw new Error("Requested FMP work must report its incurred usage.");
    }
    return { "0g": 0n, fmp: 0n, legService: 0n };
  }
  return {
    "0g": zeroGMicroUsdc(config, input.usage),
    fmp: input.fmpRequested ? config.pricing.fmpMicroUsdc : 0n,
    // Leg charges its own service only for work that completed.
    legService: input.outcome === "succeeded" ? config.pricing.legServiceMicroUsdc : 0n,
  };
}

export function checkAdvisorAction(input: {
  action: VerifiedCreditAction;
  now: Date;
  quote: AdvisorCreditQuote;
}): AdvisorActionCheck {
  if (
    !isAddress(input.action.wallet) ||
    getAddress(input.action.wallet) !== input.quote.wallet
  ) {
    return { code: "wallet", kind: "declined" };
  }
  if (input.action.requestId !== input.quote.correlationId) {
    return { code: "correlation", kind: "declined" };
  }
  if (input.action.expiresAt.getTime() <= input.now.getTime()) {
    return { code: "action-expired", kind: "declined" };
  }
  if (input.quote.expiresAt.getTime() <= input.now.getTime()) {
    return { code: "quote-expired", kind: "declined" };
  }
  return { kind: "usable" };
}

export class AdvisorCreditAdapter {
  private readonly config: AdvisorResearchConfig;
  private readonly ledger: AdvisorCreditLedger;

  constructor(options: { config: AdvisorResearchConfig; ledger: AdvisorCreditLedger }) {
    this.config = options.config;
    this.ledger = options.ledger;
  }

  async prepareAuthorization(input: {
    quote: AdvisorCreditQuote;
  }) {
    return this.ledger.prepareAuthorization({
      correlationId: input.quote.correlationId,
      expiresAt: input.quote.expiresAt,
      pricing: input.quote.pricing,
      serviceType: ADVISOR_SERVICE_TYPE,
      wallet: input.quote.wallet,
    });
  }

  /**
   * Reserves the disclosed maximum for one advisor correlation. A mismatched, expired, or
   * unavailable authorization returns a declined state and performs no paid provider work.
   */
  async authorize(input: {
    action: VerifiedCreditAction;
    /**
     * Per-run signature. Omit (or pass "0x") to draw on the customer's standing session
     * grant instead — without this the grant path is unreachable from the advisor and
     * every inference still prompts the wallet.
     */
    customerSignature?: Hex;
    now: Date;
    quote: AdvisorCreditQuote;
  }): Promise<AdvisorAuthorizationResult> {
    const check = checkAdvisorAction(input);
    if (check.kind === "declined") return check;
    const viaSessionGrant =
      input.customerSignature === undefined || input.customerSignature === "0x";
    if (
      !viaSessionGrant &&
      (!isHex(input.customerSignature) || size(input.customerSignature) === 0)
    ) {
      throw new Error("Advisor reservation signature is invalid.");
    }

    try {
      const prepared = await this.ledger.prepareAuthorization({
        correlationId: input.quote.correlationId,
        expiresAt: input.quote.expiresAt,
        pricing: input.quote.pricing,
        serviceType: ADVISOR_SERVICE_TYPE,
        wallet: input.quote.wallet,
      });
      const reserved = await this.ledger.authorize({
        authorizationId: prepared.authorizationId,
        customerSignature: input.customerSignature,
      });
      return {
        authorizationId: reserved.authorizationId,
        expiresAt: reserved.expiresAt,
        kind: "authorized",
        reservationId: reserved.reservationId,
      };
    } catch {
      // Fail closed: the caller sees an actionable credit state and starts no provider work.
      return { code: "unavailable", kind: "declined" };
    }
  }

  /** Reports the one normalized three-component outcome for an authorized advisor attempt. */
  async finalize(input: {
    authorizationId: string;
    fmpRequested: boolean;
    outcome: AdvisorOutcome;
    providerReference: string | null;
    usage: AdvisorProviderUsage | null;
  }): Promise<{ status: string }> {
    const components = advisorUsageComponents(this.config, {
      fmpRequested: input.fmpRequested,
      outcome: input.outcome,
      usage: input.usage,
    });
    const total = components["0g"] + components.fmp + components.legService;
    if (total === 0n && input.providerReference !== null) {
      throw new Error("Zero advisor usage cannot carry a provider reference.");
    }
    if (total > 0n && input.providerReference === null) {
      throw new Error("Chargeable advisor usage must carry a provider reference.");
    }

    return this.ledger.finalize({
      authorizationId: input.authorizationId,
      components,
      outcome: input.outcome,
      providerReference: input.providerReference,
    });
  }
}
