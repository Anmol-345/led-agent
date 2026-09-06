import { randomUUID } from "node:crypto";

import { getAddress, isAddress, type Address } from "viem";

import type { CitedCalculation, CitedFact, CitedResearch } from "./orchestrator";

/**
 * The `ValueInvestingRecommendation.v1` handoff.
 *
 * A recommendation may only be created from a completed research run that owns its wallet and
 * citations. It carries evidence and risk, and it deliberately establishes nothing about issuer
 * eligibility, a route, a price, or permission to trade. Downstream trading validates the exact
 * artifact and adds its own eligibility and confirmation controls.
 */

export const RECOMMENDATION_VERSION = "ValueInvestingRecommendation.v1";

export const RECOMMENDATION_DISCLAIMER =
  "Educational research only. This recommendation establishes no issuer eligibility, route, price " +
  "guarantee, or permission to trade, and is not a suitability determination.";

export type RecommendationStance =
  | "fairly-valued"
  | "insufficient-basis"
  | "overvalued"
  | "research-only"
  | "undervalued";

const stances: readonly RecommendationStance[] = [
  "fairly-valued",
  "insufficient-basis",
  "overvalued",
  "research-only",
  "undervalued",
];

export type RecommendationEvidence = {
  field: string;
  observedAt: string;
  period: string | null;
  retrievedAt: string;
  source: "fmp";
  symbol: string;
  value: string;
};

export type RecommendationCalculationReference = {
  calculationId: string;
  formulaVersion: string;
  method: string;
  result: string | null;
};

export type ValueInvestingRecommendation = {
  assetChainId: number;
  assetAddress: Address;
  assetSymbol: string | null;
  calculations: readonly RecommendationCalculationReference[];
  disclaimer: string;
  evidence: readonly RecommendationEvidence[];
  expiresAt: Date;
  generatedAt: Date;
  id: string;
  philosophyVersion: string;
  risks: string;
  runId: string;
  stance: RecommendationStance;
  thesis: string;
  version: typeof RECOMMENDATION_VERSION;
  wallet: Address;
};

export type RecommendationRejection =
  | "expired"
  | "malformed"
  | "unsupported-version"
  | "wrong-wallet";

export type RecommendationHandoff =
  | { kind: "rejected"; reason: RecommendationRejection }
  | { kind: "usable"; recommendation: ValueInvestingRecommendation };

function isStance(value: string): value is RecommendationStance {
  return stances.some(stance => stance === value);
}

function evidenceFrom(facts: readonly CitedFact[]): readonly RecommendationEvidence[] {
  return facts.map(fact => ({
    field: fact.field,
    observedAt: fact.observedAt.toISOString(),
    period: fact.period,
    retrievedAt: fact.retrievedAt.toISOString(),
    source: fact.source,
    symbol: fact.symbol,
    value: fact.value,
  }));
}

function calculationsFrom(
  calculations: readonly CitedCalculation[],
): readonly RecommendationCalculationReference[] {
  return calculations.map(calculation => ({
    calculationId: calculation.calculationId,
    formulaVersion: calculation.formulaVersion,
    method: calculation.method,
    result: calculation.result,
  }));
}

/** Builds the artifact from a completed run only. Free-form chat text can never stand in for it. */
export function createRecommendation(input: {
  asset: { address: string; chainId: number; symbol: string | null };
  generatedAt: Date;
  research: CitedResearch;
  risks: string;
  runId: string;
  stance: RecommendationStance;
  thesis: string;
  ttlSeconds: number;
  wallet: string;
}): ValueInvestingRecommendation {
  if (!isAddress(input.wallet)) throw new Error("Recommendation wallet is invalid.");
  if (!isAddress(input.asset.address)) throw new Error("Recommendation asset address is invalid.");
  if (!Number.isSafeInteger(input.asset.chainId) || input.asset.chainId <= 0) {
    throw new Error("Recommendation asset chain is invalid.");
  }
  if (input.thesis.trim().length === 0) throw new Error("Recommendation thesis is required.");
  if (input.risks.trim().length === 0) throw new Error("Recommendation risks are required.");
  if (!Number.isSafeInteger(input.ttlSeconds) || input.ttlSeconds <= 0) {
    throw new Error("Recommendation expiry is invalid.");
  }
  if (input.research.facts.length === 0 && input.research.calculations.length === 0) {
    throw new Error("A recommendation requires cited evidence from its research run.");
  }

  return {
    assetAddress: getAddress(input.asset.address),
    assetChainId: input.asset.chainId,
    assetSymbol: input.asset.symbol,
    calculations: calculationsFrom(input.research.calculations),
    disclaimer: RECOMMENDATION_DISCLAIMER,
    evidence: evidenceFrom(input.research.facts),
    expiresAt: new Date(input.generatedAt.getTime() + input.ttlSeconds * 1_000),
    generatedAt: input.generatedAt,
    id: randomUUID(),
    philosophyVersion: input.research.philosophyVersion,
    risks: input.risks,
    runId: input.runId,
    stance: input.stance,
    thesis: input.thesis,
    version: RECOMMENDATION_VERSION,
    wallet: getAddress(input.wallet),
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isUsableDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isAddressValue(value: unknown): value is Address {
  return typeof value === "string" && isAddress(value);
}

/**
 * A recommendation reaches this function from persistence or a connector, so it is validated as
 * untrusted input rather than trusted because a compile-time type once said so.
 */
function isRecommendationShape(value: unknown): value is ValueInvestingRecommendation {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyText(value.id) &&
    isNonEmptyText(value.runId) &&
    isNonEmptyText(value.thesis) &&
    isNonEmptyText(value.risks) &&
    isNonEmptyText(value.philosophyVersion) &&
    isAddressValue(value.wallet) &&
    isAddressValue(value.assetAddress) &&
    typeof value.assetChainId === "number" &&
    Number.isSafeInteger(value.assetChainId) &&
    value.assetChainId > 0 &&
    (value.assetSymbol === null || typeof value.assetSymbol === "string") &&
    typeof value.stance === "string" &&
    isStance(value.stance) &&
    value.disclaimer === RECOMMENDATION_DISCLAIMER &&
    isUsableDate(value.generatedAt) &&
    isUsableDate(value.expiresAt) &&
    value.expiresAt.getTime() > value.generatedAt.getTime() &&
    Array.isArray(value.evidence) &&
    Array.isArray(value.calculations) &&
    value.evidence.length + value.calculations.length > 0
  );
}

/**
 * Validates shape, version, wallet association, and expiry before the exact artifact is handed off.
 * It constructs, signs, routes, prices, and confirms nothing.
 */
export function validateRecommendationHandoff(input: {
  now: Date;
  recommendation: unknown;
  wallet: string;
}): RecommendationHandoff {
  const candidate = input.recommendation;

  if (!isRecord(candidate) || typeof candidate.version !== "string") {
    return { kind: "rejected", reason: "malformed" };
  }
  if (candidate.version !== RECOMMENDATION_VERSION) {
    return { kind: "rejected", reason: "unsupported-version" };
  }
  if (!isRecommendationShape(candidate)) {
    return { kind: "rejected", reason: "malformed" };
  }
  if (!isAddress(input.wallet) || getAddress(input.wallet) !== getAddress(candidate.wallet)) {
    return { kind: "rejected", reason: "wrong-wallet" };
  }
  if (candidate.expiresAt.getTime() <= input.now.getTime()) {
    return { kind: "rejected", reason: "expired" };
  }

  return { kind: "usable", recommendation: candidate };
}
