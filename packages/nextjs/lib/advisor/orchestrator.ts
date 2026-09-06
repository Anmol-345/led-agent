import { randomUUID } from "node:crypto";

import { getAddress, isAddress, type Address, type Hex } from "viem";

import type { VerifiedCreditAction } from "../credits/auth";
import type { PriceSnapshot } from "../credits/ledger";
import type { AdvisorResearchConfig } from "./config";
import {
  advisorContextHash,
  createAdvisorCreditQuote,
  isAdvisorCorrelationId,
  type AdvisorCreditAdapter,
} from "./credit";
import { formatAdvisorDecimal, parseAdvisorDecimal } from "./decimal";
import type { FmpFactField, FmpFactSet, FmpGateway } from "./fmp";
import { loadAdvisorPhilosophy } from "./philosophy";
import type {
  AdvisorAssetSelection,
  HoldingObservation,
  PortfolioReader,
} from "./portfolio";
import type { RouterAdapter, RouterMessage } from "./router";
import {
  ADVISOR_VALUATION_METHODS,
  evaluateValuation,
  type ValuationMethod,
  type ValuationResult,
} from "./valuation";

/**
 * The one server-side advisor research path shared by web chat, the connector, and checkups.
 *
 * Ordering is the safety property: the whole prepared context is priced, the customer's matching
 * credit action is authorized, and only then may FMP or the Router be called. A mismatched,
 * expired, or unavailable authorization performs zero provider work, and every attempt finalizes
 * its normalized usage exactly once. Nothing here mutates a credit balance directly.
 */

const CHARACTERS_PER_TOKEN = 3;
const MESSAGE_TOKEN_OVERHEAD = 8;

function researchSymbol(assetReference: string): string {
  return assetReference.replace(/\.d$|on$/i, "");
}

export type AdvisorRequestSource = "checkup" | "connector" | "web";

export type AdvisorRequest = {
  /** Chain the asset trades on. Omit to resolve it from the symbol. */
  chainId?: number;
  conversation: readonly RouterMessage[];
  correlationId: string;
  methods: readonly ValuationMethod[];
  selections: readonly AdvisorAssetSelection[];
  source: AdvisorRequestSource;
  symbol: string;
  wallet: Address;
};

export type AdvisorQuote = {
  completionTokenAllowance: number;
  contextHash: string;
  correlationId: string;
  expiresAt: Date;
  philosophyVersion: string;
  pricing: PriceSnapshot;
  promptTokenBudget: number;
  routerModel: string;
  serviceType: "advisor";
  source: AdvisorRequestSource;
  wallet: Address;
};

export type CitedFact = {
  field: FmpFactField;
  observedAt: Date;
  period: string | null;
  retrievedAt: Date;
  source: "fmp";
  symbol: string;
  value: string;
};

export type CitedCalculation = {
  calculationId: string;
  formulaVersion: string;
  inputs: readonly { field: FmpFactField; period: string | null; value: string }[];
  method: ValuationMethod;
  result: string | null;
  unavailableReason: string | null;
};

export type CitedResearch = {
  calculations: readonly CitedCalculation[];
  facts: readonly CitedFact[];
  holdings: readonly HoldingObservation[];
  interpretation: string;
  limitations: readonly string[];
  philosophyVersion: string;
  principles: readonly { id: string; investor: string; title: string }[];
};

import {
  createRecommendation,
  type RecommendationStance,
  type ValueInvestingRecommendation,
} from "./recommendation";
import { findEligibleAsset, getEligibleAssets } from "../trading/registry";
import { DEPLOYMENT } from "../deployment";

export type AdvisorFailureCode = "authorization" | "context" | "provider" | "source";

export type AdvisorRunResult =
  | {
      kind: "completed";
      recommendation: ValueInvestingRecommendation;
      response: CitedResearch;
      runId: string;
    }
  | {
      code: AdvisorFailureCode;
      correlationId: string;
      kind: "failed";
      retryable: boolean;
      runId: string;
    };

/** Redacted operational evidence only: no prompt, signature, provider key, or raw payload. */
export type AdvisorRunRecorder = {
  completeRun(input: {
    calculations: readonly CitedCalculation[];
    citations: readonly CitedFact[];
    completedAt: Date;
    correlationId: string;
    runId: string;
    usage: { completionTokens: number; promptTokens: number };
  }): Promise<void>;
  failRun(input: {
    code: AdvisorFailureCode;
    completedAt: Date;
    correlationId: string;
    runId: string;
  }): Promise<void>;
  recordQuote(input: { quote: AdvisorQuote }): Promise<void>;
  saveRecommendation?(recommendation: ValueInvestingRecommendation): Promise<void>;
  startRun(input: {
    correlationId: string;
    runId: string;
    source: AdvisorRequestSource;
    startedAt: Date;
    wallet: Address;
  }): Promise<void>;
};

/**
 * ponytail: a character heuristic, deliberately over-counting so a quote never under-prices the
 * context. Ceiling: it can reserve noticeably more credit than a real tokenizer would. Upgrade path
 * is the Router model's own tokenizer once its vocabulary is pinned.
 */
export function estimatePromptTokens(segments: readonly string[]): number {
  return segments.reduce(
    (total, segment) =>
      total + Math.ceil(segment.length / CHARACTERS_PER_TOKEN) + MESSAGE_TOKEN_OVERHEAD,
    0,
  );
}

function requiredFields(methods: readonly ValuationMethod[]): readonly FmpFactField[] {
  const fields = new Set<FmpFactField>();
  for (const method of methods) {
    const definition = ADVISOR_VALUATION_METHODS.find(entry => entry.method === method);
    if (!definition) throw new Error(`Advisor valuation method ${method} is not published.`);
    for (const field of definition.requiredInputs) fields.add(field);
  }
  return [...fields].sort();
}

function holdingDescriptor(selections: readonly AdvisorAssetSelection[]): string {
  return selections
    .map(selection => `${selection.chainId}:${selection.token.toLowerCase()}`)
    .sort()
    .join(",");
}

function conversationDescriptor(conversation: readonly RouterMessage[]): string {
  return conversation.map(message => `${message.role}:${message.content}`).join("\n");
}

/**
 * Resolve the requested symbol to a registry asset. Uses the caller's chain when given,
 * otherwise searches every enabled asset — symbols are unique across the registry
 * (NVDA is Robinhood Chain, NVDAon is Ethereum).
 */
function resolveRequestedAsset(request: AdvisorRequest) {
  if (request.chainId !== undefined) {
    const onChain = findEligibleAsset(request.symbol, request.chainId);
    if (onChain) return onChain;
  }
  const wanted = request.symbol.trim().toUpperCase();
  return getEligibleAssets().find(
    asset =>
      asset.symbol.toUpperCase() === wanted ||
      asset.assetReference.toUpperCase() === wanted,
  );
}

/**
 * Decide the stance by actually comparing a valuation against the market price.
 *
 * Previously any non-null calculation produced "undervalued", so every analysable stock
 * looked like a buy — including ones whose own valuation said the opposite.
 *
 * `margin-of-safety` is (intrinsic - price) / intrinsic, so its sign is the comparison:
 * positive means the intrinsic value exceeds the price. When it is unavailable we fall
 * back to comparing the Graham number against the sourced price directly. A calculation
 * that is not price-comparable on its own (owner earnings) is never enough to claim
 * undervaluation.
 */
function resolveStance(
  calculations: readonly CitedCalculation[],
  facts: FmpFactSet,
): RecommendationStance {
  const resultFor = (method: ValuationMethod): bigint | null => {
    const entry = calculations.find(c => c.method === method && c.result !== null);
    return entry?.result ? parseAdvisorDecimal(entry.result) : null;
  };

  const marginOfSafety = resultFor("margin-of-safety");
  if (marginOfSafety !== null) {
    if (marginOfSafety > 0n) return "undervalued";
    if (marginOfSafety < 0n) return "overvalued";
    return "fairly-valued";
  }

  const priceFact = facts.price;
  const intrinsic = resultFor("graham-number");
  if (intrinsic !== null && priceFact.kind === "available") {
    const price = priceFact.fact.value;
    if (price > 0n) {
      if (intrinsic > price) return "undervalued";
      if (intrinsic < price) return "overvalued";
      return "fairly-valued";
    }
  }

  // Something was computed, but nothing that can be compared to a price.
  if (calculations.some(c => c.result !== null)) return "research-only";
  if (calculations.some(c => c.unavailableReason !== null)) return "insufficient-basis";
  return "research-only";
}

export class AdvisorOrchestrator {
  private readonly config: AdvisorResearchConfig;
  private readonly credit: AdvisorCreditAdapter;
  private readonly fmp: FmpGateway;
  private readonly now: () => Date;
  private readonly portfolio: PortfolioReader;
  private readonly recorder: AdvisorRunRecorder;
  private readonly router: RouterAdapter;

  constructor(options: {
    config: AdvisorResearchConfig;
    credit: AdvisorCreditAdapter;
    fmp: FmpGateway;
    now?: () => Date;
    portfolio: PortfolioReader;
    recorder: AdvisorRunRecorder;
    router: RouterAdapter;
  }) {
    this.config = options.config;
    this.credit = options.credit;
    this.fmp = options.fmp;
    this.now = options.now ?? (() => new Date());
    this.portfolio = options.portfolio;
    this.recorder = options.recorder;
    this.router = options.router;
  }

  async quote(request: AdvisorRequest): Promise<AdvisorQuote> {
    const prepared = this.prepareContext(request);
    const quote = createAdvisorCreditQuote(this.config, {
      completionTokens: this.config.pricing.completionTokenAllowance,
      contextHash: prepared.contextHash,
      correlationId: request.correlationId,
      now: this.now(),
      promptTokens: prepared.promptTokenBudget,
      wallet: request.wallet,
    });

    const advisorQuote: AdvisorQuote = {
      completionTokenAllowance: this.config.pricing.completionTokenAllowance,
      contextHash: quote.contextHash,
      correlationId: quote.correlationId,
      expiresAt: quote.expiresAt,
      philosophyVersion: this.config.philosophyVersion,
      pricing: quote.pricing,
      promptTokenBudget: prepared.promptTokenBudget,
      routerModel: this.config.router.model,
      serviceType: "advisor",
      source: request.source,
      wallet: quote.wallet,
    };
    await this.recorder.recordQuote({ quote: advisorQuote });
    return advisorQuote;
  }

  async prepareAuthorization(input: { quote: AdvisorQuote }) {
    return this.credit.prepareAuthorization({
      quote: {
        contextHash: input.quote.contextHash,
        correlationId: input.quote.correlationId,
        expiresAt: input.quote.expiresAt,
        pricing: input.quote.pricing,
        serviceType: "advisor",
        wallet: input.quote.wallet,
      },
    });
  }

  async run(input: {
    action: VerifiedCreditAction;
    /** Omit to charge against the customer's standing session grant. */
    customerSignature?: Hex;
    quote: AdvisorQuote;
    request: AdvisorRequest;
  }): Promise<AdvisorRunResult> {
    const runId = randomUUID();
    const startedAt = this.now();
    const { correlationId } = input.quote;

    const failed = async (
      code: AdvisorFailureCode,
      retryable: boolean,
    ): Promise<AdvisorRunResult> => {
      await this.recorder.failRun({ code, completedAt: this.now(), correlationId, runId });
      return { code, correlationId, kind: "failed", retryable, runId };
    };

    // Every attempt, including one rejected before any provider call, leaves redacted evidence.
    await this.recorder.startRun({
      correlationId,
      runId,
      source: input.request.source,
      startedAt,
      wallet: input.quote.wallet,
    });

    // 1. The request must still be exactly what was priced; nothing is truncated after pricing.
    const prepared = this.prepareContext(input.request);
    if (
      prepared.contextHash !== input.quote.contextHash ||
      input.request.correlationId !== correlationId ||
      getAddress(input.request.wallet) !== input.quote.wallet
    ) {
      return failed("context", false);
    }

    // 2. Authorization strictly precedes any paid provider call.
    const authorization = await this.credit.authorize({
      action: input.action,
      customerSignature: input.customerSignature,
      now: startedAt,
      quote: {
        contextHash: input.quote.contextHash,
        correlationId,
        expiresAt: input.quote.expiresAt,
        pricing: input.quote.pricing,
        serviceType: "advisor",
        wallet: input.quote.wallet,
      },
    });
    if (authorization.kind === "declined") {
      return failed("authorization", authorization.code === "unavailable");
    }

    const finalizeAndFail = async (
      code: AdvisorFailureCode,
      retryable: boolean,
      options: { fmpRequested: boolean; usage: { completionTokens: number; promptTokens: number } | null },
    ): Promise<AdvisorRunResult> => {
      await this.credit.finalize({
        authorizationId: authorization.authorizationId,
        fmpRequested: options.fmpRequested,
        outcome: "failed",
        providerReference: options.usage === null ? null : `run:${runId}`,
        usage: options.usage,
      });
      return failed(code, retryable);
    };

    // 3. Sourced facts and read-only holdings.
    const fields = requiredFields(input.request.methods);
    const eligibleAsset = resolveRequestedAsset(input.request);
    const facts = await this.fmp.facts({
      fields,
      symbol: eligibleAsset?.researchSymbol ?? researchSymbol(input.request.symbol),
    });
    const fmpReachable = fields.some(field => facts[field].kind === "available");
    if (!fmpReachable) {
      return finalizeAndFail("source", true, { fmpRequested: false, usage: null });
    }

    const holdings = await this.portfolio.read({
      selections: input.request.selections,
      wallet: input.quote.wallet,
    });

    // 4. Deterministic calculations, then the bounded tool-result rendering.
    const calculations = input.request.methods.map(method =>
      this.citedCalculation(method, evaluateValuation(method, { facts })),
    );
    const citations = this.citedFacts(fields, facts);
    const toolResults = this.renderToolResults(citations, calculations, holdings);
    if (estimatePromptTokens([toolResults]) > this.config.pricing.maxToolResultTokens) {
      return finalizeAndFail("context", false, { fmpRequested: true, usage: null });
    }

    // 5. Exactly one capped Router call.
    const philosophy = loadAdvisorPhilosophy(input.quote.philosophyVersion);
    const completion = await this.router.complete({
      completionTokenAllowance: input.quote.completionTokenAllowance,
      messages: [
        { content: prepared.systemPrompt, role: "system" },
        { content: toolResults, role: "system" },
        ...input.request.conversation,
      ],
    });
    if (completion.kind === "failed") {
      return finalizeAndFail("provider", completion.retryable, {
        fmpRequested: true,
        usage: { completionTokens: 0, promptTokens: 0 },
      });
    }

    // 6. Finalize the measured usage exactly once.
    await this.credit.finalize({
      authorizationId: authorization.authorizationId,
      fmpRequested: true,
      outcome: "succeeded",
      providerReference: `run:${runId}`,
      usage: completion.usage,
    });

    const completedAt = this.now();
    await this.recorder.completeRun({
      calculations,
      citations,
      completedAt,
      correlationId,
      runId,
      usage: completion.usage,
    });

    const researchResponse: CitedResearch = {
      calculations,
      facts: citations,
      holdings,
      interpretation: completion.content,
      limitations: [
        ...philosophy.limitations,
        ...this.sourceLimitations(fields, facts),
        ...calculations
          .filter(entry => entry.unavailableReason !== null)
          .map(entry => `${entry.method} is unavailable: ${entry.unavailableReason}.`),
      ],
      philosophyVersion: philosophy.version,
      principles: philosophy.principles.map(principle => ({
        id: principle.id,
        investor: principle.investor,
        title: principle.title,
      })),
    };

    // A recommendation is the immutable binding between the research and the asset that
    // may be traded on it. If the symbol resolves to no registry entry we must not invent
    // one: pinning an unrelated address here previously meant asking about a Robinhood or
    // Ethereum asset persisted a recommendation for a Base token. The zero address cannot
    // pass the trade guard, so such a run stays research-only by construction.
    const assetAddress = eligibleAsset
      ? getAddress(eligibleAsset.token)
      : "0x0000000000000000000000000000000000000000";
    // A chain is still required for a well-formed recommendation; the zero address above
    // is what makes an unresolved asset untradeable, since the trade guard only accepts
    // registry entries.
    const assetChainId =
      eligibleAsset?.chainId ?? input.request.chainId ?? DEPLOYMENT.quoteChainIds[0];

    const stance = eligibleAsset
      ? resolveStance(calculations, facts)
      : "research-only";

    const recommendation = createRecommendation({
      asset: {
        address: assetAddress,
        chainId: assetChainId,
        symbol: input.request.symbol,
      },
      generatedAt: completedAt,
      research: researchResponse,
      risks: "Market volatility, model valuation assumptions, tokenized asset liquidity, and regulatory considerations.",
      runId,
      stance,
      thesis: completion.content,
      ttlSeconds: 86400,
      wallet: input.quote.wallet,
    });

    if (this.recorder.saveRecommendation) {
      await this.recorder.saveRecommendation(recommendation);
    }

    return {
      kind: "completed",
      recommendation,
      response: researchResponse,
      runId,
    };
  }

  private prepareContext(request: AdvisorRequest): {
    contextHash: string;
    promptTokenBudget: number;
    systemPrompt: string;
  } {
    if (!isAddress(request.wallet)) {
      throw new Error("Advisor request wallet is invalid.");
    }
    if (!isAdvisorCorrelationId(request.correlationId)) {
      throw new Error("Advisor correlation identifier is invalid.");
    }
    if (request.methods.length === 0) {
      throw new Error("An advisor request must select at least one valuation method.");
    }

    const philosophy = loadAdvisorPhilosophy(this.config.philosophyVersion);
    const systemPrompt = [
      `Leg value-investing philosophy ${philosophy.version}.`,
      ...philosophy.principles.map(
        principle => `${principle.id} (${principle.investor}) — ${principle.title}: ${principle.summary}`,
      ),
      "Research boundaries:",
      ...philosophy.limitations.map(limitation => `- ${limitation}`),
      "Distinguish sourced facts, deterministic calculations, and your own interpretation.",
      "Never invent a value, citation, or conclusion; state the limitation instead.",
    ].join("\n");

    const conversation = conversationDescriptor(request.conversation);
    const holdings = holdingDescriptor(request.selections);

    // The priced budget covers the system prompt, the conversation, the selected-holding slots, and
    // the full tool-result capacity a run is allowed to send back.
    const promptTokenBudget =
      estimatePromptTokens([systemPrompt, conversation, holdings]) +
      this.config.pricing.maxToolResultTokens;
    if (promptTokenBudget > this.config.pricing.maxPromptTokens) {
      throw new Error(
        "Advisor request exceeds the configured prompt budget; start a shorter conversation.",
      );
    }

    return {
      contextHash: advisorContextHash({
        completionTokenAllowance: this.config.pricing.completionTokenAllowance,
        philosophyVersion: philosophy.version,
        priceVersion: this.config.pricing.version,
        promptTokens: promptTokenBudget,
        routerModel: this.config.router.model,
        segments: [conversation, holdings, request.symbol, request.methods.join(",")],
      }),
      promptTokenBudget,
      systemPrompt,
    };
  }

  private citedFacts(
    fields: readonly FmpFactField[],
    facts: FmpFactSet,
  ): readonly CitedFact[] {
    const cited: CitedFact[] = [];
    for (const field of fields) {
      const result = facts[field];
      if (result.kind !== "available") continue;
      cited.push({
        field,
        observedAt: result.fact.observedAt,
        period: result.fact.period,
        retrievedAt: result.fact.retrievedAt,
        source: result.fact.source,
        symbol: result.fact.symbol,
        value: formatAdvisorDecimal(result.fact.value),
      });
    }
    return cited;
  }

  private sourceLimitations(
    fields: readonly FmpFactField[],
    facts: FmpFactSet,
  ): readonly string[] {
    return fields
      .map(field => facts[field])
      .filter(result => result.kind === "unavailable")
      .map(result =>
        result.kind === "unavailable"
          ? `${result.field} is unavailable for ${result.symbol}: ${result.reason}.`
          : "",
      );
  }

  private citedCalculation(method: ValuationMethod, result: ValuationResult): CitedCalculation {
    if (result.kind === "available") {
      return {
        calculationId: randomUUID(),
        formulaVersion: result.formulaVersion,
        inputs: result.inputs.map(input => ({
          field: input.field,
          period: input.period,
          value: formatAdvisorDecimal(input.value),
        })),
        method,
        result: formatAdvisorDecimal(result.value),
        unavailableReason: null,
      };
    }
    return {
      calculationId: randomUUID(),
      formulaVersion: result.formulaVersion,
      inputs: [],
      method,
      result: null,
      unavailableReason: `${result.reason}:${result.unmetInputs.join(",")}`,
    };
  }

  private renderToolResults(
    facts: readonly CitedFact[],
    calculations: readonly CitedCalculation[],
    holdings: readonly HoldingObservation[],
  ): string {
    return [
      "Sourced facts:",
      ...facts.map(
        fact =>
          `- ${fact.field}=${fact.value} (${fact.symbol}, ${fact.period ?? "market observation"}, source ${fact.source}, retrieved ${fact.retrievedAt.toISOString()})`,
      ),
      "Deterministic calculations:",
      ...calculations.map(calculation =>
        calculation.result === null
          ? `- ${calculation.method} (${calculation.formulaVersion}) unavailable: ${calculation.unavailableReason}`
          : `- ${calculation.method} (${calculation.formulaVersion}) = ${calculation.result}`,
      ),
      "Selected on-chain holdings (balance observations only, not prices or trading availability):",
      ...holdings.map(holding =>
        holding.kind === "observed"
          ? `- chain ${holding.chainId} token ${holding.token} amount ${holding.amount} decimals ${holding.decimals} research ${holding.research?.symbol ?? "unvalued"} read ${holding.readAt.toISOString()}`
          : `- chain ${holding.chainId} token ${holding.token} unavailable: ${holding.reason}`,
      ),
    ].join("\n");
  }
}
