import assert from "node:assert/strict";
import test from "node:test";

import type { Address } from "viem";

import type { VerifiedCreditAction } from "../credits/auth";
import { AdvisorCreditAdapter } from "./credit";
import { RecordingCreditLedger, advisorTestConfig } from "./credit.test-support";
import { FmpGateway } from "./fmp";
import { AdvisorOrchestrator, estimatePromptTokens, type AdvisorRequest } from "./orchestrator";
import { PortfolioReader, type AdvisorSupportedAsset } from "./portfolio";
import { RouterAdapter } from "./router";

const config = advisorTestConfig();
const wallet: Address = "0x1111111111111111111111111111111111111111";
const otherWallet: Address = "0x2222222222222222222222222222222222222222";
const now = new Date("2026-07-26T12:00:00.000Z");
const correlationId = "advisor-0199c0de-0000-4000-8000-000000000001";
const supportedAsset: AdvisorSupportedAsset = {
  chainId: 8453,
  decimals: 18,
  researchSymbol: "EXMP",
  token: "0x3333333333333333333333333333333333333333",
};

type Recorded = { kind: string; payload: Record<string, unknown> };

function recorder(recorded: Recorded[]) {
  return {
    async completeRun(payload: Record<string, unknown>) {
      recorded.push({ kind: "completeRun", payload });
    },
    async failRun(payload: Record<string, unknown>) {
      recorded.push({ kind: "failRun", payload });
    },
    async recordQuote(payload: Record<string, unknown>) {
      recorded.push({ kind: "recordQuote", payload });
    },
    async startRun(payload: Record<string, unknown>) {
      recorded.push({ kind: "startRun", payload });
    },
  };
}

function fmpFetch(options: { fail?: boolean } = {}): typeof fetch {
  return async input => {
    if (options.fail) throw new Error("fmp down");
    const bundle = new URL(typeof input === "string" ? input : input.toString()).pathname
      .split("/")
      .pop();
    const body =
      bundle === "income-statement"
        ? [{ date: "2026-03-31", eps: 4.2, fiscalYear: "2026", operatingIncome: 912_000_000, period: "Q1", symbol: "EXMP" }]
        : bundle === "key-metrics"
          ? [{ bookValuePerShare: 18.4, date: "2026-03-31", fiscalYear: "2026", period: "Q1", symbol: "EXMP" }]
          : [];
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  };
}

function routerFetch(options: { payload?: unknown; status?: number } = {}): typeof fetch {
  return async () =>
    new Response(
      JSON.stringify(
        options.payload ?? {
          choices: [{ message: { content: "EXMP trades below its Graham number.", role: "assistant" } }],
          model: "leg-pinned-model",
          usage: { completion_tokens: 800, prompt_tokens: 12_000 },
        },
      ),
      { headers: { "content-type": "application/json" }, status: options.status ?? 200 },
    );
}

function orchestrator(options: {
  fmp?: typeof fetch;
  ledger?: RecordingCreditLedger;
  recorded?: Recorded[];
  router?: typeof fetch;
} = {}): { ledger: RecordingCreditLedger; subject: AdvisorOrchestrator } {
  const ledger = options.ledger ?? new RecordingCreditLedger();
  const subject = new AdvisorOrchestrator({
    config,
    credit: new AdvisorCreditAdapter({ config, ledger }),
    fmp: new FmpGateway({ config, fetch: options.fmp ?? fmpFetch(), now: () => now }),
    now: () => now,
    portfolio: new PortfolioReader({
      assets: [supportedAsset],
      balances: { async balanceOf() { return 5_000_000_000_000_000_000n; } },
      now: () => now,
    }),
    recorder: recorder(options.recorded ?? []),
    router: new RouterAdapter({ config, fetch: options.router ?? routerFetch() }),
  });
  return { ledger, subject };
}

function request(overrides: Partial<AdvisorRequest> = {}): AdvisorRequest {
  return {
    conversation: [{ content: "Is EXMP undervalued?", role: "user" }],
    correlationId,
    methods: ["graham-number"],
    selections: [{ chainId: supportedAsset.chainId, token: supportedAsset.token }],
    source: "web",
    symbol: "EXMP",
    wallet,
    ...overrides,
  };
}

function action(overrides: Partial<VerifiedCreditAction> = {}): VerifiedCreditAction {
  return {
    action: "read-account",
    challengeId: "challenge-1",
    expiresAt: new Date("2026-07-26T12:04:00.000Z"),
    requestId: correlationId,
    wallet,
    ...overrides,
  };
}

const signature = `0x${"cd".repeat(65)}` as const;

test("estimates prompt tokens conservatively and deterministically", () => {
  const first = estimatePromptTokens(["hello world", "second segment"]);
  assert.equal(first, estimatePromptTokens(["hello world", "second segment"]));
  assert.ok(first > "hello world second segment".length / 4);
  assert.ok(estimatePromptTokens(["longer text here"]) > estimatePromptTokens(["short"]));
  assert.equal(estimatePromptTokens([]), 0);
});

test("the quote prices the whole prepared context including tool-result capacity", async () => {
  const recorded: Recorded[] = [];
  const { subject } = orchestrator({ recorded });
  const quote = await subject.quote(request());

  assert.equal(quote.wallet, wallet);
  assert.equal(quote.correlationId, correlationId);
  assert.equal(quote.serviceType, "advisor");
  assert.ok(quote.pricing.maximumCharge > 0n);
  assert.ok(
    quote.promptTokenBudget > config.pricing.maxToolResultTokens,
    "the quote reserves tool-result capacity on top of the conversation",
  );
  assert.equal(quote.philosophyVersion, "v1");
  assert.deepEqual(recorded.map(entry => entry.kind), ["recordQuote"]);
});

test("an over-budget context is refused at quote time rather than truncated", async () => {
  const { subject } = orchestrator();
  const huge = "x".repeat(400_000);

  await assert.rejects(
    () => subject.quote(request({ conversation: [{ content: huge, role: "user" }] })),
    /budget|prompt/i,
  );
});

test("a mismatched action makes zero provider and zero credit calls", async () => {
  for (const mismatched of [
    action({ wallet: otherWallet }),
    action({ requestId: "advisor-0199c0de-0000-4000-8000-000000000009" }),
    action({ expiresAt: new Date("2026-07-26T11:00:00.000Z") }),
  ]) {
    const recorded: Recorded[] = [];
    const { ledger, subject } = orchestrator({ recorded });
    const quote = await subject.quote(request());

    const result = await subject.run({
      action: mismatched,
      customerSignature: signature,
      quote,
      request: request(),
    });

    assert.equal(result.kind, "failed");
    if (result.kind !== "failed") return;
    assert.equal(result.code, "authorization");
    assert.deepEqual(ledger.calls, [], "no credit call for a mismatched action");
    assert.equal(
      recorded.some(entry => entry.kind === "completeRun"),
      false,
    );
  }
});

test("a changed request after quoting requires a fresh quote", async () => {
  const { ledger, subject } = orchestrator();
  const quote = await subject.quote(request());

  const result = await subject.run({
    action: action(),
    customerSignature: signature,
    quote,
    request: request({ conversation: [{ content: "Actually, analyse OTHER.", role: "user" }] }),
  });

  assert.equal(result.kind, "failed");
  if (result.kind !== "failed") return;
  assert.equal(result.code, "context");
  assert.deepEqual(ledger.calls, [], "a changed context never reaches the ledger");
});

test("a completed run cites facts, calculations, and the philosophy version", async () => {
  const recorded: Recorded[] = [];
  const { ledger, subject } = orchestrator({ recorded });
  const quote = await subject.quote(request());

  const result = await subject.run({
    action: action(),
    customerSignature: signature,
    quote,
    request: request(),
  });

  assert.equal(result.kind, "completed");
  if (result.kind !== "completed") return;
  const { response } = result;
  assert.equal(response.philosophyVersion, "v1");
  assert.ok(response.principles.length > 0, "a conclusion names its philosophy principles");
  assert.ok(response.facts.some(fact => fact.field === "earningsPerShare"));
  for (const fact of response.facts) {
    assert.equal(fact.source, "fmp");
    assert.equal(fact.symbol, "EXMP");
    assert.ok(fact.retrievedAt instanceof Date);
  }
  const graham = response.calculations.find(entry => entry.method === "graham-number");
  assert.equal(graham?.formulaVersion, "GrahamNumber.v1");
  assert.equal(graham?.result, "41.69892084");
  assert.equal(response.interpretation, "EXMP trades below its Graham number.");
  assert.ok(response.limitations.length > 0);
  assert.equal(response.holdings.length, 1);

  // Authorization strictly precedes provider work, and usage is finalized exactly once.
  const methods = ledger.calls.map(entry => entry.method);
  assert.deepEqual(methods, ["prepareAuthorization", "authorize", "finalize"]);
  const finalize = ledger.calls[2];
  assert.equal(finalize.method === "finalize" && finalize.input.outcome, "succeeded");
  assert.equal(
    finalize.method === "finalize" && finalize.input.components?.legService,
    5_000n,
  );
});

test("a provider failure finalizes incurred usage and fabricates no answer", async () => {
  const recorded: Recorded[] = [];
  const { ledger, subject } = orchestrator({
    recorded,
    router: routerFetch({ status: 503 }),
  });
  const quote = await subject.quote(request());

  const result = await subject.run({
    action: action(),
    customerSignature: signature,
    quote,
    request: request(),
  });

  assert.equal(result.kind, "failed");
  if (result.kind !== "failed") return;
  assert.equal(result.code, "provider");
  assert.equal(result.retryable, true);
  assert.equal("response" in result, false, "a failed run carries no research");

  const finalize = ledger.calls.find(entry => entry.method === "finalize");
  assert.ok(finalize && finalize.method === "finalize");
  assert.equal(finalize.input.outcome, "failed");
  // FMP was reached, so its incurred component is reported; the Leg service charge is not.
  assert.equal(finalize.input.components?.fmp, 2_500n);
  assert.equal(finalize.input.components?.legService, 0n);
  assert.equal(recorded.some(entry => entry.kind === "failRun"), true);
});

test("an unusable source releases the reservation without a provider call", async () => {
  const { ledger, subject } = orchestrator({ fmp: fmpFetch({ fail: true }) });
  const quote = await subject.quote(request());

  const result = await subject.run({
    action: action(),
    customerSignature: signature,
    quote,
    request: request(),
  });

  assert.equal(result.kind, "failed");
  if (result.kind !== "failed") return;
  assert.equal(result.code, "source");

  const finalize = ledger.calls.find(entry => entry.method === "finalize");
  assert.ok(finalize && finalize.method === "finalize");
  assert.equal(finalize.input.outcome, "failed");
  assert.deepEqual(finalize.input.components, { "0g": 0n, fmp: 0n, legService: 0n });
  assert.equal(finalize.input.providerReference, null);
});

test("an invalid Router response is a retryable failure, not research", async () => {
  const { subject } = orchestrator({
    router: routerFetch({ payload: { choices: [], model: "leg-pinned-model" } }),
  });
  const quote = await subject.quote(request());

  const result = await subject.run({
    action: action(),
    customerSignature: signature,
    quote,
    request: request(),
  });

  assert.equal(result.kind, "failed");
  if (result.kind !== "failed") return;
  assert.equal(result.code, "provider");
  assert.equal(result.retryable, true);
});

test("recorded operational evidence carries no prompt, signature, or provider secret", async () => {
  const recorded: Recorded[] = [];
  const { subject } = orchestrator({ recorded });
  const quote = await subject.quote(request());
  await subject.run({ action: action(), customerSignature: signature, quote, request: request() });

  const serialized = JSON.stringify(recorded, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  assert.doesNotMatch(serialized, /Is EXMP undervalued/, "no raw prompt is recorded");
  assert.doesNotMatch(serialized, /cdcdcd/, "no wallet signature is recorded");
  assert.doesNotMatch(serialized, /router-api-key/);
  assert.doesNotMatch(serialized, /fmp-api-key/);
  assert.match(serialized, new RegExp(correlationId), "the correlation identifier is retained");
});
