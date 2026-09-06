import assert from "node:assert/strict";
import test from "node:test";
import { getAddress } from "viem";
import {
  checkCreditTransactionReceipt,
  createSerialTaskQueue,
  creditTransactionScopeMatches,
  creditTransactionStorageKey,
  parsePersistedCreditTransaction,
  parseUsdcAmount,
} from "./ui";

test("parseUsdcAmount parses exact micro-USDC without floating point", () => {
  assert.equal(parseUsdcAmount("1.000001"), 1_000_001n);
  assert.equal(parseUsdcAmount("0.000001"), 1n);
});

test("parseUsdcAmount rejects zero, negative, exponent, and excess precision", () => {
  for (const value of ["0", "-1", "1e3", "1.0000001", "", "  "]) {
    assert.throws(() => parseUsdcAmount(value));
  }
});

test("receipt checks keep an unavailable submitted transaction outcome unknown", async () => {
  assert.equal(
    await checkCreditTransactionReceipt(async () => {
      throw new Error("RPC unavailable");
    }),
    "unknown",
  );
  assert.equal(
    await checkCreditTransactionReceipt(async () => "success"),
    "confirmed",
  );
  assert.equal(
    await checkCreditTransactionReceipt(async () => "reverted"),
    "reverted",
  );
});

test("persisted transaction state restores by wallet and vault without clearing another wallet", () => {
  const walletA = getAddress("0x1111111111111111111111111111111111111111");
  const walletB = getAddress("0x2222222222222222222222222222222222222222");
  const vaultA = getAddress("0x3333333333333333333333333333333333333333");
  const vaultB = getAddress("0x4444444444444444444444444444444444444444");
  const keyA = creditTransactionStorageKey(8453, vaultA, walletA);
  const keyB = creditTransactionStorageKey(8453, vaultA, walletB);
  const otherVaultKey = creditTransactionStorageKey(8453, vaultB, walletA);
  assert.notEqual(keyA, keyB);
  assert.notEqual(keyA, otherVaultKey);
  assert.deepEqual(
    parsePersistedCreditTransaction(
      JSON.stringify({ kind: "withdrawal", hash: `0x${"a".repeat(64)}` }),
    ),
    {
      kind: "withdrawal",
      hash: `0x${"a".repeat(64)}`,
      operationId: `0x${"a".repeat(64)}`,
      outcome: "unknown",
    },
  );
  assert.equal(parsePersistedCreditTransaction('{"kind":"withdrawal","hash":"bad"}'), null);
  assert.equal(creditTransactionScopeMatches(keyB, "operation-b", keyA, "operation-b"), false);
  assert.equal(creditTransactionScopeMatches(keyB, "operation-b", keyB, "operation-a"), false);
  assert.equal(creditTransactionScopeMatches(keyB, "operation-b", keyB, "operation-b"), true);
});

test("same-wallet stale completion cannot match a newer operation", () => {
  const wallet = getAddress("0x1111111111111111111111111111111111111111");
  const vault = getAddress("0x3333333333333333333333333333333333333333");
  const key = creditTransactionStorageKey(8453, vault, wallet);

  assert.equal(creditTransactionScopeMatches(key, "transaction-2", key, "transaction-1"), false);
  assert.equal(creditTransactionScopeMatches(key, "transaction-2", key, "transaction-2"), true);
});

test("session mutations execute in invocation order even when the first response is deferred", async () => {
  const enqueue = createSerialTaskQueue();
  const order: string[] = [];
  let releaseFirst: () => void = () => undefined;
  const firstGate = new Promise<void>(resolve => {
    releaseFirst = resolve;
  });
  const first = enqueue(async () => {
    order.push("first-start");
    await firstGate;
    order.push("first-end");
  });
  const second = enqueue(async () => {
    order.push("second-start");
    order.push("second-end");
  });

  await Promise.resolve();
  assert.deepEqual(order, ["first-start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, [
    "first-start",
    "first-end",
    "second-start",
    "second-end",
  ]);
});
