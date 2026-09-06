import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { getAddress } from "viem";

import { loadTradingConfig } from "./config";
import { reconcilePendingOrders } from "./reconciler";
import { TradeRepository } from "./repository";
import type { UniswapGateway } from "./uniswap";
import type { ClassicQuote, UniswapXQuote } from "./types";

describe("Task 2.4 Reconciler", () => {
  const dummyWallet = getAddress("0x1111111111111111111111111111111111111111");
  const feeRecipient = getAddress("0x2222222222222222222222222222222222222222");

  const config = loadTradingConfig({
    LEG_INTEGRATOR_FEE_RECIPIENT: feeRecipient,
    UNISWAP_API_KEY: "test-key",
    ALLOWED_TRADING_CHAINS: "8453",
  });

  const uniswapxQuote: UniswapXQuote = {
    kind: "uniswapx",
    quoteId: "q_x_reconcile",
    orderId: "ord_x_reconcile_1",
    wallet: dummyWallet,
    chainId: 8453,
    recommendationId: "rec_1",
    registryRevision: "leg-trade-registry-v1.0.0",
    deadline: new Date(Date.now() + 30000),
    inputToken: getAddress("0x0000000000000000000000000000000000000001"),
    inputMaximum: "100.0",
    outputToken: getAddress("0x0000000000000000000000000000000000000002"),
    outputMinimum: "99.5",
    recipient: dummyWallet,
    fee: {
      bps: 10,
      token: getAddress("0x0000000000000000000000000000000000000002"),
      amount: "0.1",
      recipient: feeRecipient,
    },
    expiresAt: new Date(Date.now() + 30000),
  };

  it("reconciles filled UniswapX order and records fee evidence", async () => {
    const db = new Database(":memory:");
    const repo = new TradeRepository(db);
    repo.saveQuote(uniswapxQuote);
    const order = repo.createOrderFromQuote(uniswapxQuote.quoteId);

    repo.acknowledgeSubmission(order.id, dummyWallet, {
      providerOrderId: "ord_x_reconcile_1",
    });

    const mockGateway: UniswapGateway = {
      async fetchQuote() {
        throw new Error("not implemented");
      },
      async checkApproval() { return null; },
      async checkUniswapXOrderStatus(orderId) {
        if (orderId === "ord_x_reconcile_1") {
          return {
            status: "filled",
            txHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
            filledOutputAmount: "99.7",
          };
        }
        return { status: "open" };
      },
    };

    const summary = await reconcilePendingOrders(repo, mockGateway, config);

    assert.equal(summary.processedCount, 1);
    assert.equal(summary.reconciledCount, 1);

    const receipt = repo.getReceipt(order.id, dummyWallet);
    assert.ok(receipt);
    assert.equal(receipt?.status, "filled");
    assert.equal(receipt?.outputAmount, "99.7");

    const feeEvent = repo.getFeeEvent(order.id);
    assert.ok(feeEvent);
    assert.equal(feeEvent?.amount, "0.1");
    assert.equal(feeEvent?.recipient, feeRecipient);
  });
});
