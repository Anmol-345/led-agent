import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { verifyMessage, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  CREDIT_SESSION_COOKIE,
  GLOBAL_CREDIT_RATE_LIMIT_COUNT,
  handleAccountRoute,
  handleChallengeRoute,
  handleLogoutRoute,
  handleSessionRoute,
  MAX_CREDIT_RATE_LIMIT_BUCKETS,
  resetCreditRateLimitsForTests,
} from "./api";
import type { CreditMessageVerifier } from "./auth";
import { parseCreditRuntimeConfig, type CreditRuntimeEnvironment } from "./config";
import {
  createCreditPrismaClient,
  migrateCreditDatabase,
  type CreditPrismaClient,
} from "./db";

import { DEPLOYMENT } from "../deployment";

/** Credit events are indexed on the vault chain, which follows the deploy target. */
const VAULT_CHAIN_ID_BIG = BigInt(DEPLOYMENT.vaultChainId);

const testEnvironment: CreditRuntimeEnvironment = {
  CREDIT_APP_ORIGIN: "https://app.leg.investments",
  CREDIT_BASE_RPC_URL: "https://base.example.test",
  CREDIT_BILLING_SIGNER_PRIVATE_KEY: `0x${"1".repeat(64)}`,
  CREDIT_CONFIRMATIONS: "6",
  CREDIT_DEPLOYMENT_BLOCK: "1",
  CREDIT_SCHEDULER_SECRET: "scheduler-secret-with-at-least-thirty-two-characters",
  CREDIT_VAULT_ADDRESS: "0x1111111111111111111111111111111111111111",
  CREDIT_USDC_ADDRESS: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  FMP_PRODUCTION_LICENSE_CONFIRMED: "true",
};
const testAppOrigin = "https://app.leg.investments";

type JsonValue =
  | boolean
  | number
  | string
  | null
  | JsonObject
  | readonly JsonValue[];
type JsonObject = { readonly [key: string]: JsonValue };

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function jsonObject(response: Response): Promise<JsonObject> {
  const value: JsonValue = JSON.parse(await response.text());
  assert.ok(isJsonObject(value));
  return value;
}

function requiredString(value: JsonValue | undefined): string {
  if (typeof value !== "string") {
    throw new Error("Expected JSON string field.");
  }
  return value;
}

async function setupTest() {
  const dir = mkdtempSync(join(tmpdir(), "leg-api-test-"));
  const config = parseCreditRuntimeConfig({
    ...testEnvironment,
    CREDIT_DATABASE_PATH: join(dir, "credits.sqlite"),
  });

  await migrateCreditDatabase(config);
  return { prisma: createCreditPrismaClient(config), config, dir };
}

function localVerifier(): CreditMessageVerifier {
  return {
    verifyMessage(parameters) {
      return verifyMessage(parameters);
    },
  };
}

function requestContext(clientKey: string, now?: number) {
  return { clientKey, origin: testAppOrigin, now };
}

async function testAccountState(prisma: CreditPrismaClient, wallet: Address) {
  const events = await prisma.creditChainEvent.findMany({
    where: {
      wallet: wallet.toLowerCase(),
      finality: "CONFIRMED",
    },
  });
  const available = events.reduce(
    (total, event) =>
      event.eventName === "Deposited"
        ? total + event.amountMicroUsdc
        : event.eventName === "Withdrawn"
          ? total - event.amountMicroUsdc
          : total,
    0n,
  );
  return {
    available,
    providerEligible: available,
    reserved: 0n,
    pendingDeposits: 0n,
  };
}

test("Credits API keeps wallet identity in an HttpOnly-only session", async t => {
  const { prisma, config, dir } = await setupTest();
  const publicClient = localVerifier();
  const deps = {
    prisma,
    appOrigin: testAppOrigin,
    baseRpcUrl: config.baseRpcUrl,
    vaultChainId: config.baseChainId,
    usdcAddress: config.usdcAddress,
    publicClient,
    getAccount(wallet: Address) {
      return testAccountState(prisma, wallet);
    },
  };
  const clientKey = "api-flow-client";
  resetCreditRateLimitsForTests();

  t.after(async () => {
    await prisma.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  const account = privateKeyToAccount(generatePrivateKey());
  const otherAccount = privateKeyToAccount(generatePrivateKey());

  const challengeResponse = await handleChallengeRoute(
    {
      wallet: account.address,
      action: "read-account",
      requestId: "req-api-session",
    },
    deps,
    requestContext(clientKey),
  );
  assert.equal(challengeResponse.status, 200);
  const challenge = await jsonObject(challengeResponse);
  const challengeId = requiredString(challenge.challengeId);
  const message = requiredString(challenge.message);
  const signature = await account.signMessage({ message });

  await t.test("sets a strict secure HttpOnly cookie without putting its secret in JSON", async () => {
    const response = await handleSessionRoute(
      { challengeId, message, signature },
      deps,
      requestContext(clientKey),
    );
    const cookie = response.headers.get("set-cookie") ?? "";
    const bodyText = await response.clone().text();
    const body = await jsonObject(response);

    assert.equal(response.status, 200);
    assert.match(cookie, /^__Host-leg_credit_session=[0-9a-f]+;/);
    assert.match(cookie, /Path=\//);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Strict/);
    const maxAge = Number(cookie.match(/Max-Age=(\d+)/)?.[1] ?? "0");
    assert.ok(maxAge > 0 && maxAge <= 900);
    assert.equal(body.sessionToken, undefined);
    assert.equal(body.action, "read-account");
    assert.equal(body.wallet, account.address.toLowerCase());

    const cookieToken =
      cookie.match(/^__Host-leg_credit_session=([0-9a-f]+);/)?.[1] ?? "";
    assert.ok(cookieToken);
    assert.equal(bodyText.includes(cookieToken), false);

    await prisma.creditChainEvent.createMany({
      data: [
        {
          chainId: VAULT_CHAIN_ID_BIG,
          transactionHash: `0x${"1".repeat(64)}`,
          logIndex: 0n,
          blockNumber: 1n,
          blockHash: `0x${"2".repeat(64)}`,
          eventName: "Deposited",
          wallet: account.address.toLowerCase(),
          amountMicroUsdc: 2_000_000n,
          finality: "CONFIRMED",
          observedAt: new Date(),
        },
        {
          chainId: VAULT_CHAIN_ID_BIG,
          transactionHash: `0x${"3".repeat(64)}`,
          logIndex: 0n,
          blockNumber: 1n,
          blockHash: `0x${"4".repeat(64)}`,
          eventName: "Deposited",
          wallet: otherAccount.address.toLowerCase(),
          amountMicroUsdc: 99_000_000n,
          finality: "CONFIRMED",
          observedAt: new Date(),
        },
        {
          chainId: VAULT_CHAIN_ID_BIG,
          transactionHash: `0x${"5".repeat(64)}`,
          logIndex: 0n,
          blockNumber: 1n,
          blockHash: `0x${"6".repeat(64)}`,
          eventName: "Deposited",
          wallet: account.address.toLowerCase(),
          amountMicroUsdc: 1_000_000n,
          finality: "REVERSED",
          reason: "Canonical Base reorganization\nreversed this deposit",
          observedAt: new Date(),
        },
      ],
    });
    await prisma.creditChainEvent.createMany({
      data: Array.from({ length: 51 }, (_, index) => ({
        chainId: VAULT_CHAIN_ID_BIG,
        transactionHash: `0x${(index + 100).toString(16).padStart(64, "0")}`,
        logIndex: 0n,
        blockNumber: 1n,
        blockHash: `0x${"7".repeat(64)}`,
        eventName: "Deposited",
        wallet: account.address.toLowerCase(),
        amountMicroUsdc: 1n,
        finality: "REVERSED",
        reason: `Older reversed deposit ${index}`,
        observedAt: new Date(Date.now() - 100_000 - index),
      })),
    });
    await prisma.creditAuthorization.createMany({
      data: Array.from({ length: 101 }, (_, index) => ({
        id: `account-history-${index.toString().padStart(3, "0")}`,
        correlationId: `account-correlation-${index}`,
        reservationId: `0x${(index + 1_000).toString(16).padStart(64, "0")}`,
        wallet: account.address.toLowerCase(),
        serviceType: "ADVISOR",
        priceVersion: "1",
        priceZeroGMicroUsdc: 0n,
        priceFmpMicroUsdc: 0n,
        priceLegServiceMicroUsdc: 1n,
        maximumChargeMicroUsdc: 1n,
        chargePurpose: `account-history-${index}`,
        expiresAt: new Date(Date.now() + index * 1_000),
        status: "REJECTED",
        rejectionReason: "Customer-safe rejection",
      })),
    });
    await prisma.creditAuthorization.create({
      data: {
        id: "account-history-with-usage",
        correlationId: "account-correlation-with-usage",
        reservationId: `0x${"8".repeat(64)}`,
        wallet: account.address.toLowerCase(),
        serviceType: "ADVISOR",
        priceVersion: "1",
        priceZeroGMicroUsdc: 1n,
        priceFmpMicroUsdc: 1n,
        priceLegServiceMicroUsdc: 1n,
        maximumChargeMicroUsdc: 3n,
        chargePurpose: "account-history-with-usage",
        expiresAt: new Date(Date.now() + 10_000_000),
        status: "SETTLED",
      },
    });
    await prisma.creditUsageRecord.create({
      data: {
        id: "account-usage",
        authorizationId: "account-history-with-usage",
        status: "SETTLED",
        zeroGMicroUsdc: 1n,
        fmpMicroUsdc: 1n,
        legServiceMicroUsdc: 1n,
        totalMicroUsdc: 3n,
        customerChargeMicroUsdc: 1n,
        providerReferenceHash: "sensitive-provider-reference",
        createdAt: new Date(),
      },
    });
    await prisma.creditUsageCorrection.create({
      data: {
        id: "account-correction",
        usageRecordId: "account-usage",
        reason: "Reviewed\nreason",
        zeroGMicroUsdc: 0n,
        fmpMicroUsdc: 0n,
        legServiceMicroUsdc: 0n,
        totalMicroUsdc: 0n,
        createdAt: new Date(),
      },
    });
    await prisma.creditUsageCorrection.create({
      data: {
        id: "account-correction-without-safe-reason",
        usageRecordId: "account-usage",
        reason: "\n\t",
        zeroGMicroUsdc: 0n,
        fmpMicroUsdc: 0n,
        legServiceMicroUsdc: 0n,
        totalMicroUsdc: 0n,
        createdAt: new Date(),
      },
    });

    const accountResponse = await handleAccountRoute({ sessionToken: cookieToken }, deps);
    const accountBody = await jsonObject(accountResponse);

    assert.equal(accountResponse.status, 200);
    assert.equal(accountResponse.headers.get("cache-control"), "private, no-store");
    assert.equal(accountBody.wallet, account.address.toLowerCase());
    assert.equal(accountBody.availableUsdc, "2.000000");
    assert.equal(accountBody.providerEligibleUsdc, "2.000000");
    assert.ok(JSON.stringify(accountBody.depositActivity).includes(`0x${"1".repeat(64)}`));
    assert.ok(JSON.stringify(accountBody.depositActivity).includes('"finality":"REVERSED"'));
    assert.ok(
      JSON.stringify(accountBody.depositActivity).includes(
        "Canonical Base reorganization reversed this deposit",
      ),
    );
    assert.ok(Array.isArray(accountBody.depositActivity));
    assert.equal(accountBody.depositActivity.length, 50);
    assert.ok(Array.isArray(accountBody.usageHistory));
    assert.equal(accountBody.usageHistory.length, 100);
    assert.ok(JSON.stringify(accountBody.usageHistory).includes("Reviewed reason"));
    assert.ok(
      JSON.stringify(accountBody.usageHistory).includes(
        "Correction recorded without customer-facing details.",
      ),
    );
    assert.ok(JSON.stringify(accountBody.usageHistory).includes('"customerChargeUsdc":"0.000001"'));
    assert.equal(
      JSON.stringify(accountBody).includes("sensitive-provider-reference"),
      false,
    );
    assert.equal(
      JSON.stringify(accountBody.depositActivity).includes(`0x${"3".repeat(64)}`),
      false,
    );
    assert.equal(JSON.stringify(accountBody).includes(otherAccount.address.toLowerCase()), false);

    const logoutResponse = await handleLogoutRoute({ sessionToken: cookieToken }, deps);
    assert.equal(logoutResponse.status, 204);
    assert.match(logoutResponse.headers.get("set-cookie") ?? "", /Max-Age=0/);
    assert.equal((await handleAccountRoute({ sessionToken: cookieToken }, deps)).status, 401);
  });

  await t.test("returns private no-store even for an unauthenticated account response", async () => {
    const response = await handleAccountRoute({}, deps);

    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  });
});

test("Credits API validates public requests and rate limits by client", async t => {
  const { prisma, config, dir } = await setupTest();
  const deps = {
    prisma,
    appOrigin: testAppOrigin,
    baseRpcUrl: config.baseRpcUrl,
    publicClient: localVerifier(),
  };
  const account = privateKeyToAccount(generatePrivateKey());
  resetCreditRateLimitsForTests();

  t.after(async () => {
    await prisma.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  await t.test("rejects a non-allowlisted action and bounded-field violations generically", async () => {
    const invalidAction = await handleChallengeRoute(
      { wallet: account.address, action: "delete-account", requestId: "req-invalid-action" },
      deps,
      requestContext("validation-action"),
    );
    const oversizedRequestId = await handleChallengeRoute(
      { wallet: account.address, action: "read-account", requestId: "x".repeat(129) },
      deps,
      requestContext("validation-size"),
    );

    assert.equal(invalidAction.status, 400);
    assert.deepEqual(await jsonObject(invalidAction), { error: "Invalid challenge request." });
    assert.equal(oversizedRequestId.status, 400);
    assert.deepEqual(await jsonObject(oversizedRequestId), {
      error: "Invalid challenge request.",
    });
  });

  await t.test("does not expose server-priced billing challenge issuance", async () => {
    const before = await prisma.creditChallenge.count();
    const response = await handleChallengeRoute(
      {
        wallet: account.address,
        action: "authorize-advisor",
        requestId: "req-public-billing",
      },
      deps,
      requestContext("public-billing"),
    );

    assert.equal(response.status, 400);
    assert.equal(await prisma.creditChallenge.count(), before);

    const legacyChargePurpose = await handleChallengeRoute(
      {
        wallet: account.address,
        action: "read-account",
        chargePurpose:
          "correlation=public;service=advisor;version=1;0g=1;fmp=1;leg=1;max=3;unit=micro-USDC",
        requestId: "req-public-billing-terms",
      },
      deps,
      requestContext("public-billing-terms"),
    );
    assert.equal(legacyChargePurpose.status, 400);
    assert.equal(await prisma.creditChallenge.count(), before);

    const providerAmount = await handleChallengeRoute(
      {
        wallet: account.address,
        action: "read-account",
        requestId: "req-public-provider-amount",
        fmpMicroUsdc: "1000",
      },
      deps,
      requestContext("public-provider-amount"),
    );
    assert.equal(providerAmount.status, 400);
    assert.equal(await prisma.creditChallenge.count(), before);
  });

  await t.test("returns 429 after the per-client challenge allowance", async () => {
    const responses: Response[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      responses.push(
        await handleChallengeRoute(
          {
            wallet: account.address,
            action: "read-account",
            requestId: `req-rate-${attempt}`,
          },
          deps,
          requestContext("rate-limited-client"),
        ),
      );
    }

    assert.deepEqual(
      responses.map(response => response.status),
      [200, 200, 200, 200, 200, 429],
    );
    assert.deepEqual(await jsonObject(responses[5]), { error: "Too many requests." });

    const otherClient = await handleChallengeRoute(
      {
        wallet: account.address,
        action: "read-account",
        requestId: "req-other-rate-client",
      },
      deps,
      requestContext("other-rate-client"),
    );
    assert.equal(otherClient.status, 200);

    const sessionStatuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      sessionStatuses.push(
        (
          await handleSessionRoute(
            {},
            deps,
            requestContext("rate-limited-session"),
          )
        ).status,
      );
    }
    assert.deepEqual(sessionStatuses, [401, 401, 401, 401, 401, 429]);
  });

  await t.test("caps aggregate challenge and session attempts across rotating clients", async () => {
    resetCreditRateLimitsForTests();
    const before = await prisma.creditChallenge.count();
    const challengeStatuses: number[] = [];
    for (let attempt = 0; attempt <= GLOBAL_CREDIT_RATE_LIMIT_COUNT; attempt++) {
      challengeStatuses.push(
        (
          await handleChallengeRoute(
            {
              wallet: account.address,
              action: "read-account",
              requestId: `req-global-${attempt}`,
            },
            deps,
            requestContext(`rotating-challenge-${attempt}`),
          )
        ).status,
      );
    }

    assert.equal(
      challengeStatuses
        .slice(0, GLOBAL_CREDIT_RATE_LIMIT_COUNT)
        .every(status => status === 200),
      true,
    );
    assert.equal(challengeStatuses.at(-1), 429);
    assert.equal(
      (await prisma.creditChallenge.count()) - before,
      GLOBAL_CREDIT_RATE_LIMIT_COUNT,
    );

    const sessionStatuses: number[] = [];
    for (let attempt = 0; attempt <= GLOBAL_CREDIT_RATE_LIMIT_COUNT; attempt++) {
      sessionStatuses.push(
        (
          await handleSessionRoute(
            {},
            deps,
            requestContext(`rotating-session-${attempt}`),
          )
        ).status,
      );
    }
    assert.equal(
      sessionStatuses
        .slice(0, GLOBAL_CREDIT_RATE_LIMIT_COUNT)
        .every(status => status === 401),
      true,
    );
    assert.equal(sessionStatuses.at(-1), 429);
    resetCreditRateLimitsForTests();
  });

  await t.test("rejects a mismatched production origin", async () => {
    const response = await handleChallengeRoute(
      {
        wallet: account.address,
        action: "read-account",
        requestId: "req-wrong-origin",
      },
      deps,
      { clientKey: "wrong-origin", origin: "https://evil.example" },
    );

    assert.equal(response.status, 403);
    assert.deepEqual(await jsonObject(response), { error: "Request denied." });
  });

  await t.test("reclaims limiter windows after expiry", async () => {
    resetCreditRateLimitsForTests();
    const startedAt = Date.now();
    for (let client = 0; client < GLOBAL_CREDIT_RATE_LIMIT_COUNT; client++) {
      const response = await handleChallengeRoute(
        { action: "invalid" },
        deps,
        requestContext(`rotating-client-${client}`, startedAt),
      );
      assert.equal(response.status, 400);
    }

    const capped = await handleChallengeRoute(
      { action: "invalid" },
      deps,
      requestContext("over-cap-client", startedAt),
    );
    assert.equal(capped.status, 429);
    assert.ok(GLOBAL_CREDIT_RATE_LIMIT_COUNT < MAX_CREDIT_RATE_LIMIT_BUCKETS);

    const afterExpiry = await handleChallengeRoute(
      { action: "invalid" },
      deps,
      requestContext("post-expiry-client", startedAt + 60_001),
    );
    assert.equal(afterExpiry.status, 400);
  });
});
