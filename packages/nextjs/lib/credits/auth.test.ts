import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { verifyMessage } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

import {
  CreditAuthService,
  createCreditChallengeMessage,
  type CreditMessageVerifier,
} from "./auth";
import { parseCreditRuntimeConfig, type CreditRuntimeEnvironment } from "./config";
import { createCreditPrismaClient, migrateCreditDatabase } from "./db";
import { CreditAction } from "./generated/prisma/client";

const testEnvironment: CreditRuntimeEnvironment = {
  CREDIT_APP_ORIGIN: "https://app.leg.investments",
  CREDIT_BASE_RPC_URL: "https://base.example.test",
  CREDIT_BILLING_SIGNER_PRIVATE_KEY: `0x${"1".repeat(64)}`,
  CREDIT_CONFIRMATIONS: "12",
  CREDIT_DEPLOYMENT_BLOCK: "1",
  CREDIT_SCHEDULER_SECRET: "scheduler-secret-with-at-least-thirty-two-characters",
  CREDIT_VAULT_ADDRESS: "0x1111111111111111111111111111111111111111",
  CREDIT_USDC_ADDRESS: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  FMP_PRODUCTION_LICENSE_CONFIRMED: "true",
};
const testAppOrigin = "https://app.leg.investments";
const testAppDomain = "app.leg.investments";
const legacyAdvisorChargePurpose =
  "correlation=req-exact-message;service=advisor;version=1;0g=100000;fmp=200000;leg=300000;max=600000;unit=micro-USDC;reservation-expires=2026-07-26T00:00:00.000Z";

async function setupTestDatabase() {
  const dir = mkdtempSync(join(tmpdir(), "leg-auth-test-"));
  const config = parseCreditRuntimeConfig({
    ...testEnvironment,
    CREDIT_DATABASE_PATH: join(dir, "credits.sqlite"),
  });

  await migrateCreditDatabase(config);
  return { prisma: createCreditPrismaClient(config), dir };
}

function localVerifier(): CreditMessageVerifier {
  return {
    verifyMessage(parameters) {
      return verifyMessage(parameters);
    },
  };
}

function mutateLine(message: string, prefix: string, replacement: string): string {
  return message
    .split("\n")
    .map(line => (line.startsWith(prefix) ? replacement : line))
    .join("\n");
}

test("CreditAuthService exact read-account verification", async t => {
  const { prisma, dir } = await setupTestDatabase();

  t.after(async () => {
    await prisma.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  const account = privateKeyToAccount(generatePrivateKey());
  const authService = new CreditAuthService(prisma, {
    appOrigin: testAppOrigin,
    publicClient: localVerifier(),
  });

  await t.test("persists the exact issued message hash and returns its challenge ID", async () => {
    const challenge = await authService.createChallenge({
      wallet: account.address,
      action: "read-account",
      requestId: "req-exact-message",
    });
    const stored = await prisma.creditChallenge.findUniqueOrThrow({
      where: { id: challenge.challengeId },
    });

    assert.equal(stored.messageHash, crypto.createHash("sha256").update(challenge.message).digest("hex"));
    assert.equal(stored.createdAt.toISOString(), challenge.issuedAt.toISOString());
    assert.equal(
      createCreditChallengeMessage({
        action: "read-account",
        appOrigin: testAppOrigin,
        expiresAt: stored.expiresAt,
        issuedAt: stored.createdAt,
        nonce: stored.nonce,
        requestId: stored.requestId,
        wallet: account.address,
      }),
      challenge.message,
    );
    assert.match(challenge.message, new RegExp(`^${testAppDomain} wants you to sign in`));
    assert.ok(challenge.message.includes(`URI: ${testAppOrigin}`));

    const signature = await account.signMessage({ message: challenge.message });
    const verified = await authService.verifyChallenge({
      message: challenge.message,
      signature,
    });

    assert.equal(verified.challengeId, challenge.challengeId);
    assert.equal(verified.wallet.toLowerCase(), account.address.toLowerCase());
    assert.equal(verified.action, "read-account");
    assert.equal("chargePurpose" in verified, false);
    assert.equal(verified.requestId, "req-exact-message");
  });

  await t.test("rejects a legacy billing SIWE challenge retained by the database enum", async () => {
    const challengeId = crypto.randomUUID();
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 60_000);
    const nonce = crypto.randomBytes(16).toString("hex");
    const requestId = "req-legacy-billing";
    const message = createSiweMessage({
      address: account.address,
      chainId: 8453,
      domain: testAppDomain,
      expirationTime: expiresAt,
      issuedAt,
      nonce,
      requestId,
      statement: `Leg Credit Action: authorize-advisor; Charge Purpose: ${legacyAdvisorChargePurpose}`,
      uri: testAppOrigin,
      version: "1",
    });
    await prisma.creditChallenge.create({
      data: {
        id: challengeId,
        nonce,
        messageHash: crypto.createHash("sha256").update(message).digest("hex"),
        wallet: account.address.toLowerCase(),
        action: CreditAction.AUTHORIZE_ADVISOR,
        requestId,
        expiresAt,
        createdAt: issuedAt,
      },
    });
    const signature = await account.signMessage({ message });

    await assert.rejects(
      authService.verifyChallenge({ challengeId, message, signature }),
      /Invalid credit challenge/,
    );
    assert.equal(
      (
        await prisma.creditChallenge.findUniqueOrThrow({
          where: { id: challengeId },
        })
      ).consumedAt,
      null,
    );
  });

  await t.test("keeps repeated request IDs bound to independent challenges", async () => {
    const requestId = "req-repeated-active";
    const first = await authService.createChallenge({
      wallet: account.address,
      action: "read-account",
      requestId,
    });
    const second = await authService.createChallenge({
      wallet: account.address,
      action: "read-account",
      requestId,
    });
    const [storedFirst, storedSecond] = await Promise.all([
      prisma.creditChallenge.findUniqueOrThrow({
        where: { id: first.challengeId },
      }),
      prisma.creditChallenge.findUniqueOrThrow({
        where: { id: second.challengeId },
      }),
    ]);
    const firstSignature = await account.signMessage({ message: first.message });
    const secondSignature = await account.signMessage({ message: second.message });

    assert.notEqual(first.challengeId, second.challengeId);
    assert.notEqual(storedFirst.nonce, storedSecond.nonce);
    assert.notEqual(storedFirst.messageHash, storedSecond.messageHash);
    await assert.rejects(
      authService.verifyChallenge({
        challengeId: first.challengeId,
        message: second.message,
        signature: secondSignature,
      }),
      /Invalid credit challenge/,
    );

    const verifiedFirst = await authService.verifyChallenge({
      challengeId: first.challengeId,
      message: first.message,
      signature: firstSignature,
    });
    await assert.rejects(
      authService.verifyChallenge({
        challengeId: first.challengeId,
        message: first.message,
        signature: firstSignature,
      }),
      /Invalid credit challenge/,
    );
    const verifiedSecond = await authService.verifyChallenge({
      challengeId: second.challengeId,
      message: second.message,
      signature: secondSignature,
    });

    assert.equal(verifiedFirst.requestId, requestId);
    assert.equal(verifiedSecond.requestId, requestId);
  });

  await t.test("reissues an expired unconsumed request ID with a fresh proof", async () => {
    const requestId = "req-repeated-expired";
    const expired = await authService.createChallenge({
      wallet: account.address,
      action: "read-account",
      requestId,
    });
    await prisma.creditChallenge.update({
      where: { id: expired.challengeId },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    const fresh = await authService.createChallenge({
      wallet: account.address,
      action: "read-account",
      requestId,
    });
    const expiredSignature = await account.signMessage({ message: expired.message });
    const freshSignature = await account.signMessage({ message: fresh.message });

    assert.notEqual(expired.challengeId, fresh.challengeId);
    assert.notEqual(expired.message, fresh.message);
    await assert.rejects(
      authService.verifyChallenge({
        challengeId: expired.challengeId,
        message: expired.message,
        signature: expiredSignature,
      }),
      /Invalid credit challenge/,
    );
    const verified = await authService.verifyChallenge({
      challengeId: fresh.challengeId,
      message: fresh.message,
      signature: freshSignature,
    });
    assert.equal(verified.requestId, requestId);
  });

  await t.test("prunes expired auth records without deleting authorization evidence", async () => {
    const orphan = await authService.createChallenge({
      wallet: account.address,
      action: "read-account",
      requestId: "req-prune-orphan",
    });
    const sessionChallenge = await authService.createChallenge({
      wallet: account.address,
      action: "read-account",
      requestId: "req-prune-session",
    });
    const sessionSignature = await account.signMessage({
      message: sessionChallenge.message,
    });
    const session = await authService.createSession({
      challengeId: sessionChallenge.challengeId,
      message: sessionChallenge.message,
      signature: sessionSignature,
    });
    const protectedChallengeId = crypto.randomUUID();
    await prisma.creditChallenge.create({
      data: {
        id: protectedChallengeId,
        nonce: crypto.randomBytes(16).toString("hex"),
        messageHash: `legacy:${protectedChallengeId}`,
        wallet: account.address.toLowerCase(),
        action: CreditAction.AUTHORIZE_ADVISOR,
        requestId: "req-prune-protected",
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
      },
    });
    await prisma.creditAuthorization.create({
      data: {
        challengeId: protectedChallengeId,
        correlationId: "req-prune-protected",
        chargePurpose: legacyAdvisorChargePurpose,
        expiresAt: new Date(Date.now() + 60_000),
        id: "authorization-prune-protected",
        maximumChargeMicroUsdc: 6n,
        priceFmpMicroUsdc: 2n,
        priceLegServiceMicroUsdc: 3n,
        priceVersion: "prune-test",
        priceZeroGMicroUsdc: 1n,
        reservationId: "reservation-prune-protected",
        serviceType: "ADVISOR",
        status: "RESERVED",
        wallet: account.address.toLowerCase(),
      },
    });

    const oldCreatedAt = new Date(Date.now() - 60 * 60 * 1000);
    const expiredAt = new Date(Date.now() - 30 * 60 * 1000);
    await prisma.creditChallenge.updateMany({
      where: {
        id: {
          in: [
            orphan.challengeId,
            sessionChallenge.challengeId,
            protectedChallengeId,
          ],
        },
      },
      data: { createdAt: oldCreatedAt, expiresAt: expiredAt },
    });
    await prisma.creditSession.update({
      where: {
        secretHash: crypto.createHash("sha256").update(session.sessionToken).digest("hex"),
      },
      data: { expiresAt: expiredAt },
    });

    await authService.createChallenge({
      wallet: account.address,
      action: "read-account",
      requestId: "req-prune-trigger",
    });

    assert.equal(
      await prisma.creditSession.findUnique({
        where: {
          secretHash: crypto.createHash("sha256").update(session.sessionToken).digest("hex"),
        },
      }),
      null,
    );
    assert.equal(
      await prisma.creditChallenge.findUnique({
        where: { id: orphan.challengeId },
      }),
      null,
    );
    assert.equal(
      await prisma.creditChallenge.findUnique({
        where: { id: sessionChallenge.challengeId },
      }),
      null,
    );
    assert.notEqual(
      await prisma.creditChallenge.findUnique({
        where: { id: protectedChallengeId },
      }),
      null,
    );
  });

  await t.test("uses an injected reviewed preview or local origin verbatim", async () => {
    const localOrigin = "http://localhost:3000";
    const localAuth = new CreditAuthService(prisma, {
      appOrigin: localOrigin,
      publicClient: localVerifier(),
    });
    const challenge = await localAuth.createChallenge({
      wallet: account.address,
      action: "read-account",
      requestId: "req-local-origin",
    });
    const signature = await account.signMessage({ message: challenge.message });

    assert.match(challenge.message, /^localhost:3000 wants you to sign in/);
    assert.ok(challenge.message.includes(`URI: ${localOrigin}`));
    await localAuth.verifyChallenge({ message: challenge.message, signature });
  });

  for (const mutation of [
    {
      name: "wrong domain",
      change(message: string) {
        return message.replace(testAppDomain, "evil.example");
      },
    },
    {
      name: "wrong URI",
      change(message: string) {
        return mutateLine(message, "URI: ", "URI: https://evil.example");
      },
    },
    {
      name: "wrong action",
      change(message: string) {
        return message.replace(
          "Leg Credit Action: read-account",
          "Leg Credit Action: authorize-advisor",
        );
      },
    },
    {
      name: "added legacy charge purpose",
      change(message: string) {
        return message.replace(
          "Leg Credit Action: read-account",
          `Leg Credit Action: read-account; Charge Purpose: ${legacyAdvisorChargePurpose}`,
        );
      },
    },
    {
      name: "mutated expiry",
      change(message: string) {
        return mutateLine(
          message,
          "Expiration Time: ",
          `Expiration Time: ${new Date(Date.now() + 60_000).toISOString()}`,
        );
      },
    },
    {
      name: "otherwise mutated message",
      change(message: string) {
        return message.replace("Version: 1", "Version: 01");
      },
    },
  ]) {
    await t.test(`rejects ${mutation.name}`, async () => {
      const challenge = await authService.createChallenge({
        wallet: account.address,
        action: "read-account",
        requestId: `req-mutation-${mutation.name.replaceAll(" ", "-")}`,
      });
      const changedMessage = mutation.change(challenge.message);
      const signature = await account.signMessage({ message: changedMessage });

      await assert.rejects(
        authService.verifyChallenge({ message: changedMessage, signature }),
        /Invalid credit challenge/,
      );
    });
  }

  await t.test("rejects an already-expired challenge using the database expiry", async () => {
    const challenge = await authService.createChallenge({
      wallet: account.address,
      action: "read-account",
      requestId: "req-expired-challenge",
    });
    await prisma.creditChallenge.update({
      where: { id: challenge.challengeId },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    const signature = await account.signMessage({ message: challenge.message });

    await assert.rejects(
      authService.verifyChallenge({ message: challenge.message, signature }),
      /Invalid credit challenge/,
    );
  });

  await t.test("rejects request IDs outside RFC3986 pchar", async () => {
    for (const requestId of ["contains space", "fragment#id", "query?id", "bad%GG"]) {
      await assert.rejects(
        authService.createChallenge({
          wallet: account.address,
          action: "read-account",
          requestId,
        }),
        /Invalid challenge input/,
      );
    }
  });

  await t.test("atomically permits only one concurrent consumer", async () => {
    const challenge = await authService.createChallenge({
      wallet: account.address,
      action: "read-account",
      requestId: "req-concurrent-replay",
    });
    const signature = await account.signMessage({ message: challenge.message });

    const results = await Promise.allSettled([
      authService.verifyChallenge({ message: challenge.message, signature }),
      authService.verifyChallenge({ message: challenge.message, signature }),
    ]);

    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.filter(result => result.status === "rejected").length, 1);
  });

  await t.test("requires the session challenge ID to match the consumed challenge", async () => {
    const signedChallenge = await authService.createChallenge({
      wallet: account.address,
      action: "read-account",
      requestId: "req-correct-session-challenge",
    });
    const otherChallenge = await authService.createChallenge({
      wallet: account.address,
      action: "read-account",
      requestId: "req-wrong-session-challenge",
    });
    const signature = await account.signMessage({ message: signedChallenge.message });

    await assert.rejects(
      authService.createSession({
        challengeId: otherChallenge.challengeId,
        message: signedChallenge.message,
        signature,
      }),
      /Invalid credit challenge/,
    );

    const session = await authService.createSession({
      challengeId: signedChallenge.challengeId,
      message: signedChallenge.message,
      signature,
    });
    assert.equal(session.wallet.toLowerCase(), account.address.toLowerCase());
  });

  await t.test("stores only the session hash and rejects revoked or expired sessions", async () => {
    const revokedChallenge = await authService.createChallenge({
      wallet: account.address,
      action: "read-account",
      requestId: "req-revoked-session",
    });
    const revokedSignature = await account.signMessage({ message: revokedChallenge.message });
    const revoked = await authService.createSession({
      challengeId: revokedChallenge.challengeId,
      message: revokedChallenge.message,
      signature: revokedSignature,
    });
    const stored = await prisma.creditSession.findUniqueOrThrow({
      where: {
        secretHash: crypto.createHash("sha256").update(revoked.sessionToken).digest("hex"),
      },
    });

    assert.notEqual(stored.secretHash, revoked.sessionToken);
    await authService.revokeSession(revoked.sessionToken);
    await assert.rejects(authService.verifySession(revoked.sessionToken), /Invalid session/);

    const expiredChallenge = await authService.createChallenge({
      wallet: account.address,
      action: "read-account",
      requestId: "req-expired-session",
    });
    const expiredSignature = await account.signMessage({ message: expiredChallenge.message });
    const expired = await authService.createSession({
      challengeId: expiredChallenge.challengeId,
      message: expiredChallenge.message,
      signature: expiredSignature,
    });
    const expiredHash = crypto.createHash("sha256").update(expired.sessionToken).digest("hex");
    await prisma.creditSession.update({
      where: { secretHash: expiredHash },
      data: { expiresAt: new Date(Date.now() - 1) },
    });

    await assert.rejects(authService.verifySession(expired.sessionToken), /Invalid session/);
  });

  await t.test("delegates a contract wallet signature to the Base-capable public client", async () => {
    const contractWallet = "0x000000000000000000000000000000000000c0de";
    let verifiedAddress = "";
    const contractVerifier: CreditMessageVerifier = {
      async verifyMessage(parameters) {
        verifiedAddress = parameters.address;
        return parameters.address.toLowerCase() === contractWallet;
      },
    };
    const contractAuth = new CreditAuthService(prisma, {
      appOrigin: testAppOrigin,
      publicClient: contractVerifier,
    });
    const challenge = await contractAuth.createChallenge({
      wallet: contractWallet,
      action: "read-account",
      requestId: "req-contract-wallet",
    });

    const verified = await contractAuth.verifyChallenge({
      message: challenge.message,
      signature: "0x1234",
    });

    assert.equal(verifiedAddress.toLowerCase(), contractWallet);
    assert.equal(verified.wallet.toLowerCase(), contractWallet);
  });
});
