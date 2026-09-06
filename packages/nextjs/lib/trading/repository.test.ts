import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { getAddress } from "viem";

import { TradeRepository } from "./repository";
import type { ClassicQuote, UniswapXQuote } from "./types";

describe("Task 1.2 Trade Repository & Persistence", () => {
  const dummyWallet = getAddress("0x1111111111111111111111111111111111111111");
  const feeRecipient = getAddress("0x2222222222222222222222222222222222222222");

  function createInMemoryRepository(): TradeRepository {
    const db = new Database(":memory:");
    return new TradeRepository(db);
  }

  const classicQuote: ClassicQuote = {
    kind: "classic",
    quoteId: "q_classic_1",
    wallet: dummyWallet,
    chainId: 8453,
    recommendationId: "rec_1",
    registryRevision: "leg-trade-registry-v1.0.0",
    inputToken: getAddress("0x0000000000000000000000000000000000000001"),
    inputAmount: "100.0",
    outputToken: getAddress("0x0000000000000000000000000000000000000002"),
    minimumOutput: "99.5",
    transaction: {
      to: getAddress("0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD"),
      from: dummyWallet,
      data: "0x123456",
      value: "0",
      chainId: 8453,
    },
    fee: {
      bps: 10,
      token: getAddress("0x0000000000000000000000000000000000000002"),
      amount: "0.1",
      recipient: feeRecipient,
    },
    expiresAt: new Date(Date.now() + 30000),
  };

  it("persists and retrieves a classic quote", () => {
    const repo = createInMemoryRepository();
    repo.saveQuote(classicQuote);

    const retrieved = repo.getQuote("q_classic_1");
    assert.ok(retrieved);
    assert.equal(retrieved?.kind, "classic");
    assert.equal(retrieved?.wallet, dummyWallet);
    assert.equal(retrieved?.fee.amount, "0.1");
  });

  it("creates an order from a quote idempotently", () => {
    const repo = createInMemoryRepository();
    repo.saveQuote(classicQuote);

    const order1 = repo.createOrderFromQuote("q_classic_1");
    const order2 = repo.createOrderFromQuote("q_classic_1");

    assert.equal(order1.id, order2.id);
    assert.equal(order1.status, "quoted");
  });

  it("acknowledges submission with transaction hash", () => {
    const repo = createInMemoryRepository();
    repo.saveQuote(classicQuote);
    const order = repo.createOrderFromQuote("q_classic_1");

    const acknowledged = repo.acknowledgeSubmission(order.id, dummyWallet, {
      transactionHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    });

    assert.equal(acknowledged.status, "submitted");
    assert.equal(
      acknowledged.transactionHash,
      "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
    );
  });

  it("records terminal receipt and fee evidence atomically", () => {
    const repo = createInMemoryRepository();
    repo.saveQuote(classicQuote);
    const order = repo.createOrderFromQuote("q_classic_1");

    repo.recordTerminalReceiptAndFee(
      {
        orderId: order.id,
        wallet: dummyWallet,
        chainId: 8453,
        kind: "classic",
        status: "settled",
        inputToken: classicQuote.inputToken,
        inputAmount: "100.0",
        outputToken: classicQuote.outputToken,
        outputAmount: "99.6",
        feeBps: 10,
        feeToken: classicQuote.fee.token,
        feeAmount: "0.1",
        feeRecipient: feeRecipient,
        reference: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        settledAt: new Date(),
      },
      {
        orderId: order.id,
        wallet: dummyWallet,
        chainId: 8453,
        feeBps: 10,
        token: classicQuote.fee.token,
        amount: "0.1",
        recipient: feeRecipient,
        reference: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        createdAt: new Date(),
      }
    );

    const updatedOrder = repo.getOrder(order.id, dummyWallet);
    assert.equal(updatedOrder?.status, "settled");

    const receipt = repo.getReceipt(order.id, dummyWallet);
    assert.ok(receipt);
    assert.equal(receipt?.status, "settled");

    const feeEvent = repo.getFeeEvent(order.id);
    assert.ok(feeEvent);
    assert.equal(feeEvent?.amount, "0.1");
  });
});
