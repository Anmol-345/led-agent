import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  parseCreditAccountConfig,
  parseCreditBillingConfig,
  parseCreditDatabaseConfig,
  parseCreditMigrationConfig,
  parseCreditRuntimeConfig,
  parseCreditSchedulerConfig,
  type CreditRuntimeEnvironment,
} from "./config";
import { DEPLOYMENT } from "../deployment";

const testDirectory = mkdtempSync(join(tmpdir(), "leg-credit-config-"));
const testEnvironment: CreditRuntimeEnvironment = {
  CREDIT_APP_ORIGIN: "https://app.leg.investments",
  CREDIT_BASE_RPC_URL: "https://base.example.test",
  CREDIT_BILLING_SIGNER_PRIVATE_KEY: `0x${"1".repeat(64)}`,
  CREDIT_CONFIRMATIONS: "12",
  CREDIT_DATABASE_PATH: join(testDirectory, "credits.sqlite"),
  CREDIT_DEPLOYMENT_BLOCK: "321",
  CREDIT_SCHEDULER_SECRET: "scheduler-secret-with-at-least-thirty-two-characters",
  CREDIT_VAULT_ADDRESS: "0x1111111111111111111111111111111111111111",
  CREDIT_USDC_ADDRESS: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  FMP_PRODUCTION_LICENSE_CONFIRMED: "true",
};

test.after(() => rmSync(testDirectory, { force: true, recursive: true }));

test("accepts complete, server-only credit runtime configuration", () => {
  const config = parseCreditRuntimeConfig(testEnvironment);

  // Vault chain and settlement token follow the deployment target: Base + native USDC on
  // mainnet, Sepolia + the mock supplied via CREDIT_USDC_ADDRESS on testnet.
  assert.equal(config.baseChainId, DEPLOYMENT.vaultChainId);
  assert.equal(config.appOrigin, "https://app.leg.investments");
  assert.equal(
    config.usdcAddress,
    DEPLOYMENT.vaultUsdcAddress ?? testEnvironment.CREDIT_USDC_ADDRESS,
  );
  assert.equal(config.confirmations, 12);
  assert.equal(config.creditDeploymentBlock, 321n);
  assert.equal(config.databasePath, testEnvironment.CREDIT_DATABASE_PATH);
  assert.equal(config.databaseUrl, `file:${testEnvironment.CREDIT_DATABASE_PATH}`);
});

test("loads account configuration without billing, scheduler, or FMP secrets", () => {
  const config = parseCreditAccountConfig({
    CREDIT_APP_ORIGIN: testEnvironment.CREDIT_APP_ORIGIN,
    CREDIT_BASE_RPC_URL: testEnvironment.CREDIT_BASE_RPC_URL,
    CREDIT_CONFIRMATIONS: testEnvironment.CREDIT_CONFIRMATIONS,
    CREDIT_DATABASE_PATH: testEnvironment.CREDIT_DATABASE_PATH,
    CREDIT_DEPLOYMENT_BLOCK: testEnvironment.CREDIT_DEPLOYMENT_BLOCK,
    CREDIT_VAULT_ADDRESS: testEnvironment.CREDIT_VAULT_ADDRESS,
    CREDIT_USDC_ADDRESS: testEnvironment.CREDIT_USDC_ADDRESS,
  });

  assert.equal(config.vaultAddress, testEnvironment.CREDIT_VAULT_ADDRESS);
  assert.equal("billingSignerPrivateKey" in config, false);
  assert.equal("schedulerSecret" in config, false);
  assert.equal("fmpProductionLicenseConfirmed" in config, false);
});

test("loads offline database configuration without web3 runtime settings", () => {
  const config = parseCreditDatabaseConfig({
    CREDIT_DATABASE_PATH: testEnvironment.CREDIT_DATABASE_PATH,
  });

  assert.equal(config.databasePath, testEnvironment.CREDIT_DATABASE_PATH);
  assert.equal(config.databaseUrl, `file:${testEnvironment.CREDIT_DATABASE_PATH}`);
});

test("loads migration configuration with only the database and deployment block", () => {
  const config = parseCreditMigrationConfig({
    CREDIT_DATABASE_PATH: testEnvironment.CREDIT_DATABASE_PATH,
    CREDIT_DEPLOYMENT_BLOCK: "321",
  });

  assert.equal(config.databasePath, testEnvironment.CREDIT_DATABASE_PATH);
  assert.equal(config.creditDeploymentBlock, 321n);
});

test("loads billing and scheduler configuration at their own boundaries", () => {
  const unlicensedBilling = parseCreditBillingConfig({
    ...testEnvironment,
    FMP_PRODUCTION_LICENSE_CONFIRMED: "false",
  });
  const scheduler = parseCreditSchedulerConfig(testEnvironment);

  assert.equal(unlicensedBilling.fmpProductionLicenseConfirmed, false);
  assert.equal(
    unlicensedBilling.billingSignerPrivateKey,
    testEnvironment.CREDIT_BILLING_SIGNER_PRIVATE_KEY,
  );
  assert.equal(scheduler.schedulerSecret, testEnvironment.CREDIT_SCHEDULER_SECRET);
  assert.equal("billingSignerPrivateKey" in scheduler, false);
});

test("rejects missing, unsafe, public, and invalid credit runtime configuration", () => {
  assert.throws(() =>
    parseCreditRuntimeConfig({
      ...testEnvironment,
      CREDIT_DATABASE_PATH: undefined,
    }),
  );
  assert.throws(() =>
    parseCreditRuntimeConfig({
      ...testEnvironment,
      CREDIT_DATABASE_PATH: ":memory:",
    }),
  );
  assert.throws(() =>
    parseCreditRuntimeConfig({
      ...testEnvironment,
      CREDIT_DATABASE_PATH: join(testDirectory, "missing", "credits.sqlite"),
    }),
  );
  assert.throws(() =>
    parseCreditRuntimeConfig({
      ...testEnvironment,
      CREDIT_DEPLOYMENT_BLOCK: "0",
    }),
  );
  assert.throws(() =>
    parseCreditRuntimeConfig({
      ...testEnvironment,
      CREDIT_DEPLOYMENT_BLOCK: "-1",
    }),
  );
  assert.throws(() =>
    parseCreditRuntimeConfig({
      ...testEnvironment,
      CREDIT_CONFIRMATIONS: "0",
    }),
  );
  assert.throws(() =>
    parseCreditRuntimeConfig({
      ...testEnvironment,
      CREDIT_BASE_RPC_URL: "not a URL",
    }),
  );
  assert.throws(() =>
    parseCreditRuntimeConfig({
      ...testEnvironment,
      CREDIT_BILLING_SIGNER_PRIVATE_KEY: "invalid",
    }),
  );
  assert.throws(() =>
    parseCreditRuntimeConfig({
      ...testEnvironment,
      CREDIT_BILLING_SIGNER_PRIVATE_KEY: `0x${"f".repeat(64)}`,
    }),
  );
  assert.throws(() =>
    parseCreditRuntimeConfig({
      ...testEnvironment,
      CREDIT_SCHEDULER_SECRET: "short",
    }),
  );
  assert.throws(() =>
    parseCreditRuntimeConfig({
      ...testEnvironment,
      CREDIT_VAULT_ADDRESS: "0x0000000000000000000000000000000000000000",
    }),
  );
  assert.throws(() =>
    parseCreditRuntimeConfig({
      ...testEnvironment,
      NEXT_PUBLIC_CREDIT_BILLING_SIGNER_PRIVATE_KEY: "leaked",
    }),
  );
  assert.throws(() =>
    parseCreditRuntimeConfig({
      ...testEnvironment,
      NEXT_PUBLIC_FMP_API_KEY: "leaked",
    }),
  );
});

test("accepts loopback HTTP locally and rejects unsafe app origins and RPC URLs", () => {
  const local = parseCreditAccountConfig({
    ...testEnvironment,
    CREDIT_APP_ORIGIN: "http://localhost:3000",
    CREDIT_BASE_RPC_URL: "http://127.0.0.1:8545",
  });
  assert.equal(local.appOrigin, "http://localhost:3000");
  assert.equal(
    parseCreditAccountConfig({
      ...testEnvironment,
      CREDIT_APP_ORIGIN: "http://localhost:3000",
      CREDIT_BASE_RPC_URL: "http://[::1]:8545",
    }).baseRpcUrl,
    "http://[::1]:8545",
  );

  for (const appOrigin of [
    "http://example.com",
    "http://[::1]:3000",
    "https://app.leg.investments/path",
    "https://user:pass@app.leg.investments",
    "https://app.leg.investments?query=1",
    "https://app.leg.investments/#fragment",
  ]) {
    assert.throws(() =>
      parseCreditAccountConfig({
        ...testEnvironment,
        CREDIT_APP_ORIGIN: appOrigin,
      }),
    );
  }
  assert.throws(() =>
    parseCreditAccountConfig({
      ...testEnvironment,
      CREDIT_BASE_RPC_URL: "http://base.example.test",
    }),
  );
  assert.throws(() =>
    parseCreditAccountConfig({
      ...testEnvironment,
      CREDIT_APP_ORIGIN: "http://localhost:3000",
      NODE_ENV: "production",
    }),
  );
});

test("rejects Vercel and temporary production credit storage", () => {
  assert.throws(
    () =>
      parseCreditAccountConfig({
        ...testEnvironment,
        NODE_ENV: "production",
        VERCEL: "1",
      }),
    /persistent Node host/,
  );
  assert.throws(
    () =>
      parseCreditAccountConfig({
        ...testEnvironment,
        CREDIT_DATABASE_PATH: join(tmpdir(), "production-credits.sqlite"),
        NODE_ENV: "production",
      }),
    /temporary database path/,
  );
});

test("rejects unsupported Node versions before accepting credit configuration", () => {
  assert.throws(() => parseCreditRuntimeConfig(testEnvironment, "24.10.9"));
});
