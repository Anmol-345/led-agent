import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Address, Hex } from "viem";

import { createCreditReservationTypedData } from "../credits/ledger";
import type {
  AdvisorRuntimeEnvironment,
  AdvisorResearchConfig,
} from "./config";
import { parseAdvisorResearchConfig } from "./config";
import type { AdvisorCreditLedger } from "./credit";

/**
 * Test doubles for the advisor credit boundary. The adapter is exercised against the upstream
 * handoff contract only, so no credit database, vault, or provider is involved.
 */

export function advisorTestConfig(
  overrides: AdvisorRuntimeEnvironment = {},
): AdvisorResearchConfig {
  const directory = mkdtempSync(join(tmpdir(), "leg-advisor-credit-"));
  return parseAdvisorResearchConfig({
    ADVISOR_COMPLETION_TOKEN_ALLOWANCE: "1500",
    ADVISOR_FMP_MICRO_USDC: "2500",
    ADVISOR_FUNDAMENTALS_MAX_AGE_DAYS: "200",
    ADVISOR_LEG_SERVICE_MICRO_USDC: "5000",
    ADVISOR_MAX_PROMPT_TOKENS: "24000",
    ADVISOR_MAX_TOOL_RESULT_TOKENS: "6000",
    ADVISOR_PHILOSOPHY_VERSION: "v1",
    ADVISOR_PRICE_MAX_AGE_SECONDS: "900",
    ADVISOR_PRICE_VERSION: "advisor-2026-07",
    ADVISOR_QUOTE_TTL_SECONDS: "300",
    ADVISOR_ROUTER_API_KEY: "router-api-key",
    ADVISOR_ROUTER_BASE_URL: "https://router-api.0g.ai/v1",
    ADVISOR_ROUTER_MAX_COMPLETION_PRICE_MICRO_USDC_PER_MILLION: "9000",
    ADVISOR_ROUTER_MAX_PROMPT_PRICE_MICRO_USDC_PER_MILLION: "3000",
    ADVISOR_ROUTER_MODEL: "leg-pinned-model",
    CREDIT_DATABASE_PATH: join(directory, "leg.sqlite"),
    FMP_API_KEY: "fmp-api-key",
    FMP_BASE_URL: "https://financialmodelingprep.com/stable",
    FMP_COMMERCIAL_RIGHTS_REFERENCE: "order-form-2026-04-11",
    FMP_PRODUCTION_LICENSE_CONFIRMED: "true",
    ADVISOR_ROUTER_TIMEOUT_MS: "45000",
    ...overrides,
  });
}

export type RecordedLedgerCall =
  | { method: "prepareAuthorization"; input: Parameters<AdvisorCreditLedger["prepareAuthorization"]>[0] }
  | { method: "authorize"; input: Parameters<AdvisorCreditLedger["authorize"]>[0] }
  | { method: "finalize"; input: Parameters<AdvisorCreditLedger["finalize"]>[0] };

export class RecordingCreditLedger implements AdvisorCreditLedger {
  readonly calls: RecordedLedgerCall[] = [];

  constructor(
    private readonly options: {
      authorizationId?: string;
      failAuthorize?: Error;
      reservationId?: Hex;
    } = {},
  ) {}

  get authorizationId(): string {
    return this.options.authorizationId ?? "authorization-1";
  }

  async prepareAuthorization(
    input: Parameters<AdvisorCreditLedger["prepareAuthorization"]>[0],
  ): ReturnType<AdvisorCreditLedger["prepareAuthorization"]> {
    this.calls.push({ input, method: "prepareAuthorization" });
    return {
      authorizationId: this.authorizationId,
      chargePurpose: "leg-credit-v1;service=advisor",
      expiresAt: input.expiresAt,
      reservationId: this.reservationId,
      typedData: createCreditReservationTypedData({
        authorizationId: this.authorizationId,
        chainId: 8453,
        correlationId: input.correlationId,
        expiresAt: input.expiresAt,
        pricing: input.pricing,
        serviceType: input.serviceType,
        vaultAddress,
        wallet: input.wallet,
      }),
    };
  }

  async authorize(
    input: Parameters<AdvisorCreditLedger["authorize"]>[0],
  ): ReturnType<AdvisorCreditLedger["authorize"]> {
    this.calls.push({ input, method: "authorize" });
    if (this.options.failAuthorize) throw this.options.failAuthorize;
    return {
      authorizationId: input.authorizationId,
      expiresAt: new Date("2026-07-26T12:05:00.000Z"),
      reservationId: this.reservationId,
    };
  }

  async finalize(
    input: Parameters<AdvisorCreditLedger["finalize"]>[0],
  ): ReturnType<AdvisorCreditLedger["finalize"]> {
    this.calls.push({ input, method: "finalize" });
    if (input.components === null) return { status: "provisional" };
    const total = input.components["0g"] + input.components.fmp + input.components.legService;
    if (input.outcome === "failed") {
      return { status: total === 0n ? "released" : "failed" };
    }
    return { status: "settled" };
  }

  private get reservationId(): Hex {
    return this.options.reservationId ?? `0x${"ab".repeat(32)}`;
  }
}

export const vaultAddress: Address = "0x4444444444444444444444444444444444444444";
export const testWallet: Address = "0x1111111111111111111111111111111111111111";
export const otherWallet: Address = "0x2222222222222222222222222222222222222222";
