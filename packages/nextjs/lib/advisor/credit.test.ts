import assert from "node:assert/strict";
import test from "node:test";

import { isCreditRequestId, type VerifiedCreditAction } from "../credits/auth";
import {
  ADVISOR_SERVICE_TYPE,
  AdvisorCreditAdapter,
  advisorContextHash,
  advisorUsageComponents,
  checkAdvisorAction,
  createAdvisorCorrelationId,
  createAdvisorCreditQuote,
  isAdvisorCorrelationId,
  type AdvisorCreditQuote,
} from "./credit";
import {
  RecordingCreditLedger,
  advisorTestConfig,
  otherWallet,
  testWallet,
} from "./credit.test-support";

const config = advisorTestConfig();
const now = new Date("2026-07-26T12:00:00.000Z");
const contextInput = {
  completionTokenAllowance: 1500,
  philosophyVersion: "v1",
  priceVersion: "advisor-2026-07",
  promptTokens: 24_000,
  routerModel: "leg-pinned-model",
  segments: ["conversation-digest", "philosophy-digest", "tool-result-digest"],
};

function quote(overrides: Partial<Parameters<typeof createAdvisorCreditQuote>[1]> = {}): AdvisorCreditQuote {
  return createAdvisorCreditQuote(config, {
    completionTokens: 1500,
    contextHash: advisorContextHash(contextInput),
    correlationId: "advisor-0199c0de-0000-4000-8000-000000000001",
    now,
    promptTokens: 24_000,
    wallet: testWallet,
    ...overrides,
  });
}

function action(overrides: Partial<VerifiedCreditAction> = {}): VerifiedCreditAction {
  return {
    action: "read-account",
    challengeId: "challenge-1",
    expiresAt: new Date("2026-07-26T12:04:00.000Z"),
    requestId: "advisor-0199c0de-0000-4000-8000-000000000001",
    wallet: testWallet,
    ...overrides,
  };
}

test("an advisor correlation identifier is a usable credit request identifier", () => {
  const correlationId = createAdvisorCorrelationId();

  assert.ok(isAdvisorCorrelationId(correlationId));
  assert.ok(isCreditRequestId(correlationId));
  assert.notEqual(correlationId, createAdvisorCorrelationId());
  for (const invalid of ["", "trading-1", "advisor-", "advisor-not a uuid", `advisor-${"a".repeat(200)}`]) {
    assert.equal(isAdvisorCorrelationId(invalid), false, invalid);
  }
});

test("the quote prices the whole prepared context in integer micro-USDC", () => {
  const priced = quote();

  assert.equal(priced.serviceType, ADVISOR_SERVICE_TYPE);
  assert.equal(priced.wallet, testWallet);
  assert.equal(priced.pricing.version, "advisor-2026-07");
  // 24000 prompt tokens at 3000 micro-USDC/million, 1500 completion tokens at 9000, both rounded up.
  assert.equal(priced.pricing.components["0g"], 72n + 14n);
  assert.equal(priced.pricing.components.fmp, 2_500n);
  assert.equal(priced.pricing.components.legService, 5_000n);
  assert.equal(priced.pricing.maximumCharge, 86n + 2_500n + 5_000n);
  assert.equal(
    priced.pricing.components["0g"] +
      priced.pricing.components.fmp +
      priced.pricing.components.legService,
    priced.pricing.maximumCharge,
  );
  for (const amount of Object.values(priced.pricing.components)) {
    assert.equal(typeof amount, "bigint");
  }
  assert.equal(priced.expiresAt.getTime(), now.getTime() + 300_000);
});

test("the quote refuses a context it cannot price honestly", () => {
  assert.throws(() => quote({ promptTokens: 24_001 }), /prompt/i);
  assert.throws(() => quote({ completionTokens: 1501 }), /completion/i);
  for (const promptTokens of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
    assert.throws(() => quote({ promptTokens }), /token/i, `${promptTokens}`);
  }
  assert.throws(() => quote({ correlationId: "not-an-advisor-correlation" }), /correlation/i);
  assert.throws(() => quote({ contextHash: "short" }), /context/i);
});

test("the context hash binds every priced part of the request", () => {
  const base = advisorContextHash(contextInput);

  assert.match(base, /^[0-9a-f]{64}$/);
  assert.equal(base, advisorContextHash({ ...contextInput }));
  for (const changed of [
    { ...contextInput, completionTokenAllowance: 1499 },
    { ...contextInput, philosophyVersion: "v2" },
    { ...contextInput, priceVersion: "advisor-2026-08" },
    { ...contextInput, promptTokens: 23_999 },
    { ...contextInput, routerModel: "another-model" },
    { ...contextInput, segments: ["conversation-digest", "philosophy-digest"] },
    { ...contextInput, segments: ["philosophy-digest", "conversation-digest", "tool-result-digest"] },
  ]) {
    assert.notEqual(advisorContextHash(changed), base);
  }
});

test("only a matching, unexpired verified action may authorize the quote", () => {
  const priced = quote();

  assert.deepEqual(checkAdvisorAction({ action: action(), now, quote: priced }), { kind: "usable" });
  assert.deepEqual(
    checkAdvisorAction({ action: action({ wallet: otherWallet }), now, quote: priced }),
    { code: "wallet", kind: "declined" },
  );
  assert.deepEqual(
    checkAdvisorAction({ action: action({ requestId: "advisor-0199c0de-0000-4000-8000-000000000002" }), now, quote: priced }),
    { code: "correlation", kind: "declined" },
  );
  assert.deepEqual(
    checkAdvisorAction({
      action: action({ expiresAt: new Date("2026-07-26T11:59:59.000Z") }),
      now,
      quote: priced,
    }),
    { code: "action-expired", kind: "declined" },
  );
  assert.deepEqual(
    checkAdvisorAction({
      action: action({ expiresAt: new Date("2026-07-26T12:10:00.000Z") }),
      now: new Date("2026-07-26T12:06:00.000Z"),
      quote: priced,
    }),
    { code: "quote-expired", kind: "declined" },
  );
});

test("a declined action reaches the credit ledger zero times", async () => {
  const ledger = new RecordingCreditLedger();
  const adapter = new AdvisorCreditAdapter({ config, ledger });
  const priced = quote();

  const declined = await adapter.authorize({
    action: action({ wallet: otherWallet }),
    customerSignature: `0x${"cd".repeat(65)}`,
    now,
    quote: priced,
  });

  assert.deepEqual(declined, { code: "wallet", kind: "declined" });
  assert.deepEqual(ledger.calls, []);
});

test("a matching action prepares and reserves the advisor authorization", async () => {
  const ledger = new RecordingCreditLedger();
  const adapter = new AdvisorCreditAdapter({ config, ledger });
  const priced = quote();

  const authorized = await adapter.authorize({
    action: action(),
    customerSignature: `0x${"cd".repeat(65)}`,
    now,
    quote: priced,
  });

  assert.equal(authorized.kind, "authorized");
  assert.equal(ledger.calls.length, 2);
  const [prepared, reserved] = ledger.calls;
  assert.equal(prepared.method, "prepareAuthorization");
  assert.equal(prepared.input.serviceType, "advisor");
  assert.equal(prepared.input.correlationId, priced.correlationId);
  assert.equal(prepared.input.wallet, testWallet);
  assert.deepEqual(prepared.input.pricing, priced.pricing);
  assert.equal(reserved.method, "authorize");
});

test("an unavailable ledger declines instead of letting paid work start", async () => {
  const ledger = new RecordingCreditLedger({ failAuthorize: new Error("vault unavailable") });
  const adapter = new AdvisorCreditAdapter({ config, ledger });

  const result = await adapter.authorize({
    action: action(),
    customerSignature: `0x${"cd".repeat(65)}`,
    now,
    quote: quote(),
  });

  assert.deepEqual(result, { code: "unavailable", kind: "declined" });
});

test("completion reports exactly three components derived from measured usage", () => {
  const succeeded = advisorUsageComponents(config, {
    fmpRequested: true,
    outcome: "succeeded",
    usage: { completionTokens: 800, promptTokens: 12_000 },
  });

  assert.deepEqual(Object.keys(succeeded).sort(), ["0g", "fmp", "legService"]);
  // 12000 * 3000 / 1e6 = 36, 800 * 9000 / 1e6 = 7.2 -> 8
  assert.equal(succeeded["0g"], 36n + 8n);
  assert.equal(succeeded.fmp, 2_500n);
  assert.equal(succeeded.legService, 5_000n);

  const failedAfterUsage = advisorUsageComponents(config, {
    fmpRequested: true,
    outcome: "failed",
    usage: { completionTokens: 0, promptTokens: 12_000 },
  });
  assert.equal(failedAfterUsage["0g"], 36n);
  assert.equal(failedAfterUsage.fmp, 2_500n);
  assert.equal(failedAfterUsage.legService, 0n, "a failed run does not charge the Leg service");

  const noProviderWork = advisorUsageComponents(config, {
    fmpRequested: false,
    outcome: "failed",
    usage: null,
  });
  assert.deepEqual(noProviderWork, { "0g": 0n, fmp: 0n, legService: 0n });
});

test("measured usage must be whole, non-negative token counts", () => {
  for (const usage of [
    { completionTokens: 0, promptTokens: -1 },
    { completionTokens: 1.5, promptTokens: 10 },
    { completionTokens: 0, promptTokens: Number.NaN },
  ]) {
    assert.throws(
      () => advisorUsageComponents(config, { fmpRequested: false, outcome: "succeeded", usage }),
      /token/i,
      JSON.stringify(usage),
    );
  }
});

test("finalization hands the ledger one normalized outcome per attempt", async () => {
  const ledger = new RecordingCreditLedger();
  const adapter = new AdvisorCreditAdapter({ config, ledger });

  await adapter.finalize({
    authorizationId: "authorization-1",
    fmpRequested: true,
    outcome: "succeeded",
    providerReference: "router-completion-1",
    usage: { completionTokens: 800, promptTokens: 12_000 },
  });
  await adapter.finalize({
    authorizationId: "authorization-2",
    fmpRequested: false,
    outcome: "failed",
    providerReference: null,
    usage: null,
  });

  const [settled, released] = ledger.calls;
  assert.equal(settled.method, "finalize");
  assert.equal(settled.input.outcome, "succeeded");
  assert.equal(settled.input.providerReference, "router-completion-1");
  assert.deepEqual(settled.input.components, { "0g": 44n, fmp: 2_500n, legService: 5_000n });

  assert.equal(released.method, "finalize");
  assert.equal(released.input.outcome, "failed");
  assert.equal(released.input.providerReference, null);
  assert.deepEqual(released.input.components, { "0g": 0n, fmp: 0n, legService: 0n });
});

test("a zero-usage finalization cannot carry a provider reference", async () => {
  const ledger = new RecordingCreditLedger();
  const adapter = new AdvisorCreditAdapter({ config, ledger });

  await assert.rejects(
    () =>
      adapter.finalize({
        authorizationId: "authorization-3",
        fmpRequested: false,
        outcome: "failed",
        providerReference: "router-completion-3",
        usage: null,
      }),
    /provider reference/i,
  );
  assert.deepEqual(ledger.calls, []);
});
