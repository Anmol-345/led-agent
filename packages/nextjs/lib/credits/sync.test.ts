import assert from "node:assert/strict";
import test from "node:test";

import {
  parseCreditSchedulerConfig,
  type CreditRuntimeEnvironment,
} from "./config";
import type { VaultIndexerSyncSummary } from "./indexer";
import { handleSyncRoute } from "./sync";

const testEnvironment: CreditRuntimeEnvironment = {
  CREDIT_APP_ORIGIN: "https://leg.example.test",
  CREDIT_BASE_RPC_URL: "https://base.example.test",
  CREDIT_CONFIRMATIONS: "6",
  CREDIT_DATABASE_PATH: "/private/tmp/leg-credit-sync-test.sqlite",
  CREDIT_DEPLOYMENT_BLOCK: "100",
  CREDIT_SCHEDULER_SECRET: "scheduler-secret-with-at-least-thirty-two-characters",
  CREDIT_VAULT_ADDRESS: "0x1111111111111111111111111111111111111111",
  CREDIT_USDC_ADDRESS: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};
const config = parseCreditSchedulerConfig(testEnvironment);
const summary: VaultIndexerSyncSummary = {
  confirmedHeadBlockNumber: 194n,
  cursorBlockNumber: 194n,
  headBlockNumber: 200n,
  observedLogs: 3,
  projectedEvents: 2,
  reversedEvents: 1,
  scannedFromBlock: 190n,
  scannedToBlock: 200n,
};

function dependencies(options?: {
  fail?: boolean;
  onClient?: () => void;
  onSync?: () => void;
}) {
  return {
    config,
    createIndexer: (_prisma: null) => ({
      sync: async () => {
        options?.onSync?.();
        if (options?.fail) {
          throw new Error("RPC unavailable");
        }
        return summary;
      },
    }),
    getPrismaClient: () => {
      options?.onClient?.();
      return null;
    },
  };
}

test("unauthorized scheduler requests perform no database or RPC work", async () => {
  let clientCalls = 0;
  let syncCalls = 0;
  const deps = dependencies({
    onClient: () => {
      clientCalls += 1;
    },
    onSync: () => {
      syncCalls += 1;
    },
  });

  for (const authHeader of [
    undefined,
    "Bearer wrong-secret",
    `Basic ${config.schedulerSecret}`,
  ]) {
    const response = await handleSyncRoute({ authHeader }, deps);
    assert.equal(response.status, 401);
  }

  assert.equal(clientCalls, 0);
  assert.equal(syncCalls, 0);
});

test("authorized scheduler request awaits sync and returns its real summary", async () => {
  const response = await handleSyncRoute(
    { authHeader: `Bearer ${config.schedulerSecret}` },
    dependencies(),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    confirmedHeadBlockNumber: "194",
    cursorBlockNumber: "194",
    headBlockNumber: "200",
    observedLogs: 3,
    projectedEvents: 2,
    reversedEvents: 1,
    scannedFromBlock: "190",
    scannedToBlock: "200",
    status: "synced",
  });
});

test("scheduler request reports failure and never claims a no-op success", async () => {
  const response = await handleSyncRoute(
    { authHeader: `Bearer ${config.schedulerSecret}` },
    dependencies({ fail: true }),
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Credit indexer sync failed." });
});
