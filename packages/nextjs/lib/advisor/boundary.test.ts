import assert from "node:assert/strict";
import test from "node:test";
import type { Address } from "viem";

import { RecordingCreditLedger, advisorTestConfig } from "./credit.test-support";
import { AdvisorCreditAdapter } from "./credit";
import { FmpGateway } from "./fmp";
import { AdvisorOrchestrator, type AdvisorRequest } from "./orchestrator";
import { PortfolioReader } from "./portfolio";
import { RouterAdapter } from "./router";
import { evaluateValuation } from "./valuation";

const config = advisorTestConfig();
const wallet: Address = "0x1111111111111111111111111111111111111111";
const now = new Date("2026-07-26T12:00:00.000Z");
const correlationId = "advisor-0199c0de-0000-4000-8000-000000000001";

function mockRecorder() {
  return {
    async completeRun() {},
    async failRun() {},
    async recordQuote() {},
    async startRun() {},
  };
}

function mockFmpFetch(): typeof fetch {
  return async input => {
    const url = typeof input === "string" ? input : input.toString();
    const bundle = new URL(url).pathname.split("/").pop();
    const body =
      bundle === "income-statement"
        ? [{ date: "2026-03-31", eps: 5.0, fiscalYear: "2026", operatingIncome: 1_000_000, period: "Q1", symbol: "EXMP" }]
        : bundle === "key-metrics"
          ? [{ bookValuePerShare: 20.0, date: "2026-03-31", fiscalYear: "2026", period: "Q1", symbol: "EXMP" }]
          : [];
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  };
}

function mockRouterFetch(): typeof fetch {
  return async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "EXMP valuation analysis.", role: "assistant" } }],
        model: "leg-pinned-model",
        usage: { completion_tokens: 500, prompt_tokens: 10_000 },
      }),
      { headers: { "content-type": "application/json" }, status: 200 },
    );
}

test("Task 4.1: Deterministic valuations produce identical output for identical inputs", () => {
  const facts = {
    earningsPerShare: {
      kind: "available" as const,
      fact: {
        field: "earningsPerShare" as const,
        observedAt: now,
        period: "2026-Q1",
        retrievedAt: now,
        source: "fmp" as const,
        symbol: "EXMP",
        value: 500_000_000n, // 5.0
      },
    },
    bookValuePerShare: {
      kind: "available" as const,
      fact: {
        field: "bookValuePerShare" as const,
        observedAt: now,
        period: "2026-Q1",
        retrievedAt: now,
        source: "fmp" as const,
        symbol: "EXMP",
        value: 2_000_000_000n, // 20.0
      },
    },
  };

  const res1 = evaluateValuation("graham-number", { facts: facts as any });
  const res2 = evaluateValuation("graham-number", { facts: facts as any });

  assert.equal(res1.kind, "available");
  assert.equal(res2.kind, "available");
  if (res1.kind === "available" && res2.kind === "available") {
    assert.equal(res1.value, res2.value);
    assert.equal(res1.formulaVersion, "GrahamNumber.v1");
  }
});

test("Task 4.1: Provider is NEVER called before credit authorization", async () => {
  let routerCalled = false;
  const trackingRouterFetch: typeof fetch = async (...args) => {
    routerCalled = true;
    return mockRouterFetch()(...args);
  };

  const ledger = new RecordingCreditLedger({ failAuthorize: new Error("Authorization declined") });
  const orchestrator = new AdvisorOrchestrator({
    config,
    credit: new AdvisorCreditAdapter({ config, ledger }),
    fmp: new FmpGateway({ config, fetch: mockFmpFetch(), now: () => now }),
    now: () => now,
    portfolio: new PortfolioReader({ assets: [] }),
    recorder: mockRecorder(),
    router: new RouterAdapter({ config, fetch: trackingRouterFetch }),
  });

  const quote = await orchestrator.quote({
    conversation: [{ content: "Analyze EXMP", role: "user" }],
    correlationId,
    methods: ["graham-number"],
    selections: [],
    source: "web",
    symbol: "EXMP",
    wallet,
  });

  const runResult = await orchestrator.run({
    action: {
      action: "read-account",
      challengeId: "c1",
      expiresAt: new Date(now.getTime() + 60000),
      requestId: correlationId,
      wallet,
    },
    customerSignature: `0x${"ab".repeat(65)}`,
    quote,
    request: {
      conversation: [{ content: "Analyze EXMP", role: "user" }],
      correlationId,
      methods: ["graham-number"],
      selections: [],
      source: "web",
      symbol: "EXMP",
      wallet,
    },
  });

  assert.equal(runResult.kind, "failed");
  assert.equal(routerCalled, false, "Router provider must not be called when authorization fails");
});

test("Task 4.1: Raw secrets or prompts never escape into recorded evidence", async () => {
  const recordedLogs: string[] = [];
  const safeSerialize = (val: any) => JSON.stringify(val, (_, v) => typeof v === "bigint" ? v.toString() : v);

  const recordingRecorder = {
    async completeRun(payload: any) { recordedLogs.push(safeSerialize(payload)); },
    async failRun(payload: any) { recordedLogs.push(safeSerialize(payload)); },
    async recordQuote(payload: any) { recordedLogs.push(safeSerialize(payload)); },
    async startRun(payload: any) { recordedLogs.push(safeSerialize(payload)); },
  };

  const ledger = new RecordingCreditLedger();
  const orchestrator = new AdvisorOrchestrator({
    config,
    credit: new AdvisorCreditAdapter({ config, ledger }),
    fmp: new FmpGateway({ config, fetch: mockFmpFetch(), now: () => now }),
    now: () => now,
    portfolio: new PortfolioReader({ assets: [] }),
    recorder: recordingRecorder,
    router: new RouterAdapter({ config, fetch: mockRouterFetch() }),
  });

  const quote = await orchestrator.quote({
    conversation: [{ content: "SECRET_PROMPT_KEY_12345", role: "user" }],
    correlationId,
    methods: ["graham-number"],
    selections: [],
    source: "web",
    symbol: "EXMP",
    wallet,
  });

  await orchestrator.run({
    action: {
      action: "read-account",
      challengeId: "c1",
      expiresAt: new Date(now.getTime() + 60000),
      requestId: correlationId,
      wallet,
    },
    customerSignature: `0x${"ab".repeat(65)}`,
    quote,
    request: {
      conversation: [{ content: "SECRET_PROMPT_KEY_12345", role: "user" }],
      correlationId,
      methods: ["graham-number"],
      selections: [],
      source: "web",
      symbol: "EXMP",
      wallet,
    },
  });

  const allLogs = recordedLogs.join("\n");
  assert.doesNotMatch(allLogs, /SECRET_PROMPT_KEY_12345/);
  assert.doesNotMatch(allLogs, /router-api-key/);
  assert.doesNotMatch(allLogs, /fmp-api-key/);
});
