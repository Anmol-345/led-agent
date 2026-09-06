import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  parseCreditMigrationConfig,
  type CreditRuntimeEnvironment,
} from "../credits/config";
import {
  backupCreditDatabase,
  migrateCreditDatabase,
  restoreCreditDatabase,
} from "../credits/db";
import { parseAdvisorDatabaseConfig, type AdvisorDatabaseConfig } from "./config";
import {
  ADVISOR_MIGRATION_NAME,
  createAdvisorPrismaClient,
  verifyAdvisorDatabase,
  type AdvisorPrismaClient,
} from "./db";

const testDirectory = mkdtempSync(join(tmpdir(), "leg-advisor-db-"));
const wallet = "0x1111111111111111111111111111111111111111";
const otherWallet = "0x2222222222222222222222222222222222222222";

test.after(() => rmSync(testDirectory, { force: true, recursive: true }));

function environment(fileName: string): CreditRuntimeEnvironment {
  return {
    CREDIT_DATABASE_PATH: join(testDirectory, fileName),
    CREDIT_DEPLOYMENT_BLOCK: "100",
  };
}

function advisorConfig(fileName: string): AdvisorDatabaseConfig {
  return parseAdvisorDatabaseConfig(environment(fileName));
}

async function migratedAdvisorDatabase(fileName: string): Promise<AdvisorDatabaseConfig> {
  await migrateCreditDatabase(parseCreditMigrationConfig(environment(fileName)));
  return advisorConfig(fileName);
}

async function withAdvisorDatabase(
  config: AdvisorDatabaseConfig,
  use: (database: AdvisorPrismaClient) => Promise<void>,
): Promise<void> {
  const database = createAdvisorPrismaClient(config);
  try {
    await use(database);
  } finally {
    await database.$disconnect();
  }
}

async function seedAdvisorRun(
  database: AdvisorPrismaClient,
  suffix: string,
  runWallet = wallet,
): Promise<void> {
  await database.advisorQuote.create({
    data: {
      completionTokenAllowance: 1500,
      contextHash: `context-hash-${suffix}`,
      correlationId: `correlation-${suffix}`,
      expiresAt: new Date("2026-07-26T12:05:00.000Z"),
      id: `quote-${suffix}`,
      maximumChargeMicroUsdc: 10_000n,
      philosophyVersion: "v1",
      price0gMicroUsdc: 2_500n,
      priceFmpMicroUsdc: 2_500n,
      priceLegServiceMicroUsdc: 5_000n,
      priceVersion: "advisor-2026-07",
      promptTokenBudget: 24_000,
      routerModel: "leg-pinned-model",
      source: "WEB",
      wallet: runWallet,
    },
  });
  await database.advisorRun.create({
    data: {
      completedAt: new Date("2026-07-26T12:02:00.000Z"),
      completionTokens: 900,
      correlationId: `correlation-${suffix}`,
      id: `run-${suffix}`,
      philosophyVersion: "v1",
      priceVersion: "advisor-2026-07",
      promptTokens: 12_000,
      quoteId: `quote-${suffix}`,
      routerModel: "leg-pinned-model",
      source: "WEB",
      startedAt: new Date("2026-07-26T12:00:00.000Z"),
      status: "COMPLETED",
      wallet: runWallet,
    },
  });
  await database.advisorCitation.create({
    data: {
      id: `citation-${suffix}`,
      observedAt: new Date("2026-03-31T00:00:00.000Z"),
      periodLabel: "FY2025",
      retrievedAt: new Date("2026-07-26T11:59:00.000Z"),
      runId: `run-${suffix}`,
      source: "fmp",
      symbol: "EXMP",
    },
  });
  await database.advisorCalculation.create({
    data: {
      citationIdsJson: JSON.stringify([`citation-${suffix}`]),
      createdAt: new Date("2026-07-26T12:01:00.000Z"),
      formulaVersion: "GrahamNumber.v1",
      id: `calculation-${suffix}`,
      inputsJson: JSON.stringify({ bookValuePerShare: "18.40", earningsPerShare: "4.20" }),
      method: "graham-number",
      resultDecimal: "41.70",
      runId: `run-${suffix}`,
    },
  });
  await database.advisorRecommendation.create({
    data: {
      artifactVersion: "ValueInvestingRecommendation.v1",
      assetAddress: "0x3333333333333333333333333333333333333333",
      assetChainId: 8453n,
      assetSymbol: "xEXMP",
      calculationIdsJson: JSON.stringify([`calculation-${suffix}`]),
      evidenceJson: JSON.stringify([`citation-${suffix}`]),
      expiresAt: new Date("2026-07-26T13:00:00.000Z"),
      generatedAt: new Date("2026-07-26T12:02:00.000Z"),
      id: `recommendation-${suffix}`,
      risks: "Leverage and customer concentration.",
      runId: `run-${suffix}`,
      stance: "UNDERVALUED",
      thesis: "Price sits below a conservative Graham number.",
      wallet: runWallet,
    },
  });
}

async function seedCheckup(
  database: AdvisorPrismaClient,
  suffix: string,
  dueAt: Date,
): Promise<void> {
  await database.advisorCheckupSubscription.create({
    data: {
      cadence: "MONTHLY",
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      id: `subscription-${suffix}`,
      nextDueAt: dueAt,
      state: "ACTIVE",
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
      wallet,
    },
  });
  await database.advisorCheckupAsset.create({
    data: {
      chainId: 8453n,
      id: `asset-${suffix}`,
      subscriptionId: `subscription-${suffix}`,
      tokenAddress: "0x3333333333333333333333333333333333333333",
    },
  });
  await database.advisorCheckup.create({
    data: {
      createdAt: dueAt,
      dueAt,
      id: `checkup-${suffix}`,
      state: "PENDING",
      subscriptionId: `subscription-${suffix}`,
      wallet,
    },
  });
}

test("the shared forward-only sequence applies the advisor migration", async () => {
  const config = await migratedAdvisorDatabase("migrated.sqlite");

  await verifyAdvisorDatabase(config);
  assert.match(ADVISOR_MIGRATION_NAME, /_initial_advisor_schema$/);
});

test("an unmigrated database cannot serve advisor persistence", async () => {
  await assert.rejects(
    () => verifyAdvisorDatabase(advisorConfig("unmigrated.sqlite")),
    /advisor/i,
  );
});

test("advisor records keep correlation, wallet, and due-time uniqueness", async () => {
  const config = await migratedAdvisorDatabase("uniqueness.sqlite");

  await withAdvisorDatabase(config, async database => {
    await seedAdvisorRun(database, "a");
    const dueAt = new Date("2026-08-01T00:00:00.000Z");
    await seedCheckup(database, "a", dueAt);

    await assert.rejects(
      () =>
        database.advisorQuote.create({
          data: {
            completionTokenAllowance: 1500,
            contextHash: "context-hash-duplicate",
            correlationId: "correlation-a",
            expiresAt: new Date("2026-07-26T12:05:00.000Z"),
            id: "quote-duplicate",
            maximumChargeMicroUsdc: 10_000n,
            philosophyVersion: "v1",
            price0gMicroUsdc: 2_500n,
            priceFmpMicroUsdc: 2_500n,
            priceLegServiceMicroUsdc: 5_000n,
            priceVersion: "advisor-2026-07",
            promptTokenBudget: 24_000,
            routerModel: "leg-pinned-model",
            source: "WEB",
            wallet: otherWallet,
          },
        }),
      /correlation_id/i,
    );

    await assert.rejects(
      () =>
        database.advisorCheckup.create({
          data: {
            createdAt: dueAt,
            dueAt,
            id: "checkup-duplicate",
            state: "PENDING",
            subscriptionId: "subscription-a",
            wallet,
          },
        }),
      /due_at|unique/i,
    );
  });
});

test("the database refuses an invented calculation and an unbilled completed checkup", async () => {
  const config = await migratedAdvisorDatabase("constraints.sqlite");

  await withAdvisorDatabase(config, async database => {
    await seedAdvisorRun(database, "b");
    await seedCheckup(database, "b", new Date("2026-08-01T00:00:00.000Z"));

    // Neither a result nor a named unavailable reason.
    await assert.rejects(
      () =>
        database.advisorCalculation.create({
          data: {
            citationIdsJson: "[]",
            createdAt: new Date("2026-07-26T12:01:00.000Z"),
            formulaVersion: "GrahamNumber.v1",
            id: "calculation-empty",
            inputsJson: "{}",
            method: "graham-number",
            runId: "run-b",
          },
        }),
      /constraint/i,
    );

    // Both a result and an unavailable reason.
    await assert.rejects(
      () =>
        database.advisorCalculation.create({
          data: {
            citationIdsJson: "[]",
            createdAt: new Date("2026-07-26T12:01:00.000Z"),
            formulaVersion: "GrahamNumber.v1",
            id: "calculation-both",
            inputsJson: "{}",
            method: "graham-number",
            resultDecimal: "41.70",
            runId: "run-b",
            unavailableReason: "missing-book-value",
          },
        }),
      /constraint/i,
    );

    // A completed checkup must reference the paid advisor run that produced it.
    await assert.rejects(
      () =>
        database.advisorCheckup.update({
          data: { resolvedAt: new Date("2026-08-01T01:00:00.000Z"), state: "COMPLETED" },
          where: { id: "checkup-b" },
        }),
      /constraint/i,
    );

    await assert.rejects(
      () =>
        database.advisorRecommendation.create({
          data: {
            artifactVersion: "ValueInvestingRecommendation.v2",
            assetAddress: "0x3333333333333333333333333333333333333333",
            assetChainId: 8453n,
            calculationIdsJson: "[]",
            evidenceJson: "[]",
            expiresAt: new Date("2026-07-26T13:00:00.000Z"),
            generatedAt: new Date("2026-07-26T12:02:00.000Z"),
            id: "recommendation-unsupported",
            risks: "n/a",
            runId: "run-b",
            stance: "UNDERVALUED",
            thesis: "n/a",
            wallet,
          },
        }),
      /constraint/i,
    );
  });
});

test("advisor records survive the host-local backup and restore rehearsal", async () => {
  const config = await migratedAdvisorDatabase("rehearsal.sqlite");
  await withAdvisorDatabase(config, database => seedAdvisorRun(database, "c"));
  await withAdvisorDatabase(config, database =>
    seedCheckup(database, "c", new Date("2026-08-01T00:00:00.000Z")),
  );

  const backupPath = join(testDirectory, "rehearsal.backup.sqlite");
  await backupCreditDatabase(config, backupPath);

  const restored = advisorConfig("rehearsal.restored.sqlite");
  await restoreCreditDatabase(backupPath, restored);
  await verifyAdvisorDatabase(restored);

  await withAdvisorDatabase(restored, async database => {
    const run = await database.advisorRun.findUniqueOrThrow({ where: { id: "run-c" } });
    assert.equal(run.correlationId, "correlation-c");
    assert.equal(run.wallet, wallet);

    const calculation = await database.advisorCalculation.findUniqueOrThrow({
      where: { id: "calculation-c" },
    });
    assert.equal(calculation.resultDecimal, "41.70");
    assert.equal(calculation.formulaVersion, "GrahamNumber.v1");

    const recommendation = await database.advisorRecommendation.findUniqueOrThrow({
      where: { id: "recommendation-c" },
    });
    assert.equal(recommendation.artifactVersion, "ValueInvestingRecommendation.v1");
    assert.equal(recommendation.assetChainId, 8453n);

    const checkup = await database.advisorCheckup.findUniqueOrThrow({ where: { id: "checkup-c" } });
    assert.equal(checkup.state, "PENDING");
    assert.equal(checkup.runId, null);

    assert.equal(await database.advisorCitation.count(), 1);
    assert.equal(await database.advisorCheckupAsset.count(), 1);
  });
});
