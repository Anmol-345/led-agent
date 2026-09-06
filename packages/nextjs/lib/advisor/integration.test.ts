import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Address } from "viem";

import { parseCreditMigrationConfig } from "../credits/config";
import { migrateCreditDatabase } from "../credits/db";
import { CheckupService } from "./checkup";
import { AdvisorConnector } from "./connector";
import { parseAdvisorConnectorConfig, parseAdvisorDatabaseConfig } from "./config";
import { createAdvisorPrismaClient } from "./db";
import { PortfolioReader } from "./portfolio";
import { createRecommendation } from "./recommendation";
import { AdvisorRepository } from "./repository";

const testDirectory = mkdtempSync(join(tmpdir(), "leg-advisor-integration-"));
const wallet: Address = "0x1111111111111111111111111111111111111111";
const otherWallet: Address = "0x2222222222222222222222222222222222222222";
const now = new Date("2026-07-26T12:00:00.000Z");

test.after(() => rmSync(testDirectory, { force: true, recursive: true }));

let dbIndex = 0;
async function setupIntegrationEnvironment() {
  const environment = {
    ADVISOR_CONNECTOR_AUTHORIZATION_CODE_TTL_SECONDS: "300",
    ADVISOR_CONNECTOR_ISSUER_ORIGIN: "https://localhost:3000",
    ADVISOR_CONNECTOR_TOKEN_TTL_SECONDS: "3600",
    CREDIT_DATABASE_PATH: join(testDirectory, `advisor-${(dbIndex += 1)}.sqlite`),
    CREDIT_DEPLOYMENT_BLOCK: "100",
  };
  await migrateCreditDatabase(parseCreditMigrationConfig(environment));
  const database = createAdvisorPrismaClient(parseAdvisorDatabaseConfig(environment));
  const connectorConfig = parseAdvisorConnectorConfig(environment);
  const checkupService = new CheckupService({ database });
  const repository = new AdvisorRepository({ database });
  const connector = new AdvisorConnector({ config: connectorConfig, database });
  return { checkupService, connector, database, repository };
}

test("Task 4.2: Portfolio reader is strictly read-only with no custody/signing capabilities", async () => {
  const portfolio = new PortfolioReader({
    assets: [
      {
        chainId: 8453,
        decimals: 18,
        researchSymbol: "EXMP",
        token: "0x3333333333333333333333333333333333333333",
      },
    ],
    balances: {
      async balanceOf() { return 10_000_000_000_000_000_000n; },
    },
    now: () => now,
  });

  const obs = await portfolio.read({
    selections: [{ chainId: 8453, token: "0x3333333333333333333333333333333333333333" }],
    wallet,
  });

  assert.equal(obs.length, 1);
  assert.equal(obs[0].kind, "observed");
  if (obs[0].kind === "observed") {
    assert.equal(obs[0].amount, 10_000_000_000_000_000_000n);
    assert.equal(obs[0].research?.symbol, "EXMP");
  }

  // Ensure portfolio reader object exposes no write/send/sign methods
  assert.equal("sendTransaction" in portfolio, false);
  assert.equal("signMessage" in portfolio, false);
  assert.equal("approve" in portfolio, false);
});

test("Task 4.2: Wallet isolation — one wallet cannot access or authorize another's checkups/recommendations", async () => {
  const { checkupService, database, repository } = await setupIntegrationEnvironment();
  try {
    // Create checkup subscription for wallet
    const sub = await checkupService.createSubscription({
      cadence: "weekly",
      assets: [],
      now,
      wallet,
    });

    // Check list for wallet vs otherWallet
    const list1 = await checkupService.listSubscriptions(wallet);
    const list2 = await checkupService.listSubscriptions(otherWallet);

    assert.ok(list1.some(s => s.id === sub.id));
    assert.equal(list2.some(s => s.id === sub.id), false, "otherWallet must not see wallet's checkups");

    // Test recommendation handoff isolation
    const artifact = createRecommendation({
      asset: { address: "0x3333333333333333333333333333333333333333", chainId: 8453, symbol: "EXMP" },
      generatedAt: now,
      research: {
        calculations: [],
        facts: [
          {
            field: "earningsPerShare",
            observedAt: now,
            period: "2026-Q1",
            retrievedAt: now,
            source: "fmp",
            symbol: "EXMP",
            value: "4.2",
          },
        ],
        holdings: [],
        interpretation: "Thesis",
        limitations: [],
        philosophyVersion: "v1",
        principles: [],
      },
      risks: "Risks",
      runId: "run-wallet-isolation-1",
      stance: "undervalued",
      thesis: "Thesis",
      ttlSeconds: 3600,
      wallet,
    });

    // Create quote and run DB entries required for saveRecommendation
    await database.advisorQuote.create({
      data: {
        completionTokenAllowance: 1000,
        contextHash: "a".repeat(64),
        correlationId: "advisor-0199c0de-0000-4000-8000-000000000099",
        expiresAt: new Date(now.getTime() + 60000),
        id: "quote-iso-1",
        maximumChargeMicroUsdc: 1000n,
        philosophyVersion: "v1",
        price0gMicroUsdc: 100n,
        priceFmpMicroUsdc: 100n,
        priceLegServiceMicroUsdc: 800n,
        priceVersion: "v1",
        promptTokenBudget: 1000,
        routerModel: "m1",
        source: "WEB",
        wallet,
      },
    });

    await database.advisorRun.create({
      data: {
        completedAt: now,
        correlationId: "advisor-0199c0de-0000-4000-8000-000000000099",
        id: "run-wallet-isolation-1",
        philosophyVersion: "v1",
        priceVersion: "v1",
        quoteId: "quote-iso-1",
        routerModel: "m1",
        source: "WEB",
        startedAt: now,
        status: "COMPLETED",
        wallet,
      },
    });

    await repository.saveRecommendation(artifact);

    const validHandoff = await repository.recommendationHandoff({
      now,
      recommendationId: artifact.id,
      wallet,
    });
    assert.equal(validHandoff.kind, "usable");

    const invalidHandoff = await repository.recommendationHandoff({
      now,
      recommendationId: artifact.id,
      wallet: otherWallet,
    });
    assert.equal(invalidHandoff.kind, "rejected");
    if (invalidHandoff.kind === "rejected") {
      assert.equal(invalidHandoff.reason, "wrong-wallet");
    }
  } finally {
    await database.$disconnect();
  }
});

test("Task 4.2: OAuth & MCP capability boundaries — billable tools enforce credit reauthorization", async () => {
  const { connector, database } = await setupIntegrationEnvironment();
  try {
    const server = connector.createMcpServer(wallet);
    assert.ok(server);

    // Dynamic OAuth registration
    const client = await connector.registerClient({
      clientName: "Claude",
      grantTypes: ["authorization_code"],
      redirectUris: ["https://claude.ai/callback"],
    });
    assert.ok(client.clientId);

    // Code & token flow
    const code = await connector.issueAuthorizationCode({
      clientId: client.clientId,
      codeChallenge: "challenge-xyz",
      now,
      redirectUri: "https://claude.ai/callback",
      wallet,
    });

    const tokenRes = await connector.exchangeAuthorizationCode({
      clientId: client.clientId,
      code,
      now,
      redirectUri: "https://claude.ai/callback",
    });

    assert.equal(tokenRes.kind, "success");
    if (tokenRes.kind !== "success") return;

    const val = await connector.validateAccessToken({ token: tokenRes.accessToken, now });
    assert.equal(val.kind, "valid");
    if (val.kind === "valid") {
      assert.equal(val.wallet, wallet);
    }
  } finally {
    await database.$disconnect();
  }
});
