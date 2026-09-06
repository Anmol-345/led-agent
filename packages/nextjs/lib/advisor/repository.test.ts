import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { Address } from "viem";

import { parseCreditMigrationConfig } from "../credits/config";
import { migrateCreditDatabase } from "../credits/db";
import { parseAdvisorDatabaseConfig } from "./config";
import { createAdvisorPrismaClient, type AdvisorPrismaClient } from "./db";
import type { AdvisorQuote, CitedResearch } from "./orchestrator";
import { createRecommendation } from "./recommendation";
import { AdvisorRepository } from "./repository";

const testDirectory = mkdtempSync(join(tmpdir(), "leg-advisor-repository-"));
const wallet: Address = "0x1111111111111111111111111111111111111111";
const otherWallet: Address = "0x2222222222222222222222222222222222222222";
const correlationId = "advisor-0199c0de-0000-4000-8000-000000000001";
const startedAt = new Date("2026-07-26T12:00:00.000Z");
const completedAt = new Date("2026-07-26T12:00:30.000Z");
const now = new Date("2026-07-26T12:10:00.000Z");

test.after(() => rmSync(testDirectory, { force: true, recursive: true }));

const quote: AdvisorQuote = {
  completionTokenAllowance: 1500,
  contextHash: "a".repeat(64),
  correlationId,
  expiresAt: new Date("2026-07-26T12:05:00.000Z"),
  philosophyVersion: "v1",
  pricing: {
    components: { "0g": 86n, fmp: 2_500n, legService: 5_000n },
    maximumCharge: 7_586n,
    version: "advisor-2026-07",
  },
  promptTokenBudget: 24_000,
  routerModel: "leg-pinned-model",
  serviceType: "advisor",
  source: "web",
  wallet,
};

const research: CitedResearch = {
  calculations: [
    {
      calculationId: "00000000-0000-4000-8000-00000000000a",
      formulaVersion: "GrahamNumber.v1",
      inputs: [{ field: "earningsPerShare", period: "2026-Q1", value: "4.2" }],
      method: "graham-number",
      result: "41.69892084",
      unavailableReason: null,
    },
    {
      calculationId: "00000000-0000-4000-8000-00000000000b",
      formulaVersion: "OwnerEarnings.v1",
      inputs: [],
      method: "owner-earnings",
      result: null,
      unavailableReason: "missing-input:ownerEarnings",
    },
  ],
  facts: [
    {
      field: "earningsPerShare",
      observedAt: new Date("2026-03-31T00:00:00.000Z"),
      period: "2026-Q1",
      retrievedAt: startedAt,
      source: "fmp",
      symbol: "EXMP",
      value: "4.2",
    },
  ],
  holdings: [],
  interpretation: "Trades below its Graham number.",
  limitations: ["Educational research only."],
  philosophyVersion: "v1",
  principles: [],
};

let databaseIndex = 0;

async function repository(): Promise<{ database: AdvisorPrismaClient; subject: AdvisorRepository }> {
  const environment = {
    CREDIT_DATABASE_PATH: join(testDirectory, `advisor-${(databaseIndex += 1)}.sqlite`),
    CREDIT_DEPLOYMENT_BLOCK: "100",
  };
  await migrateCreditDatabase(parseCreditMigrationConfig(environment));
  const database = createAdvisorPrismaClient(parseAdvisorDatabaseConfig(environment));
  return { database, subject: new AdvisorRepository({ database }) };
}

test("records a quote, run, citations, and reproducible calculations", async () => {
  const { database, subject } = await repository();
  try {
    await subject.recordQuote({ quote });
    await subject.startRun({ correlationId, runId: "run-1", source: "web", startedAt, wallet });
    await subject.completeRun({
      calculations: research.calculations,
      citations: research.facts,
      completedAt,
      correlationId,
      runId: "run-1",
      usage: { completionTokens: 800, promptTokens: 12_000 },
    });

    const run = await database.advisorRun.findUniqueOrThrow({ where: { id: "run-1" } });
    assert.equal(run.status, "COMPLETED");
    assert.equal(run.failureCode, null);
    assert.equal(run.promptTokens, 12_000);
    assert.equal(run.wallet, wallet);

    const storedQuote = await database.advisorQuote.findUniqueOrThrow({ where: { correlationId } });
    assert.equal(storedQuote.maximumChargeMicroUsdc, 7_586n);
    assert.equal(storedQuote.contextHash, quote.contextHash);

    assert.equal(await database.advisorCitation.count(), 1);
    const graham = await database.advisorCalculation.findUniqueOrThrow({
      where: { id: "00000000-0000-4000-8000-00000000000a" },
    });
    assert.equal(graham.resultDecimal, "41.69892084");
    assert.equal(graham.unavailableReason, null);

    const unavailable = await database.advisorCalculation.findUniqueOrThrow({
      where: { id: "00000000-0000-4000-8000-00000000000b" },
    });
    assert.equal(unavailable.resultDecimal, null);
    assert.equal(unavailable.unavailableReason, "missing-input:ownerEarnings");
  } finally {
    await database.$disconnect();
  }
});

test("a failed run is recorded with its code and no fabricated result", async () => {
  const { database, subject } = await repository();
  try {
    await subject.recordQuote({ quote });
    await subject.startRun({ correlationId, runId: "run-2", source: "connector", startedAt, wallet });
    await subject.failRun({ code: "provider", completedAt, correlationId, runId: "run-2" });

    const run = await database.advisorRun.findUniqueOrThrow({ where: { id: "run-2" } });
    assert.equal(run.status, "FAILED");
    assert.equal(run.failureCode, "provider");
    assert.equal(run.source, "CONNECTOR");
    assert.equal(await database.advisorCitation.count(), 0);
    assert.equal(await database.advisorCalculation.count(), 0);
  } finally {
    await database.$disconnect();
  }
});

test("a run cannot exist without the quote that priced it", async () => {
  const { database, subject } = await repository();
  try {
    await assert.rejects(
      () => subject.startRun({ correlationId, runId: "run-3", source: "web", startedAt, wallet }),
      /quote/i,
    );
  } finally {
    await database.$disconnect();
  }
});

test("stores and revalidates the exact recommendation artifact", async () => {
  const { database, subject } = await repository();
  try {
    await subject.recordQuote({ quote });
    await subject.startRun({ correlationId, runId: "run-4", source: "web", startedAt, wallet });
    await subject.completeRun({
      calculations: research.calculations,
      citations: research.facts,
      completedAt,
      correlationId,
      runId: "run-4",
      usage: { completionTokens: 800, promptTokens: 12_000 },
    });

    const artifact = createRecommendation({
      asset: { address: "0x3333333333333333333333333333333333333333", chainId: 8453, symbol: "xEXMP" },
      generatedAt: completedAt,
      research,
      risks: "Leverage and customer concentration.",
      runId: "run-4",
      stance: "undervalued",
      thesis: "Price sits below a conservative Graham number.",
      ttlSeconds: 3_600,
      wallet,
    });
    await subject.saveRecommendation(artifact);

    const usable = await subject.recommendationHandoff({
      now,
      recommendationId: artifact.id,
      wallet,
    });
    assert.equal(usable.kind, "usable");
    if (usable.kind !== "usable") return;
    assert.equal(usable.recommendation.id, artifact.id);
    assert.equal(usable.recommendation.stance, "undervalued");
    assert.equal(usable.recommendation.assetChainId, 8453);
    assert.equal(usable.recommendation.version, "ValueInvestingRecommendation.v1");
    assert.deepEqual(usable.recommendation.calculations, artifact.calculations);

    assert.deepEqual(
      await subject.recommendationHandoff({ now, recommendationId: artifact.id, wallet: otherWallet }),
      { kind: "rejected", reason: "wrong-wallet" },
    );
    assert.deepEqual(
      await subject.recommendationHandoff({
        now: new Date("2026-07-26T14:00:00.000Z"),
        recommendationId: artifact.id,
        wallet,
      }),
      { kind: "rejected", reason: "expired" },
    );
    assert.deepEqual(
      await subject.recommendationHandoff({ now, recommendationId: "missing", wallet }),
      { kind: "rejected", reason: "malformed" },
    );
  } finally {
    await database.$disconnect();
  }
});

test("persisted advisor records carry no prompt, signature, or provider secret", async () => {
  const { database, subject } = await repository();
  try {
    await subject.recordQuote({ quote });
    await subject.startRun({ correlationId, runId: "run-5", source: "web", startedAt, wallet });
    await subject.completeRun({
      calculations: research.calculations,
      citations: research.facts,
      completedAt,
      correlationId,
      runId: "run-5",
      usage: { completionTokens: 800, promptTokens: 12_000 },
    });

    const serialized = JSON.stringify(
      {
        calculations: await database.advisorCalculation.findMany(),
        citations: await database.advisorCitation.findMany(),
        quotes: await database.advisorQuote.findMany(),
        runs: await database.advisorRun.findMany(),
      },
      (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
    );

    assert.doesNotMatch(serialized, /Trades below its Graham number/, "no interpretation prose");
    assert.doesNotMatch(serialized, /Educational research only/, "no rendered prompt");
    assert.doesNotMatch(serialized, /0x[0-9a-f]{100,}/i, "no wallet signature");
  } finally {
    await database.$disconnect();
  }
});
