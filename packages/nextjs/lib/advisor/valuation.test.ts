import assert from "node:assert/strict";
import test from "node:test";

import { formatAdvisorDecimal, parseAdvisorDecimal } from "./decimal";
import type { FmpFact, FmpFactResult } from "./fmp";
import {
  ADVISOR_VALUATION_METHODS,
  evaluateValuation,
  type ValuationMethod,
} from "./valuation";

const observedAt = new Date("2026-03-31T00:00:00.000Z");
const retrievedAt = new Date("2026-07-26T12:00:00.000Z");

function fact(field: FmpFact["field"], value: string): FmpFactResult {
  const parsed = parseAdvisorDecimal(value);
  assert.ok(parsed !== null);
  return {
    fact: {
      field,
      observedAt,
      period: field === "price" ? null : "2026-Q1",
      retrievedAt,
      source: "fmp",
      symbol: "EXMP",
      value: parsed,
    },
    kind: "available",
  };
}

function unavailable(field: FmpFact["field"]): FmpFactResult {
  return { field, kind: "unavailable", reason: "missing", symbol: "EXMP" };
}

const completeFacts = {
  bookValuePerShare: fact("bookValuePerShare", "18.40"),
  earningsPerShare: fact("earningsPerShare", "4.20"),
  enterpriseValue: fact("enterpriseValue", "12500000000"),
  netFixedAssets: fact("netFixedAssets", "1400000000"),
  netWorkingCapital: fact("netWorkingCapital", "1100000000"),
  operatingIncome: fact("operatingIncome", "912000000"),
  ownerEarnings: fact("ownerEarnings", "640000000"),
  price: fact("price", "34.50"),
};

test("every published method has a pinned formula version", () => {
  assert.deepEqual(
    ADVISOR_VALUATION_METHODS.map(method => method.formulaVersion).sort(),
    [
      "GrahamNumber.v1",
      "GreenblattEarningsYield.v1",
      "MarginOfSafety.v1",
      "OwnerEarnings.v1",
      "ReturnOnCapital.v1",
    ],
  );
});

test("the Graham number is computed from earnings and book value", () => {
  const result = evaluateValuation("graham-number", { facts: completeFacts });

  assert.equal(result.kind, "available");
  if (result.kind !== "available") return;
  assert.equal(result.formulaVersion, "GrahamNumber.v1");
  // sqrt(22.5 * 4.20 * 18.40) = sqrt(1738.8)
  assert.equal(formatAdvisorDecimal(result.value), "41.69892084");
  assert.deepEqual(
    result.inputs.map(input => input.field).sort(),
    ["bookValuePerShare", "earningsPerShare"],
  );
  for (const input of result.inputs) {
    assert.equal(input.period, "2026-Q1");
    assert.equal(input.source, "fmp");
    assert.equal(input.symbol, "EXMP");
  }
});

test("margin of safety compares price against the Graham intrinsic value", () => {
  const result = evaluateValuation("margin-of-safety", { facts: completeFacts });

  assert.equal(result.kind, "available");
  if (result.kind !== "available") return;
  assert.equal(result.formulaVersion, "MarginOfSafety.v1");
  // (41.69892084 - 34.50) / 41.69892084
  assert.equal(formatAdvisorDecimal(result.value), "0.17264045");
  assert.ok(result.inputs.some(input => input.field === "price"));
});

test("Greenblatt earnings yield and return on capital use operating income", () => {
  const yieldResult = evaluateValuation("greenblatt-earnings-yield", { facts: completeFacts });
  assert.equal(yieldResult.kind, "available");
  if (yieldResult.kind !== "available") return;
  // 912_000_000 / 12_500_000_000
  assert.equal(formatAdvisorDecimal(yieldResult.value), "0.07296");

  const returnResult = evaluateValuation("return-on-capital", { facts: completeFacts });
  assert.equal(returnResult.kind, "available");
  if (returnResult.kind !== "available") return;
  // 912_000_000 / (1_100_000_000 + 1_400_000_000)
  assert.equal(formatAdvisorDecimal(returnResult.value), "0.3648");
});

test("owner earnings is reported from the source, not approximated", () => {
  const result = evaluateValuation("owner-earnings", { facts: completeFacts });

  assert.equal(result.kind, "available");
  if (result.kind !== "available") return;
  assert.equal(result.formulaVersion, "OwnerEarnings.v1");
  assert.equal(formatAdvisorDecimal(result.value), "640000000");
  assert.deepEqual(result.inputs.map(input => input.field), ["ownerEarnings"]);
});

test("identical valid inputs always produce an identical result", () => {
  for (const method of ADVISOR_VALUATION_METHODS) {
    const first = evaluateValuation(method.method, { facts: completeFacts });
    const second = evaluateValuation(method.method, { facts: { ...completeFacts } });
    assert.deepEqual(first, second, method.method);
  }
});

test("a missing required input names the method unavailable", () => {
  const withoutEps = { ...completeFacts, earningsPerShare: unavailable("earningsPerShare") };
  const result = evaluateValuation("graham-number", { facts: withoutEps });

  assert.equal(result.kind, "unavailable");
  if (result.kind !== "unavailable") return;
  assert.equal(result.formulaVersion, "GrahamNumber.v1");
  assert.equal(result.reason, "missing-input");
  assert.deepEqual(result.unmetInputs, ["earningsPerShare"]);
});

test("an invalid denominator returns unavailable instead of a substituted calculation", () => {
  const zeroEnterpriseValue = { ...completeFacts, enterpriseValue: fact("enterpriseValue", "0") };
  const zeroYield = evaluateValuation("greenblatt-earnings-yield", { facts: zeroEnterpriseValue });
  assert.equal(zeroYield.kind, "unavailable");
  if (zeroYield.kind !== "unavailable") return;
  assert.equal(zeroYield.reason, "non-positive-input");

  const negativeCapital = {
    ...completeFacts,
    netFixedAssets: fact("netFixedAssets", "-1400000000"),
    netWorkingCapital: fact("netWorkingCapital", "-1100000000"),
  };
  const negativeReturn = evaluateValuation("return-on-capital", { facts: negativeCapital });
  assert.equal(negativeReturn.kind, "unavailable");
  if (negativeReturn.kind !== "unavailable") return;
  assert.equal(negativeReturn.reason, "non-positive-input");
});

test("the Graham number refuses non-positive earnings or book value", () => {
  for (const negative of ["0", "-4.20"]) {
    const result = evaluateValuation("graham-number", {
      facts: { ...completeFacts, earningsPerShare: fact("earningsPerShare", negative) },
    });
    assert.equal(result.kind, "unavailable", negative);
    if (result.kind !== "unavailable") return;
    assert.equal(result.reason, "non-positive-input");
  }
});

test("margin of safety is unavailable when the intrinsic value cannot be established", () => {
  const result = evaluateValuation("margin-of-safety", {
    facts: { ...completeFacts, bookValuePerShare: unavailable("bookValuePerShare") },
  });

  assert.equal(result.kind, "unavailable");
  if (result.kind !== "unavailable") return;
  assert.deepEqual(result.unmetInputs, ["bookValuePerShare"]);
});

test("a stale or ambiguous source is an unmet precondition, not a usable input", () => {
  for (const reason of ["ambiguous", "source-unavailable", "stale"] as const) {
    const result = evaluateValuation("owner-earnings", {
      facts: {
        ...completeFacts,
        ownerEarnings: { field: "ownerEarnings", kind: "unavailable", reason, symbol: "EXMP" },
      },
    });
    assert.equal(result.kind, "unavailable", reason);
    if (result.kind !== "unavailable") return;
    assert.deepEqual(result.unmetInputs, ["ownerEarnings"]);
  }
});

test("a valuation never invents a method it does not publish", () => {
  const published = new Set<ValuationMethod>(ADVISOR_VALUATION_METHODS.map(method => method.method));
  assert.equal(published.size, ADVISOR_VALUATION_METHODS.length);
  assert.equal(published.has("graham-number"), true);
});
