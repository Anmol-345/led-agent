import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { getAddress } from "viem";

import { loadTradingConfig } from "./config";
import { TradeGuard } from "./guard";
import { fixtureLookup } from "./test-fixtures";
import { TradeOrchestrator } from "./orchestrator";
import { reconcilePendingOrders } from "./reconciler";
import { TradeRepository } from "./repository";
import type { UniswapGateway } from "./uniswap";
import type { ValidatedTradeQuote } from "./types";

describe("Task 4.2 End-to-End Trade Lifecycles", () => {
  const dummyWallet = getAddress("0x1111111111111111111111111111111111111111");
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
    id: "rec_e2e",
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

  it("completes an end-to-end UniswapX order lifecycle with fee evidence and receipt", async () => {
    const db = new Database(":memory:");
    const repo = new TradeRepository(db);
    const guard = new TradeGuard(fixtureLookup);

    const mockGateway: UniswapGateway = {
      async fetchQuote(params, cfg) {
        const quote: ValidatedTradeQuote = {
          kind: "uniswapx",
          quoteId: "q_e2e_uniswapx",
          orderId: "ord_x_e2e_123",
          wallet: params.wallet,
          chainId: params.chainId,
          recommendationId: params.recommendationId,
          registryRevision: params.registryRevision,
          deadline: new Date(Date.now() + 30000),
          inputToken: params.inputToken,
          inputMaximum: params.amount,
          outputToken: params.outputToken,
          outputMinimum: "99.5",
          recipient: params.wallet,
          fee: {
            bps: 10,
            token: params.outputToken,
            amount: "0.1",
            recipient: cfg.feeRecipient,
          },
          expiresAt: new Date(Date.now() + 30000),
        };
        return quote;
      },
      async checkApproval() { return null; },
      async checkUniswapXOrderStatus(orderId) {
        if (orderId === "ord_x_e2e_123") {
          return {
            status: "filled",
            txHash: "0x1111222233334444555566667777888899990000111122223333444455556666",
            filledOutputAmount: "99.8",
          };
        }
        return { status: "open" };
      },
    };

    const orchestrator = new TradeOrchestrator(guard, mockGateway, repo, config);

    // Step 1: Request Quote
    const quoteRes = await orchestrator.requestQuote({
      sessionAction: validSession,
      recommendation: validRecommendation,
      assetReference: "FIXT",
      chainId: 8453,
      amount: "100.0",
    });
    assert.equal(quoteRes.success, true);
    if (!quoteRes.success) return;

    // Step 2: Prepare Action
    const prepRes = await orchestrator.prepareAction({
      sessionAction: validSession,
      quoteId: quoteRes.quote.quoteId,
    });
    assert.equal(prepRes.success, true);

    // Step 3: Customer Submission (UniswapX signature)
    const subRes = await orchestrator.submitOrder({
      sessionAction: validSession,
      orderId: quoteRes.order.id,
      providerOrderId: "ord_x_e2e_123",
    });
    assert.equal(subRes.success, true);
    if (!subRes.success) return;
    assert.equal(subRes.order.status, "accepted");

    // Step 4: Reconcile
    const reconSummary = await reconcilePendingOrders(repo, mockGateway, config);
    assert.equal(reconSummary.reconciledCount, 1);

    // Step 5: Verify Order Status & Receipt & Fee Event
    const statusRes = await orchestrator.getOrderStatus({
      sessionAction: validSession,
      orderId: quoteRes.order.id,
    });
    assert.equal(statusRes.success, true);
    if (!statusRes.success) return;

    assert.equal(statusRes.order.status, "filled");
    assert.ok(statusRes.receipt);
    assert.equal(statusRes.receipt?.status, "filled");
    assert.equal(statusRes.receipt?.feeBps, 10);
    assert.equal(statusRes.receipt?.feeRecipient, feeRecipient);

    const feeEvent = repo.getFeeEvent(quoteRes.order.id);
    assert.ok(feeEvent);
    assert.equal(feeEvent?.amount, "0.1");
    assert.equal(feeEvent?.recipient, feeRecipient);
  });
});
