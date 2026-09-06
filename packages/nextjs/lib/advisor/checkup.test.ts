import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseCreditMigrationConfig } from "../credits/config";
import { migrateCreditDatabase } from "../credits/db";
import { CheckupService } from "./checkup";
import { parseAdvisorDatabaseConfig } from "./config";
import { createAdvisorPrismaClient, type AdvisorPrismaClient } from "./db";

const testDirectory = mkdtempSync(join(tmpdir(), "leg-advisor-checkup-"));
const wallet = "0x1111111111111111111111111111111111111111" as const;
const now = new Date("2026-07-26T12:00:00.000Z");

test.after(() => rmSync(testDirectory, { force: true, recursive: true }));

let dbIndex = 0;
async function getTestService(): Promise<{ database: AdvisorPrismaClient; service: CheckupService }> {
  const environment = {
    CREDIT_DATABASE_PATH: join(testDirectory, `advisor-${(dbIndex += 1)}.sqlite`),
    CREDIT_DEPLOYMENT_BLOCK: "100",
  };
  await migrateCreditDatabase(parseCreditMigrationConfig(environment));
  const database = createAdvisorPrismaClient(parseAdvisorDatabaseConfig(environment));
  return { database, service: new CheckupService({ database }) };
}

test("creates and lists wallet checkup subscriptions", async () => {
  const { database, service } = await getTestService();
  try {
    const sub = await service.createSubscription({
      cadence: "weekly",
      assets: [{ chainId: 8453, tokenAddress: "0x3333333333333333333333333333333333333333" }],
      now,
      wallet,
    });

    assert.equal(sub.wallet, wallet);
    assert.equal(sub.state, "active");
    assert.equal(sub.cadence, "weekly");
    assert.equal(sub.assets.length, 1);

    const list = await service.listSubscriptions(wallet);
    assert.ok(list.some(item => item.id === sub.id));
  } finally {
    await database.$disconnect();
  }
});

test("pauses and resumes checkup subscriptions", async () => {
  const { database, service } = await getTestService();
  try {
    const sub = await service.createSubscription({
      cadence: "monthly",
      assets: [],
      now,
      wallet,
    });

    const paused = await service.updateSubscription({
      subscriptionId: sub.id,
      state: "paused",
      wallet,
    });
    assert.equal(paused.state, "paused");

    const resumed = await service.updateSubscription({
      subscriptionId: sub.id,
      state: "active",
      wallet,
    });
    assert.equal(resumed.state, "active");
  } finally {
    await database.$disconnect();
  }
});

test("protected scheduler idempotently creates pending checkups for active subscriptions when due", async () => {
  const { database, service } = await getTestService();
  try {
    const pastTime = new Date("2026-07-10T10:00:00.000Z");
    const sub = await service.createSubscription({
      cadence: "weekly",
      assets: [{ chainId: 8453, tokenAddress: "0x3333333333333333333333333333333333333333" }],
      now: pastTime,
      wallet,
    });

    // Sync when due
    const syncResult1 = await service.syncPendingCheckups({ now });
    assert.ok(syncResult1.syncedCount >= 1);

    const pending = await service.listPendingCheckups(wallet);
    assert.ok(pending.some(p => p.subscriptionId === sub.id));

    // Idempotent check — running sync again does not duplicate pending checkups
    const syncResult2 = await service.syncPendingCheckups({ now });
    assert.equal(syncResult2.syncedCount, 0);
  } finally {
    await database.$disconnect();
  }
});
