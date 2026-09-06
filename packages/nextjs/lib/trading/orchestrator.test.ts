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
import type { ValidatedTradeQuote } from "./types";

describe("Task 2.2 Guard & Orchestrator", () => {
  const dummyWallet = getAddress("0x1111111111111111111111111111111111111111");
  const feeRecipient = getAddress("0x2222222222222222222222222222222222222222");

  const config = loadTradingConfig({
    LEG_INTEGRATOR_FEE_RECIPIENT: feeRecipient,
    UNISWAP_API_KEY: "test-key",
    ALLOWED_TRADING_CHAINS: "8453",
  });

  const mockGateway: UniswapGateway = {
    async fetchQuote(params, config) {
      const quote: ValidatedTradeQuote = {
        kind: "classic",
        quoteId: `q_mock_${Date.now()}`,
        wallet: params.wallet,
        chainId: params.chainId,
        recommendationId: params.recommendationId,
        registryRevision: params.registryRevision,
        inputToken: params.inputToken,
        inputAmount: params.amount,
        outputToken: params.outputToken,
        minimumOutput: "99.5",
        transaction: {
          to: getAddress("0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD"),
          from: params.wallet,
          data: "0x1234",
          value: "0",
          chainId: params.chainId,
        },
        fee: {
          bps: 10,
          token: params.outputToken,
          amount: "0.1",
          recipient: config.feeRecipient,
        },
        expiresAt: new Date(Date.now() + 30000),
      };
      return quote;
    },
    async checkApproval() { return null; },
    async checkUniswapXOrderStatus() {
      return { status: "open" };
    },
  };

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

  it("orchestrates a quote request and saves quote + order", async () => {
    const db = new Database(":memory:");
    const repo = new TradeRepository(db);
    const guard = new TradeGuard(fixtureLookup);
    const orchestrator = new TradeOrchestrator(guard, mockGateway, repo, config);

    const result = await orchestrator.requestQuote({
      sessionAction: validSession,
      recommendation: validRecommendation,
      assetReference: "FIXT",
      chainId: 8453,
      amount: "100.0",
    });

    assert.equal(result.success, true);
    if (result.success) {
      assert.ok(result.quote.quoteId);
      assert.equal(result.order.status, "quoted");
      assert.equal(result.quote.fee.recipient, feeRecipient);
    }
  });

  it("rejects quote request when recommendation belongs to another wallet", async () => {
    const db = new Database(":memory:");
    const repo = new TradeRepository(db);
    const guard = new TradeGuard(fixtureLookup);
    const orchestrator = new TradeOrchestrator(guard, mockGateway, repo, config);

    const wrongWalletRec = {
      ...validRecommendation,
      wallet: getAddress("0x9999999999999999999999999999999999999999"),
    };

    const result = await orchestrator.requestQuote({
      sessionAction: validSession,
      recommendation: wrongWalletRec,
      assetReference: "FIXT",
      chainId: 8453,
      amount: "100.0",
    });

    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.reason, "cross-wallet-recommendation");
    }
  });
});
