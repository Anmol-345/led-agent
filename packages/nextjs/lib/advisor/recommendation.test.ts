import assert from "node:assert/strict";
import test from "node:test";

import type { Address } from "viem";

import type { CitedResearch } from "./orchestrator";
import {
  RECOMMENDATION_DISCLAIMER,
  RECOMMENDATION_VERSION,
  createRecommendation,
  validateRecommendationHandoff,
  type ValueInvestingRecommendation,
} from "./recommendation";

const wallet: Address = "0x1111111111111111111111111111111111111111";
const otherWallet: Address = "0x2222222222222222222222222222222222222222";
const generatedAt = new Date("2026-07-26T12:00:00.000Z");
const now = new Date("2026-07-26T12:10:00.000Z");

const research: CitedResearch = {
  calculations: [
    {
      calculationId: "calculation-1",
      formulaVersion: "GrahamNumber.v1",
      inputs: [{ field: "earningsPerShare", period: "2026-Q1", value: "4.2" }],
      method: "graham-number",
      result: "41.69892084",
      unavailableReason: null,
    },
  ],
  facts: [
    {
      field: "earningsPerShare",
      observedAt: new Date("2026-03-31T00:00:00.000Z"),
      period: "2026-Q1",
      retrievedAt: generatedAt,
      source: "fmp",
      symbol: "EXMP",
      value: "4.2",
    },
  ],
  holdings: [],
  interpretation: "Trades below its Graham number.",
  limitations: ["Educational research only."],
  philosophyVersion: "v1",
  principles: [{ id: "graham-margin-of-safety", investor: "Benjamin Graham", title: "Margin of safety" }],
};

/**
 * Handoff validation treats its input as untrusted, so a test may describe any shape a database row
 * or connector payload could actually produce.
 */
function recommendation(overrides: Readonly<Record<string, unknown>> = {}): ValueInvestingRecommendation {
  return {
    ...createRecommendation({
      asset: { address: "0x3333333333333333333333333333333333333333", chainId: 8453, symbol: "xEXMP" },
      generatedAt,
      research,
      risks: "Leverage and customer concentration.",
      runId: "run-1",
      stance: "undervalued",
      thesis: "Price sits below a conservative Graham number.",
      ttlSeconds: 3_600,
      wallet,
    }),
    ...overrides,
  };
}

test("a recommendation is built only from a completed run's cited evidence", () => {
  const artifact = recommendation();

  assert.equal(artifact.version, RECOMMENDATION_VERSION);
  assert.equal(artifact.wallet, wallet);
  assert.equal(artifact.runId, "run-1");
  assert.equal(artifact.assetChainId, 8453);
  assert.equal(artifact.assetSymbol, "xEXMP");
  assert.equal(artifact.stance, "undervalued");
  assert.equal(artifact.philosophyVersion, "v1");
  assert.equal(artifact.expiresAt.getTime(), generatedAt.getTime() + 3_600_000);
  assert.deepEqual(artifact.calculations, [
    {
      calculationId: "calculation-1",
      formulaVersion: "GrahamNumber.v1",
      method: "graham-number",
      result: "41.69892084",
    },
  ]);
  assert.equal(artifact.evidence[0].symbol, "EXMP");
  assert.equal(artifact.evidence[0].source, "fmp");
  assert.notEqual(artifact.id, recommendation().id, "each artifact has its own stable identifier");
});

test("the artifact claims no eligibility, route, price, or trading permission", () => {
  const artifact = recommendation();

  assert.equal(artifact.disclaimer, RECOMMENDATION_DISCLAIMER);
  assert.match(artifact.disclaimer, /no issuer eligibility, route, price guarantee, or permission to trade/);
  for (const forbidden of ["order", "route", "signature", "quote", "slippage", "eligible", "confirm"]) {
    assert.equal(forbidden in artifact, false, `artifact must not carry ${forbidden}`);
  }
});

test("a research run without evidence cannot become a recommendation", () => {
  assert.throws(
    () =>
      createRecommendation({
        asset: { address: "0x3333333333333333333333333333333333333333", chainId: 8453, symbol: null },
        generatedAt,
        research: { ...research, calculations: [], facts: [] },
        risks: "Risk.",
        runId: "run-1",
        stance: "undervalued",
        thesis: "Thesis.",
        ttlSeconds: 3_600,
        wallet,
      }),
    /evidence/i,
  );
});

test("refuses an invalid wallet, asset, chain, thesis, risk, or expiry at creation", () => {
  const base = {
    asset: { address: "0x3333333333333333333333333333333333333333", chainId: 8453, symbol: null },
    generatedAt,
    research,
    risks: "Risk.",
    runId: "run-1",
    stance: "undervalued" as const,
    thesis: "Thesis.",
    ttlSeconds: 3_600,
    wallet,
  };

  assert.throws(() => createRecommendation({ ...base, wallet: "not-a-wallet" }), /wallet/i);
  assert.throws(
    () => createRecommendation({ ...base, asset: { ...base.asset, address: "0x1" } }),
    /asset address/i,
  );
  assert.throws(
    () => createRecommendation({ ...base, asset: { ...base.asset, chainId: 0 } }),
    /asset chain/i,
  );
  assert.throws(() => createRecommendation({ ...base, thesis: "   " }), /thesis/i);
  assert.throws(() => createRecommendation({ ...base, risks: "" }), /risks/i);
  assert.throws(() => createRecommendation({ ...base, ttlSeconds: 0 }), /expiry/i);
});

test("a valid, unexpired, wallet-matched artifact hands off exactly as stored", () => {
  const artifact = recommendation();
  const handoff = validateRecommendationHandoff({ now, recommendation: artifact, wallet });

  assert.equal(handoff.kind, "usable");
  if (handoff.kind !== "usable") return;
  assert.equal(handoff.recommendation, artifact, "the exact artifact is handed off, not a copy");
});

test("an expired, wrong-wallet, unsupported, or malformed artifact is rejected", () => {
  const artifact = recommendation();

  assert.deepEqual(
    validateRecommendationHandoff({
      now: new Date("2026-07-26T13:30:00.000Z"),
      recommendation: artifact,
      wallet,
    }),
    { kind: "rejected", reason: "expired" },
  );

  assert.deepEqual(
    validateRecommendationHandoff({ now, recommendation: artifact, wallet: otherWallet }),
    { kind: "rejected", reason: "wrong-wallet" },
  );

  assert.deepEqual(
    validateRecommendationHandoff({
      now,
      recommendation: recommendation({ version: "ValueInvestingRecommendation.v2" }),
      wallet,
    }),
    { kind: "rejected", reason: "unsupported-version" },
  );

  const malformed: readonly Readonly<Record<string, unknown>>[] = [
    { thesis: "  " },
    { risks: "" },
    { calculations: [], evidence: [] },
    { disclaimer: "Trade this now." },
    { expiresAt: new Date("2026-07-26T11:00:00.000Z") },
    { stance: "strong-buy" },
    { wallet: "0xnot-a-wallet" },
    { assetAddress: "0x1" },
    { id: "" },
    { runId: "" },
  ];
  for (const overrides of malformed) {
    assert.deepEqual(
      validateRecommendationHandoff({ now, recommendation: recommendation(overrides), wallet }),
      { kind: "rejected", reason: "malformed" },
      JSON.stringify(overrides),
    );
  }
});

test("untrusted, non-artifact input is rejected as malformed", () => {
  for (const candidate of [
    null,
    undefined,
    "Buy EXMP now",
    42,
    [],
    {},
    { version: RECOMMENDATION_VERSION },
    // Dates arriving as JSON strings are not a usable artifact.
    { ...recommendation(), expiresAt: "2026-07-26T13:00:00.000Z" },
  ]) {
    const handoff = validateRecommendationHandoff({ now, recommendation: candidate, wallet });
    assert.equal(handoff.kind, "rejected", JSON.stringify(candidate));
  }
});

test("free-form chat text cannot satisfy the handoff", () => {
  const chatText = {
    thesis: "Buy EXMP now",
    version: RECOMMENDATION_VERSION,
    wallet,
  };
  const handoff = validateRecommendationHandoff({
    now,
    // A partial object shaped like chat output still fails the exact-shape validation.
    recommendation: recommendation({ ...chatText, calculations: [], evidence: [] }),
    wallet,
  });

  assert.equal(handoff.kind, "rejected");
});
