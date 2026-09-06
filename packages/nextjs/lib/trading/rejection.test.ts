import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { getAddress } from "viem";

import { loadTradingConfig } from "./config";
import { TradeGuard } from "./guard";
import { fixtureLookup } from "./test-fixtures";
import { TradeOrchestrator } from "./orchestrator";
import { TradeRepository } from "./repository";
import type { UniswapGateway } from "./uniswap";

describe("Task 4.1 Rejection Paths & Policy Enforcement", () => {
  const dummyWallet = getAddress("0x1111111111111111111111111111111111111111");
  const otherWallet = getAddress("0x9999999999999999999999999999999999999999");
  const feeRecipient = getAddress("0x2222222222222222222222222222222222222222");

  const config = loadTradingConfig({
    LEG_INTEGRATOR_FEE_RECIPIENT: feeRecipient,
    UNISWAP_API_KEY: "test-key",
    ALLOWED_TRADING_CHAINS: "8453",
  });

  const validSession = {
    challengeId: "ch-1",
    wallet: dummyWallet,
    action: "read-account" as const,
    requestId: "req-1",
    expiresAt: new Date(Date.now() + 600000),
  };

  const validRecommendation = {
    id: "rec_1",
    version: "ValueInvestingRecommendation.v1" as const,
    wallet: dummyWallet,
    assetAddress: getAddress("0x2aE403F54F9D1c9B9e90E0d6aA3F7f2E59bF3B90"),
    assetChainId: 8453,
    assetSymbol: "FIXT",
    calculations: [],
    disclaimer: "test",
    evidence: [],
    expiresAt: new Date(Date.now() + 600000),
    generatedAt: new Date(),
    philosophyVersion: "1.0",
    risks: "low risk",
    runId: "run-1",
    stance: "undervalued" as const,
    thesis: "test thesis",
  };

  it("rejects quote when credit session is missing or wrong action", async () => {
    const db = new Database(":memory:");
    const repo = new TradeRepository(db);
    const guard = new TradeGuard(fixtureLookup);
    const mockGateway: UniswapGateway = {
      fetchQuote: async () => {
        throw new Error("should not be called");
      },
      checkApproval: async () => null,
      checkUniswapXOrderStatus: async () => ({ status: "open" }),
    };
    const orchestrator = new TradeOrchestrator(guard, mockGateway, repo, config);

    // 1. Missing session
    const res1 = await orchestrator.requestQuote({
      sessionAction: null,
      recommendation: validRecommendation,
      assetReference: "FIXT",
      chainId: 8453,
      amount: "100.0",
    });
    assert.equal(res1.success, false);
    if (!res1.success) assert.equal(res1.reason, "missing-session");

    // 2. Wrong action (not read-account)
    const wrongActionSession = {
      ...validSession,
      action: "authorize-advisor" as any,
    };
    const res2 = await orchestrator.requestQuote({
      sessionAction: wrongActionSession,
      recommendation: validRecommendation,
      assetReference: "FIXT",
      chainId: 8453,
      amount: "100.0",
    });
    assert.equal(res2.success, false);
    if (!res2.success) assert.equal(res2.reason, "wrong-session-action");
  });

  it("rejects quote when asset requires issuer step", async () => {
    const db = new Database(":memory:");
    const repo = new TradeRepository(db);
    const guard = new TradeGuard(fixtureLookup);
    const mockGateway: UniswapGateway = {
      fetchQuote: async () => {
        throw new Error("should not be called");
      },
      checkApproval: async () => null,
      checkUniswapXOrderStatus: async () => ({ status: "open" }),
    };
    const orchestrator = new TradeOrchestrator(guard, mockGateway, repo, config);

    const res = await orchestrator.requestQuote({
      sessionAction: validSession,
      recommendation: validRecommendation,
      assetReference: "FIXT-restricted", // issuer-step-required
      chainId: 8453,
      amount: "100.0",
    });

    assert.equal(res.success, false);
    if (!res.success) assert.equal(res.reason, "issuer-step-required");
  });

  it("proves Customer Credits tables are untouched by TradeRepository", () => {
    const db = new Database(":memory:");
    const repo = new TradeRepository(db);

    const tables = (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
        .all() as { name: string }[]
    ).map(t => t.name);

    assert.equal(
      tables.some(t => t.startsWith("credit_")),
      false,
      "Trade repository should not create or touch Customer Credits tables"
    );
  });
});
