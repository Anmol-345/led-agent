import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseCreditMigrationConfig } from "../credits/config";
import { migrateCreditDatabase } from "../credits/db";
import { AdvisorConnector } from "./connector";
import { parseAdvisorConnectorConfig } from "./config";
import { createAdvisorPrismaClient } from "./db";

const testDirectory = mkdtempSync(join(tmpdir(), "leg-advisor-connector-"));
const wallet = "0x1111111111111111111111111111111111111111" as const;
const otherWallet = "0x2222222222222222222222222222222222222222" as const;
const now = new Date("2026-07-26T12:00:00.000Z");

test.after(() => rmSync(testDirectory, { force: true, recursive: true }));

let dbIndex = 0;
async function getTestConnector() {
  const environment = {
    ADVISOR_CONNECTOR_AUTHORIZATION_CODE_TTL_SECONDS: "300",
    ADVISOR_CONNECTOR_ISSUER_ORIGIN: "https://localhost:3000",
    ADVISOR_CONNECTOR_TOKEN_TTL_SECONDS: "3600",
    CREDIT_DATABASE_PATH: join(testDirectory, `advisor-${(dbIndex += 1)}.sqlite`),
    CREDIT_DEPLOYMENT_BLOCK: "100",
  };
  await migrateCreditDatabase(parseCreditMigrationConfig(environment));
  const database = createAdvisorPrismaClient(parseAdvisorConnectorConfig(environment));
  const config = parseAdvisorConnectorConfig(environment);
  const connector = new AdvisorConnector({ config, database });
  return { connector, database };
}

test("registers OAuth client and handles PKCE authorization code flow", async () => {
  const { connector, database } = await getTestConnector();
  try {
    const client = await connector.registerClient({
      clientName: "Claude Connector",
      grantTypes: ["authorization_code"],
      redirectUris: ["https://example.com/oauth/callback"],
    });

    assert.ok(client.clientId);

    // Issue authorization code
    const code = await connector.issueAuthorizationCode({
      clientId: client.clientId,
      codeChallenge: "E9Mel-bLincoln-3_V-w_-2039-10901239-0129",
      now,
      redirectUri: "https://example.com/oauth/callback",
      wallet,
    });

    assert.ok(code);

    // Exchange for token
    const tokenResult = await connector.exchangeAuthorizationCode({
      clientId: client.clientId,
      code,
      now,
      redirectUri: "https://example.com/oauth/callback",
    });

    assert.equal(tokenResult.kind, "success");
    if (tokenResult.kind !== "success") return;
    assert.ok(tokenResult.accessToken);

    // Validate access token
    const val = await connector.validateAccessToken({ token: tokenResult.accessToken, now });
    assert.equal(val.kind, "valid");
    if (val.kind !== "valid") return;
    assert.equal(val.wallet, wallet);

    // Cross-wallet check
    assert.equal(val.wallet === otherWallet, false);
  } finally {
    await database.$disconnect();
  }
});

test("refuses expired or revoked tokens", async () => {
  const { connector, database } = await getTestConnector();
  try {
    const client = await connector.registerClient({
      clientName: "ChatGPT Client",
      grantTypes: ["authorization_code"],
      redirectUris: ["https://chatgpt.com/callback"],
    });

    const code = await connector.issueAuthorizationCode({
      clientId: client.clientId,
      codeChallenge: "challenge-123",
      now,
      redirectUri: "https://chatgpt.com/callback",
      wallet,
    });

    const tokenResult = await connector.exchangeAuthorizationCode({
      clientId: client.clientId,
      code,
      now,
      redirectUri: "https://chatgpt.com/callback",
    });

    assert.equal(tokenResult.kind, "success");
    if (tokenResult.kind !== "success") return;

    // Revoke token
    await connector.revokeToken({ token: tokenResult.accessToken });

    const val = await connector.validateAccessToken({ token: tokenResult.accessToken, now });
    assert.equal(val.kind, "revoked");
  } finally {
    await database.$disconnect();
  }
});
