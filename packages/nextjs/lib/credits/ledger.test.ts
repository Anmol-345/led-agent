import assert from "node:assert/strict";
import crypto from "node:crypto";
import { rmSync } from "node:fs";
import test from "node:test";

import { keccak256, toBytes, toHex } from "viem";

import {
  CreditLedgerService,
  createCreditChargePurpose,
  createCreditReservationTypedData,
  type CompletionInput,
  type PriceSnapshot,
} from "./ledger";
import {
  CreditAuthorizationStatus,
  CreditUsageStatus,
} from "./generated/prisma/client";
import {
  advisorPricing,
  authorizeInput,
  authorizationInput,
  setupTest,
  wallet,
} from "./ledger.test-support";

import { DEPLOYMENT } from "../deployment";

/** Credit events are indexed on the vault chain, which follows the deploy target. */
const VAULT_CHAIN_ID_BIG = BigInt(DEPLOYMENT.vaultChainId);

test("reservation typed data has a stable independently reconstructable vector", () => {
  const typedData = createCreditReservationTypedData({
    authorizationId: "123e4567-e89b-12d3-a456-426614174000",
    chainId: 8453,
    vaultAddress: "0x1111111111111111111111111111111111111111",
    wallet: "0x2222222222222222222222222222222222222222",
    correlationId: "advisor-vector-1",
    serviceType: "advisor",
    pricing: {
      version: "advisor-2026-07",
      components: {
        "0g": 13_000_000n,
        fmp: 5_000_000n,
        legService: 2_000_000n,
      },
      maximumCharge: 20_000_000n,
    },
    expiresAt: new Date("2033-05-18T03:33:20.000Z"),
  });

  assert.equal(
    typedData.message.reservationId,
    "0x986c0dc956dc822b5d8f698661b9eb1ef880786ff9043c16744d2a420e99e9bb",
  );
  assert.equal(
    typedData.message.termsHash,
    "0x379a1bbf7b7882ab7626a08c660c3a54290cf29b26e40d45c953c75984621d78",
  );
  assert.deepEqual(
    typedData.types.Reservation.map(field => `${field.name}:${field.type}`),
    [
      "reservationId:bytes32",
      "customer:address",
      "maximumCharge:uint256",
      "expiresAt:uint48",
      "termsHash:bytes32",
      "chainId:uint256",
      "vault:address",
    ],
  );
  assert.deepEqual(Object.keys(typedData.message), [
    "reservationId",
    "customer",
    "maximumCharge",
    "expiresAt",
    "termsHash",
    "chainId",
    "vault",
  ]);
});

test("getAccount uses live pinned vault money and SQLite only for pending history", async t => {
  const { config, directory, prisma, vault } = await setupTest();
  t.after(async () => {
    await prisma.$disconnect();
    rmSync(directory, { force: true, recursive: true });
  });
  vault.available = 70_000_000n;
  vault.reserved = 30_000_000n;
  const ledger = new CreditLedgerService({
    config,
    prisma,
    vaultClient: vault,
  });
  await prisma.creditChainEvent.createMany({
    data: [
      {
        chainId: VAULT_CHAIN_ID_BIG,
        transactionHash: toHex(1, { size: 32 }),
        logIndex: 0n,
        blockNumber: 400n,
        blockHash: toHex(2, { size: 32 }),
        eventName: "Deposited",
        wallet,
        amountMicroUsdc: 999_000_000n,
        finality: "CONFIRMED",
        observedAt: new Date(),
      },
      {
        chainId: VAULT_CHAIN_ID_BIG,
        transactionHash: toHex(3, { size: 32 }),
        logIndex: 0n,
        blockNumber: 499n,
        blockHash: toHex(4, { size: 32 }),
        eventName: "Deposited",
        wallet,
        amountMicroUsdc: 10_000_000n,
        finality: "PENDING",
        observedAt: new Date(),
      },
      {
        chainId: 1n,
        transactionHash: toHex(5, { size: 32 }),
        logIndex: 0n,
        blockNumber: 499n,
        blockHash: toHex(6, { size: 32 }),
        eventName: "Deposited",
        wallet,
        amountMicroUsdc: 999_000_000n,
        finality: "PENDING",
        observedAt: new Date(),
      },
    ],
  });

  const account = await ledger.getAccount(wallet);

  assert.deepEqual(account, {
    available: 70_000_000n,
    providerEligible: 60_000_000n,
    reserved: 30_000_000n,
    pendingDeposits: 10_000_000n,
    blockNumber: 500n,
  });
});

test("authorize binds exact signed pricing, confirms reserve, and is idempotent", async t => {
  const { directory, ledger, prisma, snapshotProvider, vault } = await setupTest({
    pendingDeposits: 5_000_000n,
  });
  t.after(async () => {
    await prisma.$disconnect();
    rmSync(directory, { force: true, recursive: true });
  });
  const input = await authorizationInput(prisma, "advisor-reserve-1");

  const prepared = await ledger.prepareAuthorization(input);
  assert.equal(vault.operations.length, 0);
  assert.equal(snapshotProvider.calls, 0);
  const first = await ledger.authorize({
    authorizationId: prepared.authorizationId,
    customerSignature: toHex(1, { size: 65 }),
  });
  const duplicate = await ledger.authorize({
    authorizationId: prepared.authorizationId,
    customerSignature: toHex(2, { size: 65 }),
  });
  const stored = await prisma.creditAuthorization.findUniqueOrThrow({
    where: { id: first.authorizationId },
  });

  assert.equal(first.authorizationId, duplicate.authorizationId);
  assert.equal(
    vault.operations.filter(operation => operation.startsWith("reserve:")).length,
    1,
  );
  assert.equal(snapshotProvider.calls, 1);
  assert.equal(vault.reservationVerificationCalls, 1);
  assert.equal(stored.status, CreditAuthorizationStatus.RESERVED);
  assert.equal(stored.challengeId, null);
  assert.equal(stored.chargePurpose, prepared.chargePurpose);
  assert.equal(stored.reservationSignature, toHex(1, { size: 65 }));
  assert.equal(stored.priceFmpMicroUsdc, input.pricing.components.fmp);
  assert.ok(stored.vaultTransactionHash);

  await assert.rejects(
    () =>
      ledger.prepareAuthorization({
        ...input,
        pricing: advisorPricing(21_000_000n),
      }),
    /different terms/,
  );
});

test("concurrent compatible authorization retries converge on one usable row", async t => {
  const { directory, ledger, prisma } = await setupTest();
  t.after(async () => {
    await prisma.$disconnect();
    rmSync(directory, { force: true, recursive: true });
  });
  const input = await authorizationInput(prisma, "concurrent-reserve");

  const [first, second] = await Promise.all([
    authorizeInput(ledger, input),
    authorizeInput(ledger, input),
  ]);

  assert.equal(first.authorizationId, second.authorizationId);
  assert.equal(
    (
      await prisma.creditAuthorization.findUniqueOrThrow({
        where: { id: first.authorizationId },
      })
    ).status,
    CreditAuthorizationStatus.RESERVED,
  );
});

test("prepared authorization makes immutable exact pricing and expiry terms", async t => {
  const { directory, ledger, prisma, vault } = await setupTest();
  t.after(async () => {
    await prisma.$disconnect();
    rmSync(directory, { force: true, recursive: true });
  });
  const signedInput = await authorizationInput(prisma, "signed-purpose-mismatch");
  const prepared = await ledger.prepareAuthorization(signedInput);
  const changedPricing = advisorPricing(21_000_000n);

  await assert.rejects(
    () =>
      ledger.prepareAuthorization({
        ...signedInput,
        pricing: changedPricing,
      }),
    /different terms/,
  );
  const changedExpiresAt = new Date(signedInput.expiresAt.getTime() + 60_000);
  await assert.rejects(
    () =>
      ledger.prepareAuthorization({
        ...signedInput,
        expiresAt: changedExpiresAt,
      }),
    /different terms/,
  );
  assert.equal(await prisma.creditAuthorization.count(), 1);
  assert.equal(
    prepared.typedData.message.termsHash,
    keccak256(toBytes(prepared.chargePurpose)),
  );
  assert.deepEqual(vault.operations, []);
});

test("authorization verifies and persists the wallet signature before provider or vault work", async t => {
  const { directory, ledger, prisma, snapshotProvider, vault } = await setupTest();
  t.after(async () => {
    await prisma.$disconnect();
    rmSync(directory, { force: true, recursive: true });
  });
  const input = await authorizationInput(prisma, "signature-before-broadcast");
  const prepared = await ledger.prepareAuthorization(input);
  vault.reservationSignatureValid = false;

  await assert.rejects(
    () =>
      ledger.authorize({
        authorizationId: prepared.authorizationId,
        customerSignature: toHex(1, { size: 65 }),
      }),
    /signature is invalid/,
  );
  await assert.rejects(
    () =>
      ledger.authorize({
        authorizationId: prepared.authorizationId,
        customerSignature: toHex(1, { size: 2_049 }),
      }),
    /signature is invalid/,
  );
  assert.equal(
    (
      await prisma.creditAuthorization.findUniqueOrThrow({
        where: { id: prepared.authorizationId },
      })
    ).reservationSignature,
    null,
  );
  assert.equal(snapshotProvider.calls, 0);
  assert.equal(
    vault.operations.filter(operation => operation.startsWith("reserve:")).length,
    0,
  );
});

test("retry after a pre-broadcast interruption uses the first persisted signature", async t => {
  const { directory, ledger, prisma, snapshotProvider, vault } = await setupTest();
  t.after(async () => {
    await prisma.$disconnect();
    rmSync(directory, { force: true, recursive: true });
  });
  const input = await authorizationInput(prisma, "signature-crash-retry");
  const prepared = await ledger.prepareAuthorization(input);
  const firstSignature = toHex(1, { size: 65 });
  snapshotProvider.failures = 1;

  await assert.rejects(
    () =>
      ledger.authorize({
        authorizationId: prepared.authorizationId,
        customerSignature: firstSignature,
      }),
    /snapshot is temporarily unavailable/,
  );
  assert.equal(
    (
      await prisma.creditAuthorization.findUniqueOrThrow({
        where: { id: prepared.authorizationId },
      })
    ).reservationSignature,
    firstSignature,
  );

  await ledger.authorize({
    authorizationId: prepared.authorizationId,
    customerSignature: toHex(2, { size: 65 }),
  });
  assert.deepEqual(vault.reserveSignatures, [firstSignature]);
  assert.equal(vault.reservationVerificationCalls, 1);
});

test("authorization that expires before wallet submission is rejected without broadcast", async t => {
  const { directory, ledger, prisma, vault } = await setupTest();
  t.after(async () => {
    await prisma.$disconnect();
    rmSync(directory, { force: true, recursive: true });
  });
  const input = await authorizationInput(prisma, "expired-draft");
  const prepared = await ledger.prepareAuthorization(input);
  await prisma.creditAuthorization.update({
    where: { id: prepared.authorizationId },
    data: { expiresAt: new Date(Date.now() - 1_000) },
  });

  await assert.rejects(
    () =>
      ledger.authorize({
        authorizationId: prepared.authorizationId,
        customerSignature: toHex(1, { size: 65 }),
      }),
    /expired before reservation/,
  );
  const rejected = await prisma.creditAuthorization.findUniqueOrThrow({
    where: { id: prepared.authorizationId },
  });
  assert.equal(rejected.status, CreditAuthorizationStatus.REJECTED);
  assert.equal(rejected.reservationSignature, null);
  assert.equal(vault.reservationVerificationCalls, 0);
  assert.deepEqual(vault.operations, []);
});

test("authorization retry confirms a persisted broadcast without submitting twice", async t => {
  const { directory, ledger, prisma, vault } = await setupTest();
  t.after(async () => {
    await prisma.$disconnect();
    rmSync(directory, { force: true, recursive: true });
  });
  const input = await authorizationInput(prisma, "reserve-confirmation-retry");
  vault.confirmationFailures = 1;
  vault.hiddenReservationReads = 1;

  await assert.rejects(
    () => authorizeInput(ledger, input),
    /pending confirmation/,
  );
  const pending = await prisma.creditAuthorization.findUniqueOrThrow({
    where: { correlationId: input.correlationId },
  });
  assert.equal(pending.status, CreditAuthorizationStatus.PENDING);
  assert.ok(pending.vaultTransactionHash);

  const result = await authorizeInput(ledger, input);
  assert.equal(result.authorizationId, pending.id);
  assert.equal(
    vault.operations.filter(operation => operation.startsWith("reserve:")).length,
    1,
  );
  assert.equal(
    vault.operations.filter(operation => operation.startsWith("confirm:")).length,
    2,
  );
});

test("authorization retries a stored definitively reverted reserve hash", async t => {
  const { directory, ledger, prisma, vault } = await setupTest();
  t.after(async () => {
    await prisma.$disconnect();
    rmSync(directory, { force: true, recursive: true });
  });
  const input = await authorizationInput(prisma, "reserve-reverted-retry");
  vault.reserveReceiptReverts = 1;

  await assert.rejects(
    () => authorizeInput(ledger, input),
    /reserve reverted/,
  );
  const pending = await prisma.creditAuthorization.findUniqueOrThrow({
    where: { correlationId: input.correlationId },
  });
  assert.equal(pending.status, CreditAuthorizationStatus.PENDING);
  assert.equal(pending.vaultTransactionHash, null);

  const recovered = await authorizeInput(ledger, input);
  assert.equal(recovered.authorizationId, pending.id);
  assert.equal(
    vault.operations.filter(operation => operation.startsWith("reserve:")).length,
    2,
  );
});

test("authorization retry recovers a reserve broadcast whose hash was not persisted", async t => {
  const { directory, ledger, prisma, vault } = await setupTest();
  t.after(async () => {
    await prisma.$disconnect();
    rmSync(directory, { force: true, recursive: true });
  });
  const input = await authorizationInput(prisma, "reserve-lost-hash");
  vault.reserveSubmissionFailures = 1;

  await assert.rejects(
    () => authorizeInput(ledger, input),
    /submission outcome is unknown/,
  );
  const pending = await prisma.creditAuthorization.findUniqueOrThrow({
    where: { correlationId: input.correlationId },
  });
  assert.equal(pending.status, CreditAuthorizationStatus.PENDING);
  assert.equal(pending.vaultTransactionHash, null);

  const recovered = await authorizeInput(ledger, input);
  assert.equal(recovered.authorizationId, pending.id);
  assert.equal(
    vault.operations.filter(operation => operation.startsWith("reserve:")).length,
    1,
  );
  assert.equal(
    (
      await prisma.creditAuthorization.findUniqueOrThrow({
        where: { id: recovered.authorizationId },
      })
    ).status,
    CreditAuthorizationStatus.RESERVED,
  );
});

test("authorization reconciles an exact active reservation after duplicate retry receipt reverts", async t => {
  const { directory, ledger, prisma, vault } = await setupTest();
  t.after(async () => {
    await prisma.$disconnect();
    rmSync(directory, { force: true, recursive: true });
  });
  const input = await authorizationInput(prisma, "reserve-duplicate-revert");
  vault.reserveSubmissionFailures = 1;

  await assert.rejects(
    () => authorizeInput(ledger, input),
    /submission outcome is unknown/,
  );
  vault.hiddenReservationReads = 1;
  const recovered = await authorizeInput(ledger, input);

  assert.equal(
    vault.operations.filter(operation => operation.startsWith("reserve:")).length,
    2,
  );
  assert.equal(
    (
      await prisma.creditAuthorization.findUniqueOrThrow({
        where: { id: recovered.authorizationId },
      })
    ).status,
    CreditAuthorizationStatus.RESERVED,
  );
});

test("authorize subtracts freshly indexed pending deposits and stores stable rejection", async t => {
  const { directory, ledger, prisma, snapshotProvider, vault } = await setupTest({
    pendingDeposits: 90_000_000n,
  });
  t.after(async () => {
    await prisma.$disconnect();
    rmSync(directory, { force: true, recursive: true });
  });
  const input = await authorizationInput(prisma, "pending-deposit-rejection");

  await assert.rejects(() => authorizeInput(ledger, input), /Insufficient provider-eligible credit/);
  await assert.rejects(() => authorizeInput(ledger, input), /Insufficient provider-eligible credit/);

  const stored = await prisma.creditAuthorization.findUniqueOrThrow({
    where: { correlationId: input.correlationId },
  });
  assert.equal(snapshotProvider.calls, 1);
  assert.equal(vault.operations.length, 0);
  assert.equal(stored.status, CreditAuthorizationStatus.REJECTED);
  assert.equal(stored.rejectionReason, "Insufficient provider-eligible credit.");
});

test("unlicensed FMP blocks only snapshots with a nonzero FMP component", async t => {
  const { directory, ledger, prisma } = await setupTest({ fmpLicensed: false });
  t.after(async () => {
    await prisma.$disconnect();
    rmSync(directory, { force: true, recursive: true });
  });

  await assert.rejects(
    () =>
      authorizationInput(prisma, "fmp-blocked").then(input =>
        ledger.prepareAuthorization(input),
      ),
    /FMP production licence/,
  );
  assert.equal(await prisma.creditAuthorization.count(), 0);
  const noFmp = await authorizationInput(
    prisma,
    "fmp-not-needed",
    advisorPricing(20_000_000n, 0n),
  );
  const authorized = await authorizeInput(ledger, noFmp);
  assert.ok(authorized.authorizationId);
});

test("finalize handles success, failure, provisional reconciliation, and expiry", async t => {
  const { directory, ledger, prisma, vault } = await setupTest();
  t.after(async () => {
    await prisma.$disconnect();
    rmSync(directory, { force: true, recursive: true });
  });

  const successInput = await authorizationInput(prisma, "final-success");
  const success = await authorizeInput(ledger, successInput);
  await assert.rejects(
    () =>
      ledger.finalize({
        authorizationId: success.authorizationId,
        outcome: "succeeded",
        providerReference: null,
        components: {
          "0g": 14_000_000n,
          fmp: 8_000_000n,
          legService: 1_000_000n,
        },
      }),
    /requires a provider reference/,
  );
  const settled = await ledger.finalize({
    authorizationId: success.authorizationId,
    outcome: "succeeded",
    providerReference: "0g:req-final-success;fmp:quote-final-success",
    components: {
      "0g": 14_000_000n,
      fmp: 8_000_000n,
      legService: 1_000_000n,
    },
  });
  assert.equal(settled.status, "settled");
  const settledUsage = await prisma.creditUsageRecord.findUniqueOrThrow({
    where: { authorizationId: success.authorizationId },
  });
  assert.equal(settledUsage.totalMicroUsdc, 23_000_000n);
  assert.equal(settledUsage.customerChargeMicroUsdc, 19_000_000n);
  assert.equal(
    settledUsage.providerReferenceHash,
    crypto
      .createHash("sha256")
      .update("0g:req-final-success;fmp:quote-final-success")
      .digest("hex"),
  );
  assert.notEqual(
    settledUsage.providerReferenceHash,
    "0g:req-final-success;fmp:quote-final-success",
  );
  const operationsAfterSettlement = vault.operations.length;
  assert.deepEqual(
    await ledger.finalize({
      authorizationId: success.authorizationId,
      outcome: "succeeded",
      providerReference: "0g:req-final-success;fmp:quote-final-success",
      components: {
        "0g": 14_000_000n,
        fmp: 8_000_000n,
        legService: 1_000_000n,
      },
    }),
    settled,
  );
  assert.equal(vault.operations.length, operationsAfterSettlement);
  await assert.rejects(
    () =>
      ledger.finalize({
        authorizationId: success.authorizationId,
        outcome: "succeeded",
        providerReference: "0g:different;fmp:different",
        components: {
          "0g": 14_000_000n,
          fmp: 8_000_000n,
          legService: 1_000_000n,
        },
      }),
    /different usage or provider reference/,
  );
  await assert.rejects(
    () =>
      ledger.finalize({
        authorizationId: success.authorizationId,
        outcome: "succeeded",
        providerReference: null,
        components: null,
      }),
    /different usage or provider reference/,
  );
  await assert.rejects(
    () =>
      ledger.finalize({
        authorizationId: success.authorizationId,
        outcome: "failed",
        providerReference: "0g:req-final-success;fmp:quote-final-success",
        components: {
          "0g": 14_000_000n,
          fmp: 8_000_000n,
          legService: 1_000_000n,
        },
      }),
    /different outcome/,
  );
  const reserveCountAfterSettlement = vault.operations.filter(operation =>
    operation.startsWith("reserve:"),
  ).length;
  await assert.rejects(
    () => authorizeInput(ledger, successInput),
    /not reusable/,
  );
  assert.equal(
    vault.operations.filter(operation => operation.startsWith("reserve:")).length,
    reserveCountAfterSettlement,
  );

  const failedBeforeUsage = await authorizeInput(ledger,
    await authorizationInput(prisma, "failure-before-usage"),
  );
  const released = await ledger.finalize({
    authorizationId: failedBeforeUsage.authorizationId,
    outcome: "failed",
    providerReference: null,
    components: { "0g": 0n, fmp: 0n, legService: 0n },
  });
  assert.equal(released.status, "released");

  const failedAfterUsage = await authorizeInput(ledger,
    await authorizationInput(prisma, "failure-after-usage"),
  );
  const failed = await ledger.finalize({
    authorizationId: failedAfterUsage.authorizationId,
    outcome: "failed",
    providerReference: "0g:req-failed-after-usage;fmp:quote-failed-after-usage",
    components: { "0g": 3_000_000n, fmp: 1_000_000n, legService: 1_000_000n },
  });
  assert.equal(failed.status, "failed");
  const failedAuthorization = await prisma.creditAuthorization.findUniqueOrThrow({
    where: { id: failedAfterUsage.authorizationId },
  });
  assert.equal(failedAuthorization.status, CreditAuthorizationStatus.FAILED);
  await assert.rejects(
    () =>
      ledger.finalize({
        authorizationId: failedAfterUsage.authorizationId,
        outcome: "succeeded",
        providerReference:
          "0g:req-failed-after-usage;fmp:quote-failed-after-usage",
        components: {
          "0g": 3_000_000n,
          fmp: 1_000_000n,
          legService: 1_000_000n,
        },
      }),
    /different outcome/,
  );

  const provisionalAuthorization = await authorizeInput(ledger,
    await authorizationInput(prisma, "provisional-then-settled"),
  );
  const provisional = await ledger.finalize({
    authorizationId: provisionalAuthorization.authorizationId,
    outcome: "succeeded",
    providerReference: null,
    components: null,
  });
  assert.equal(provisional.status, "provisional");
  assert.equal(
    (
      await prisma.creditUsageRecord.findUniqueOrThrow({
        where: { authorizationId: provisionalAuthorization.authorizationId },
      })
    ).status,
    CreditUsageStatus.PROVISIONAL,
  );
  const reconciled = await ledger.finalize({
    authorizationId: provisionalAuthorization.authorizationId,
    outcome: "succeeded",
    providerReference: "0g:req-provisional;fmp:quote-provisional",
    components: { "0g": 5_000_000n, fmp: 5_000_000n, legService: 2_000_000n },
  });
  assert.equal(reconciled.status, "settled");

  const expiredAuthorization = await authorizeInput(ledger,
    await authorizationInput(prisma, "late-provider-cost"),
  );
  const expiredAt = new Date(Date.now() - 1_000);
  await prisma.creditAuthorization.update({
    where: { id: expiredAuthorization.authorizationId },
    data: { expiresAt: expiredAt },
  });
  vault.setReservationExpiry(
    expiredAuthorization.reservationId,
    Math.floor(expiredAt.getTime() / 1_000),
  );
  const expired = await ledger.finalize({
    authorizationId: expiredAuthorization.authorizationId,
    outcome: "failed",
    providerReference: "0g:req-late;fmp:quote-late",
    components: { "0g": 4_000_000n, fmp: 2_000_000n, legService: 1_000_000n },
  });
  assert.equal(expired.status, "expired");
  const lateUsage = await prisma.creditUsageRecord.findUniqueOrThrow({
    where: { authorizationId: expiredAuthorization.authorizationId },
  });
  assert.equal(lateUsage.totalMicroUsdc, 7_000_000n);
  assert.equal(lateUsage.customerChargeMicroUsdc, 0n);
});

test("finalize recovers a lost settlement hash and rejects an onchain charge mismatch", async t => {
  const { directory, ledger, prisma, vault } = await setupTest();
  t.after(async () => {
    await prisma.$disconnect();
    rmSync(directory, { force: true, recursive: true });
  });
  const components = {
    "0g": 5_000_000n,
    fmp: 4_000_000n,
    legService: 1_000_000n,
  };
  const recoverable = await authorizeInput(ledger,
    await authorizationInput(prisma, "settle-lost-hash"),
  );
  vault.settleSubmissionFailures = 1;
  await assert.rejects(
    () =>
      ledger.finalize({
        authorizationId: recoverable.authorizationId,
        outcome: "succeeded",
        providerReference: "0g:req-lost-hash;fmp:quote-lost-hash",
        components,
      }),
    /submission outcome is unknown/,
  );
  assert.equal(
    (
      await prisma.creditUsageRecord.findUniqueOrThrow({
        where: { authorizationId: recoverable.authorizationId },
      })
    ).customerChargeMicroUsdc,
    0n,
  );
  assert.deepEqual(
    await ledger.finalize({
      authorizationId: recoverable.authorizationId,
      outcome: "succeeded",
      providerReference: "0g:req-lost-hash;fmp:quote-lost-hash",
      components,
    }),
    { status: "settled" },
  );
  assert.equal(
    (
      await prisma.creditUsageRecord.findUniqueOrThrow({
        where: { authorizationId: recoverable.authorizationId },
      })
    ).customerChargeMicroUsdc,
    10_000_000n,
  );
  assert.equal(
    vault.operations.filter(operation => operation.startsWith("settle:")).length,
    1,
  );

  const mismatch = await authorizeInput(ledger,
    await authorizationInput(prisma, "settle-charge-mismatch"),
  );
  vault.settledChargeOverride = 9_000_001n;
  vault.settleSubmissionFailures = 1;
  await assert.rejects(
    () =>
      ledger.finalize({
        authorizationId: mismatch.authorizationId,
        outcome: "succeeded",
        providerReference: "0g:req-mismatch;fmp:quote-mismatch",
        components,
      }),
    /submission outcome is unknown/,
  );
  await assert.rejects(
    () =>
      ledger.finalize({
        authorizationId: mismatch.authorizationId,
        outcome: "succeeded",
        providerReference: "0g:req-mismatch;fmp:quote-mismatch",
        components,
      }),
    /does not match prepared usage/,
  );
});

test("finalize clears a reverted settlement hash and releases after the expiry boundary", async t => {
  const { directory, ledger, prisma, vault } = await setupTest();
  t.after(async () => {
    await prisma.$disconnect();
    rmSync(directory, { force: true, recursive: true });
  });
  const authorization = await authorizeInput(ledger,
    await authorizationInput(prisma, "settle-reverted-at-expiry"),
  );
  const completion = {
    authorizationId: authorization.authorizationId,
    outcome: "succeeded",
    providerReference: "0g:req-expiry-race;fmp:quote-expiry-race",
    components: {
      "0g": 5_000_000n,
      fmp: 4_000_000n,
      legService: 1_000_000n,
    },
  } satisfies CompletionInput;
  vault.settleReceiptReverts = 1;

  await assert.rejects(
    () => ledger.finalize(completion),
    /finalization reverted/,
  );
  const pending = await prisma.creditAuthorization.findUniqueOrThrow({
    where: { id: authorization.authorizationId },
  });
  assert.equal(pending.vaultTransactionHash, null);
  assert.equal(
    (
      await prisma.creditUsageRecord.findUniqueOrThrow({
        where: { authorizationId: authorization.authorizationId },
      })
    ).customerChargeMicroUsdc,
    0n,
  );

  const expiredAt = new Date(Date.now() - 1_000);
  await prisma.creditAuthorization.update({
    where: { id: authorization.authorizationId },
    data: { expiresAt: expiredAt },
  });
  vault.setReservationExpiry(
    authorization.reservationId,
    Math.floor(expiredAt.getTime() / 1_000),
  );

  assert.deepEqual(await ledger.finalize(completion), { status: "expired" });
  assert.equal(
    vault.operations.filter(operation => operation.startsWith("settle:")).length,
    1,
  );
  assert.equal(
    vault.operations.filter(operation => operation.startsWith("release:")).length,
    1,
  );
});

test("trading-platform authorization and finalization permit only disclosed Leg platform service", async t => {
  const { directory, ledger, prisma } = await setupTest();
  t.after(async () => {
    await prisma.$disconnect();
    rmSync(directory, { force: true, recursive: true });
  });
  const pricing: PriceSnapshot = {
    version: "trading-platform-1",
    components: { "0g": 0n, fmp: 0n, legService: 1_000_000n },
    maximumCharge: 1_000_000n,
  };
  const input = await authorizationInput(prisma, "trading-leg-service", pricing, {
    serviceType: "trading-platform",
  });
  assert.match(createCreditChargePurpose(input), /purpose=leg-platform-service/);
  const authorization = await authorizeInput(ledger, input);

  await assert.rejects(
    () =>
      ledger.finalize({
        authorizationId: authorization.authorizationId,
        outcome: "succeeded",
        providerReference: "leg:trade-402",
        components: { "0g": 1n, fmp: 0n, legService: 999_999n },
      }),
    /only disclosed Leg platform-service/,
  );
});

test("a live session grant authorizes a charge without any signature", async t => {
  const { directory, ledger, prisma, vault } = await setupTest({
    pendingDeposits: 5_000_000n,
  });
  t.after(async () => {
    await prisma.$disconnect();
    rmSync(directory, { force: true, recursive: true });
  });
  const input = await authorizationInput(prisma, "session-grant-reserve");
  const prepared = await ledger.prepareAuthorization(input);

  vault.sessionAllowance = 100_000_000n;

  const result = await ledger.authorize({ authorizationId: prepared.authorizationId });

  assert.equal(result.authorizationId, prepared.authorizationId);
  // The grant is checked instead of a signature, and no signature is verified at all.
  assert.equal(vault.sessionAllowanceCalls, 1);
  assert.equal(vault.reservationVerificationCalls, 0);
  // "0x" is what tells the vault to draw on the grant.
  assert.deepEqual(vault.reserveSignatures, ["0x"]);

  const stored = await prisma.creditAuthorization.findUniqueOrThrow({
    where: { id: prepared.authorizationId },
  });
  assert.equal(stored.reservationSignature, "0x");
});

test("a charge larger than the remaining session allowance is refused", async t => {
  const { directory, ledger, prisma, vault } = await setupTest({
    pendingDeposits: 5_000_000n,
  });
  t.after(async () => {
    await prisma.$disconnect();
    rmSync(directory, { force: true, recursive: true });
  });
  const input = await authorizationInput(prisma, "session-grant-exhausted");
  const prepared = await ledger.prepareAuthorization(input);

  // Not enough budget left: must fail before anything is submitted on-chain.
  vault.sessionAllowance = 1n;

  await assert.rejects(
    () => ledger.authorize({ authorizationId: prepared.authorizationId }),
    /Session allowance does not cover this charge/,
  );
  assert.deepEqual(vault.reserveSignatures, []);
});
