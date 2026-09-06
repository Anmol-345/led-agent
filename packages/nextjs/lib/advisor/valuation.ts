import {
  divideDecimal,
  multiplyDecimal,
  parseAdvisorDecimal,
  squareRootDecimal,
} from "./decimal";
import type { FmpFactField, FmpFactSet } from "./fmp";

/**
 * Pure, versioned value-investing calculations.
 *
 * Each method declares the normalized inputs it requires and its preconditions. A missing, stale,
 * ambiguous, non-positive, or otherwise unusable input produces a named unavailable result; a
 * substitute value is never invented. Identical inputs and formula version always yield an
 * identical result because all arithmetic is fixed-point (see `decimal.ts`).
 */

export type ValuationMethod =
  | "graham-number"
  | "greenblatt-earnings-yield"
  | "margin-of-safety"
  | "owner-earnings"
  | "return-on-capital";

export type ValuationUnavailableReason =
  | "missing-input"
  | "non-positive-input"
  | "undefined-result";

export type ValuationInputReference = {
  field: FmpFactField;
  observedAt: Date;
  period: string | null;
  source: "fmp";
  symbol: string;
  value: bigint;
};

export type ValuationResult =
  | {
      formulaVersion: string;
      inputs: readonly ValuationInputReference[];
      kind: "available";
      method: ValuationMethod;
      value: bigint;
    }
  | {
      formulaVersion: string;
      kind: "unavailable";
      method: ValuationMethod;
      reason: ValuationUnavailableReason;
      unmetInputs: readonly FmpFactField[];
    };

type ValuationDefinition = {
  formulaVersion: string;
  method: ValuationMethod;
  /** Inputs that must be positive; every other required input may be any finite value. */
  positiveInputs: readonly FmpFactField[];
  requiredInputs: readonly FmpFactField[];
  compute: (inputs: Readonly<Record<FmpFactField, bigint>>) => bigint | null;
};

const GRAHAM_MULTIPLIER = parseAdvisorDecimal("22.5") ?? 0n;

function grahamNumber(inputs: Readonly<Record<FmpFactField, bigint>>): bigint | null {
  return squareRootDecimal(
    multiplyDecimal(
      multiplyDecimal(GRAHAM_MULTIPLIER, inputs.earningsPerShare),
      inputs.bookValuePerShare,
    ),
  );
}

const definitions: readonly ValuationDefinition[] = [
  {
    compute: grahamNumber,
    formulaVersion: "GrahamNumber.v1",
    method: "graham-number",
    positiveInputs: ["bookValuePerShare", "earningsPerShare"],
    requiredInputs: ["bookValuePerShare", "earningsPerShare"],
  },
  {
    // Margin of safety against the Graham intrinsic value: (intrinsic - price) / intrinsic.
    compute: inputs => {
      const intrinsic = grahamNumber(inputs);
      if (intrinsic === null || intrinsic <= 0n) return null;
      return divideDecimal(intrinsic - inputs.price, intrinsic);
    },
    formulaVersion: "MarginOfSafety.v1",
    method: "margin-of-safety",
    positiveInputs: ["bookValuePerShare", "earningsPerShare", "price"],
    requiredInputs: ["bookValuePerShare", "earningsPerShare", "price"],
  },
  {
    // Reported owner earnings only; an approximation would not be interchangeable with it.
    compute: inputs => inputs.ownerEarnings,
    formulaVersion: "OwnerEarnings.v1",
    method: "owner-earnings",
    positiveInputs: [],
    requiredInputs: ["ownerEarnings"],
  },
  {
    compute: inputs => divideDecimal(inputs.operatingIncome, inputs.enterpriseValue),
    formulaVersion: "GreenblattEarningsYield.v1",
    method: "greenblatt-earnings-yield",
    positiveInputs: ["enterpriseValue"],
    requiredInputs: ["enterpriseValue", "operatingIncome"],
  },
  {
    compute: inputs => {
      const employedCapital = inputs.netWorkingCapital + inputs.netFixedAssets;
      if (employedCapital <= 0n) return null;
      return divideDecimal(inputs.operatingIncome, employedCapital);
    },
    formulaVersion: "ReturnOnCapital.v1",
    method: "return-on-capital",
    positiveInputs: [],
    requiredInputs: ["netFixedAssets", "netWorkingCapital", "operatingIncome"],
  },
];

export const ADVISOR_VALUATION_METHODS: readonly Pick<
  ValuationDefinition,
  "formulaVersion" | "method" | "requiredInputs"
>[] = definitions.map(definition => ({
  formulaVersion: definition.formulaVersion,
  method: definition.method,
  requiredInputs: definition.requiredInputs,
}));

function definitionFor(method: ValuationMethod): ValuationDefinition {
  const definition = definitions.find(candidate => candidate.method === method);
  if (!definition) {
    throw new Error(`Advisor valuation method ${method} is not published.`);
  }
  return definition;
}

export function evaluateValuation(
  method: ValuationMethod,
  context: { facts: FmpFactSet },
): ValuationResult {
  const definition = definitionFor(method);
  const unavailable = (
    reason: ValuationUnavailableReason,
    unmetInputs: readonly FmpFactField[],
  ): ValuationResult => ({
    formulaVersion: definition.formulaVersion,
    kind: "unavailable",
    method,
    reason,
    unmetInputs,
  });

  const inputs: Partial<Record<FmpFactField, bigint>> = {};
  const references: ValuationInputReference[] = [];
  const unmet: FmpFactField[] = [];

  for (const field of definition.requiredInputs) {
    const result = context.facts[field];
    if (result.kind !== "available") {
      unmet.push(field);
      continue;
    }
    inputs[field] = result.fact.value;
    references.push({
      field,
      observedAt: result.fact.observedAt,
      period: result.fact.period,
      source: result.fact.source,
      symbol: result.fact.symbol,
      value: result.fact.value,
    });
  }
  if (unmet.length > 0) return unavailable("missing-input", unmet);

  const nonPositive = definition.positiveInputs.filter(field => (inputs[field] ?? 0n) <= 0n);
  if (nonPositive.length > 0) return unavailable("non-positive-input", nonPositive);

  const resolved = resolvedInputs(inputs);
  const value = definition.compute(resolved);
  if (value === null) {
    return unavailable("non-positive-input", definition.requiredInputs);
  }

  return {
    formulaVersion: definition.formulaVersion,
    inputs: references.sort((left, right) => left.field.localeCompare(right.field)),
    kind: "available",
    method,
    value,
  };
}

/**
 * Required inputs are all present by this point; unrequired fields read as zero so a formula can
 * never silently consume a value the method did not declare.
 */
function resolvedInputs(
  inputs: Partial<Record<FmpFactField, bigint>>,
): Readonly<Record<FmpFactField, bigint>> {
  return {
    bookValuePerShare: inputs.bookValuePerShare ?? 0n,
    earningsPerShare: inputs.earningsPerShare ?? 0n,
    enterpriseValue: inputs.enterpriseValue ?? 0n,
    netFixedAssets: inputs.netFixedAssets ?? 0n,
    netWorkingCapital: inputs.netWorkingCapital ?? 0n,
    operatingIncome: inputs.operatingIncome ?? 0n,
    ownerEarnings: inputs.ownerEarnings ?? 0n,
    price: inputs.price ?? 0n,
  };
}
