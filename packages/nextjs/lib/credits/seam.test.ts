import assert from "node:assert/strict";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import test from "node:test";

import {
  CreditLedgerService,
  createCreditChargePurpose,
  type AuthorizationInput,
  type PriceSnapshot,
} from "./ledger";
import {
  authorizeInput,
  authorizationInput,
  setupTest,
} from "./ledger.test-support";

type ProviderUsage = {
  zeroGMicroUsdc: string;
  fmpMicroUsdc: string;
  legServiceMicroUsdc: string;
  reference: string;
};

function normalizeMicroUsdc(value: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error("Provider usage is not canonical micro-USDC.");
  }
  return BigInt(value);
}

async function runAuthorizedProvider(
  ledger: CreditLedgerService,
  input: AuthorizationInput,
  provider: () => Promise<ProviderUsage>,
) {
  const authorization = await authorizeInput(ledger, input);
  const usage = await provider();
  return ledger.finalize({
    authorizationId: authorization.authorizationId,
    outcome: "succeeded",
    providerReference: usage.reference,
    components: {
      "0g": normalizeMicroUsdc(usage.zeroGMicroUsdc),
      fmp: normalizeMicroUsdc(usage.fmpMicroUsdc),
      legService: normalizeMicroUsdc(usage.legServiceMicroUsdc),
    },
  });
}

test("downstream charge purpose is readable, bounded, and delimiter-safe", () => {
  const purpose = createCreditChargePurpose({
    correlationId: "trade;route-fee=forbidden",
    expiresAt: new Date("2026-07-25T12:00:00.000Z"),
    serviceType: "trading-platform",
    pricing: {
      version: "leg-platform;v1",
      components: { "0g": 0n, fmp: 0n, legService: 1_000_000n },
      maximumCharge: 1_000_000n,
    },
  });

  assert.match(purpose, /purpose=leg-platform-service/);
  assert.match(purpose, /correlation=trade%3Broute-fee%3Dforbidden/);
  assert.match(purpose, /price-version=leg-platform%3Bv1/);
  assert.match(purpose, /reservation-expires=1784980800/);
  assert.match(
    purpose,
    /reservation-expires-at=2026-07-25T12:00:00\.000Z/,
  );
  assert.match(purpose, /0g=0\.000000 USDC \(0 micro-USDC\)/);
  assert.match(
    purpose,
    /maximum=1\.000000 USDC \(1000000 micro-USDC\)/,
  );
  assert.ok(purpose.length <= 1_024);
});

test("provider work starts only after confirmed credit and normalized usage settles", async t => {
  const { directory, ledger, prisma, vault } = await setupTest();
  t.after(async () => {
    await prisma.$disconnect();
    rmSync(directory, { force: true, recursive: true });
  });
  const input = await authorizationInput(prisma, "provider-seam-confirmed");
  let providerCalls = 0;
  const provider = async (): Promise<ProviderUsage> => {
    providerCalls += 1;
    return {
      zeroGMicroUsdc: "14000000",
      fmpMicroUsdc: "8000000",
      legServiceMicroUsdc: "1000000",
      reference: "0g:req-provider-seam;fmp:quote-provider-seam",
    };
  };
  vault.confirmationFailures = 1;
  vault.hiddenReservationReads = 1;

  await assert.rejects(
    () => runAuthorizedProvider(ledger, input, provider),
    /pending confirmation/,
  );
  assert.equal(providerCalls, 0);

  assert.deepEqual(await runAuthorizedProvider(ledger, input, provider), {
    status: "settled",
  });
  assert.equal(providerCalls, 1);
  const usage = await prisma.creditUsageRecord.findFirstOrThrow({
    where: { authorization: { correlationId: input.correlationId } },
  });
  assert.equal(usage.zeroGMicroUsdc, 14_000_000n);
  assert.equal(usage.fmpMicroUsdc, 8_000_000n);
  assert.equal(usage.legServiceMicroUsdc, 1_000_000n);
  assert.equal(usage.totalMicroUsdc, 23_000_000n);
  assert.equal(usage.customerChargeMicroUsdc, 19_000_000n);
});

test("rejected credit invokes no provider callback", async t => {
  const { directory, ledger, prisma } = await setupTest({
    pendingDeposits: 90_000_000n,
  });
  t.after(async () => {
    await prisma.$disconnect();
    rmSync(directory, { force: true, recursive: true });
  });
  const input = await authorizationInput(prisma, "provider-seam-rejected");
  let providerCalls = 0;

  await assert.rejects(
    () =>
      runAuthorizedProvider(ledger, input, async () => {
        providerCalls += 1;
        return {
          zeroGMicroUsdc: "1",
          fmpMicroUsdc: "0",
          legServiceMicroUsdc: "0",
          reference: "must-not-run",
        };
      }),
    /Insufficient provider-eligible credit/,
  );
  assert.equal(providerCalls, 0);
});

test("trading accepts only disclosed Leg platform-service charges", async t => {
  const { directory, ledger, prisma, vault } = await setupTest();
  t.after(async () => {
    await prisma.$disconnect();
    rmSync(directory, { force: true, recursive: true });
  });
  const forbiddenPrices: PriceSnapshot[] = [
    {
      version: "trading-zero-g-forbidden",
      components: { "0g": 1n, fmp: 0n, legService: 1_000_000n },
      maximumCharge: 1_000_001n,
    },
    {
      version: "trading-fmp-forbidden",
      components: { "0g": 0n, fmp: 1n, legService: 1_000_000n },
      maximumCharge: 1_000_001n,
    },
  ];
  for (const [index, pricing] of forbiddenPrices.entries()) {
    const input = await authorizationInput(
      prisma,
      `trading-provider-forbidden-${index}`,
      pricing,
      {
        serviceType: "trading-platform",
      },
    );
    await assert.rejects(
      () => authorizeInput(ledger, input),
      /only a disclosed Leg platform-service price/,
    );
  }
  assert.deepEqual(vault.operations, []);

  const pricing: PriceSnapshot = {
    version: "trading-platform-only",
    components: { "0g": 0n, fmp: 0n, legService: 1_000_000n },
    maximumCharge: 1_000_000n,
  };
  const input = await authorizationInput(
    prisma,
    "trading-provider-platform",
    pricing,
    {
      serviceType: "trading-platform",
    },
  );
  const authorization = await authorizeInput(ledger, input);
  for (const components of [
    { "0g": 1n, fmp: 0n, legService: 999_999n },
    { "0g": 0n, fmp: 1n, legService: 999_999n },
  ]) {
    await assert.rejects(
      () =>
        ledger.finalize({
          authorizationId: authorization.authorizationId,
          outcome: "succeeded",
          providerReference: "non-platform-charge",
          components,
        }),
      /only disclosed Leg platform-service usage/,
    );
  }
});

test("public credit routes expose no authorize or finalize handler", () => {
  const routeRoot = new URL("../../app/api/credits/", import.meta.url);
  const routeNames = readdirSync(routeRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  // `config` serves only public wiring (vault address, chain id, settlement token) so the
  // client can reach the right chain; it holds no secret and no ledger handler. The rest of
  // the assertion below is what actually guards the seam.
  assert.deepEqual(routeNames, ["account", "balance", "challenge", "config", "session"]);
  for (const routeName of routeNames) {
    const source = readFileSync(new URL(`${routeName}/route.ts`, routeRoot), "utf8");
    assert.doesNotMatch(source, /\.(authorize|finalize)\s*\(/);
  }
});
