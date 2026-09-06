import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  parseAdvisorConnectorConfig,
  parseAdvisorDatabaseConfig,
  parseAdvisorResearchConfig,
  parseAdvisorRuntimeConfig,
  parseAdvisorSchedulerConfig,
  type AdvisorRuntimeEnvironment,
} from "./config";
import { DEPLOYMENT } from "../deployment";

const testDirectory = mkdtempSync(join(tmpdir(), "leg-advisor-config-"));
const testEnvironment: AdvisorRuntimeEnvironment = {
  ADVISOR_COMPLETION_TOKEN_ALLOWANCE: "1500",
  ADVISOR_CONNECTOR_AUTHORIZATION_CODE_TTL_SECONDS: "120",
  ADVISOR_CONNECTOR_ISSUER_ORIGIN: "https://app.leg.investments",
  ADVISOR_CONNECTOR_TOKEN_TTL_SECONDS: "3600",
  ADVISOR_FMP_MICRO_USDC: "2500",
  ADVISOR_FUNDAMENTALS_MAX_AGE_DAYS: "200",
  ADVISOR_LEG_SERVICE_MICRO_USDC: "5000",
  ADVISOR_MAX_PROMPT_TOKENS: "24000",
  ADVISOR_MAX_TOOL_RESULT_TOKENS: "6000",
  ADVISOR_PHILOSOPHY_VERSION: "v1",
  ADVISOR_PRICE_MAX_AGE_SECONDS: "900",
  ADVISOR_PRICE_VERSION: "advisor-2026-07",
  ADVISOR_QUOTE_TTL_SECONDS: "300",
  ADVISOR_ROUTER_API_KEY: "router-api-key",
  ADVISOR_ROUTER_BASE_URL: "https://router-api.0g.ai/v1",
  ADVISOR_ROUTER_MAX_COMPLETION_PRICE_MICRO_USDC_PER_MILLION: "9000",
  ADVISOR_ROUTER_MAX_PROMPT_PRICE_MICRO_USDC_PER_MILLION: "3000",
  ADVISOR_ROUTER_MODEL: "leg-pinned-model",
  ADVISOR_ROUTER_TIMEOUT_MS: "45000",
  ADVISOR_SCHEDULER_SECRET: "advisor-scheduler-secret-with-thirty-two-plus",
  CREDIT_DATABASE_PATH: join(testDirectory, "leg.sqlite"),
  FMP_API_KEY: "fmp-api-key",
  FMP_BASE_URL: "https://financialmodelingprep.com/stable",
  FMP_COMMERCIAL_RIGHTS_REFERENCE: "order-form-2026-04-11",
  FMP_PRODUCTION_LICENSE_CONFIRMED: "true",
};

// The upstream credit runtime rejects a temporary database path in production, so the production
// FMP gate has to be exercised from a persistent host directory.
const persistentDirectory = mkdtempSync(join(homedir(), ".leg-advisor-config-"));

test.after(() => {
  rmSync(testDirectory, { force: true, recursive: true });
  rmSync(persistentDirectory, { force: true, recursive: true });
});

function environmentWithout(name: string): AdvisorRuntimeEnvironment {
  const environment: Record<string, string | undefined> = { ...testEnvironment };
  delete environment[name];
  return environment;
}

test("accepts complete, server-only advisor runtime configuration", () => {
  const config = parseAdvisorRuntimeConfig(testEnvironment);

  assert.equal(config.databasePath, testEnvironment.CREDIT_DATABASE_PATH);
  assert.equal(config.philosophyVersion, "v1");
  assert.equal(config.router.baseUrl, "https://router-api.0g.ai/v1");
  assert.equal(config.router.model, "leg-pinned-model");
  assert.equal(config.router.maxPromptPriceMicroUsdcPerMillionTokens, 3000n);
  assert.equal(config.router.maxCompletionPriceMicroUsdcPerMillionTokens, 9000n);
  assert.equal(config.router.timeoutMilliseconds, 45_000);
  assert.equal(config.fmp.baseUrl, "https://financialmodelingprep.com/stable");
  assert.equal(config.fmp.commercialRightsReference, "order-form-2026-04-11");
  assert.equal(config.fmp.productionLicenseConfirmed, true);
  assert.equal(config.freshness.maxFundamentalAgeDays, 200);
  assert.equal(config.freshness.maxPriceAgeSeconds, 900);
  assert.equal(config.pricing.version, "advisor-2026-07");
  assert.equal(config.pricing.fmpMicroUsdc, 2500n);
  assert.equal(config.pricing.legServiceMicroUsdc, 5000n);
  assert.equal(config.pricing.maxPromptTokens, 24_000);
  assert.equal(config.pricing.completionTokenAllowance, 1500);
  assert.equal(config.pricing.maxToolResultTokens, 6000);
  assert.equal(config.pricing.quoteTtlSeconds, 300);
  assert.equal(config.connector.issuerOrigin, "https://app.leg.investments");
  assert.equal(config.connector.tokenTtlSeconds, 3600);
  assert.equal(config.connector.authorizationCodeTtlSeconds, 120);
  assert.equal(config.schedulerSecret, testEnvironment.ADVISOR_SCHEDULER_SECRET);
});

test("loads each configuration boundary without unrelated requirements", () => {
  const database = parseAdvisorDatabaseConfig({
    CREDIT_DATABASE_PATH: testEnvironment.CREDIT_DATABASE_PATH,
  });
  assert.equal(database.databaseUrl, `file:${testEnvironment.CREDIT_DATABASE_PATH}`);

  const scheduler = parseAdvisorSchedulerConfig({
    ADVISOR_SCHEDULER_SECRET: testEnvironment.ADVISOR_SCHEDULER_SECRET,
    CREDIT_DATABASE_PATH: testEnvironment.CREDIT_DATABASE_PATH,
  });
  assert.equal(scheduler.schedulerSecret, testEnvironment.ADVISOR_SCHEDULER_SECRET);

  assert.equal(parseAdvisorConnectorConfig(testEnvironment).connector.tokenTtlSeconds, 3600);
  assert.equal(parseAdvisorResearchConfig(testEnvironment).router.model, "leg-pinned-model");
});

test("a missing runtime value prevents an advisor quote or run", () => {
  const required = [
    "ADVISOR_COMPLETION_TOKEN_ALLOWANCE",
    "ADVISOR_FMP_MICRO_USDC",
    "ADVISOR_FUNDAMENTALS_MAX_AGE_DAYS",
    "ADVISOR_LEG_SERVICE_MICRO_USDC",
    "ADVISOR_MAX_PROMPT_TOKENS",
    "ADVISOR_MAX_TOOL_RESULT_TOKENS",
    "ADVISOR_PHILOSOPHY_VERSION",
    "ADVISOR_PRICE_MAX_AGE_SECONDS",
    "ADVISOR_PRICE_VERSION",
    "ADVISOR_QUOTE_TTL_SECONDS",
    "ADVISOR_ROUTER_API_KEY",
    // ADVISOR_ROUTER_BASE_URL is intentionally absent: it now defaults to the 0G router
    // for the active deployment target. See the dedicated test below.
    "ADVISOR_ROUTER_MAX_COMPLETION_PRICE_MICRO_USDC_PER_MILLION",
    "ADVISOR_ROUTER_MAX_PROMPT_PRICE_MICRO_USDC_PER_MILLION",
    "ADVISOR_ROUTER_MODEL",
    "ADVISOR_ROUTER_TIMEOUT_MS",
    "CREDIT_DATABASE_PATH",
    "FMP_API_KEY",
    "FMP_BASE_URL",
    "FMP_COMMERCIAL_RIGHTS_REFERENCE",
    "FMP_PRODUCTION_LICENSE_CONFIRMED",
  ];

  for (const name of required) {
    assert.throws(
      () => parseAdvisorResearchConfig(environmentWithout(name)),
      new RegExp(name),
      `${name} must be required for advisor research`,
    );
  }
});

test("the 0G router URL defaults to the deployment target but still validates overrides", () => {
  const withoutUrl = parseAdvisorResearchConfig(
    environmentWithout("ADVISOR_ROUTER_BASE_URL"),
  );
  assert.equal(withoutUrl.router.baseUrl, DEPLOYMENT.zeroGBaseUrl);
  assert.match(withoutUrl.router.baseUrl, /^https:\/\//);

  // An explicit value still wins, and is still rejected when it is not HTTPS.
  assert.throws(
    () =>
      parseAdvisorResearchConfig({
        ...testEnvironment,
        ADVISOR_ROUTER_BASE_URL: "http://insecure.example/v1",
      }),
    /ADVISOR_ROUTER_BASE_URL/,
  );
});

test("unavailable FMP access prevents an advisor quote or run", () => {
  assert.throws(
    () =>
      parseAdvisorResearchConfig({
        ...testEnvironment,
        CREDIT_DATABASE_PATH: join(persistentDirectory, "leg.sqlite"),
        FMP_PRODUCTION_LICENSE_CONFIRMED: "false",
        NODE_ENV: "production",
      }),
    /commercial/i,
  );
  assert.throws(
    () =>
      parseAdvisorResearchConfig({
        ...testEnvironment,
        FMP_PRODUCTION_LICENSE_CONFIRMED: "yes",
      }),
    /FMP_PRODUCTION_LICENSE_CONFIRMED/,
  );
  assert.throws(
    () => parseAdvisorResearchConfig({ ...testEnvironment, FMP_BASE_URL: "http://fmp.example.test" }),
    /FMP_BASE_URL/,
  );

  // An unconfirmed licence stays usable outside production so the boundary can be exercised.
  assert.equal(
    parseAdvisorResearchConfig({
      ...testEnvironment,
      FMP_PRODUCTION_LICENSE_CONFIRMED: "false",
    }).fmp.productionLicenseConfirmed,
    false,
  );
});

test("rejects public advisor secrets and invalid provider endpoints", () => {
  for (const name of [
    "NEXT_PUBLIC_ADVISOR_ROUTER_API_KEY",
    "NEXT_PUBLIC_FMP_API_KEY",
    "NEXT_PUBLIC_0G_KEY",
  ]) {
    assert.throws(
      () => parseAdvisorResearchConfig({ ...testEnvironment, [name]: "leaked" }),
      /server-only/i,
      name,
    );
  }

  assert.throws(
    () =>
      parseAdvisorResearchConfig({
        ...testEnvironment,
        ADVISOR_ROUTER_BASE_URL: "http://router-api.0g.ai/v1",
      }),
    /ADVISOR_ROUTER_BASE_URL/,
  );
  assert.throws(
    () =>
      parseAdvisorConnectorConfig({
        ...testEnvironment,
        ADVISOR_CONNECTOR_ISSUER_ORIGIN: "https://app.leg.investments/connector",
      }),
    /ADVISOR_CONNECTOR_ISSUER_ORIGIN/,
  );
});

test("rejects invalid bounds, prices, and secrets", () => {
  const invalid: Readonly<Record<string, readonly string[]>> = {
    ADVISOR_COMPLETION_TOKEN_ALLOWANCE: ["0", "-1", "1.5"],
    ADVISOR_CONNECTOR_TOKEN_TTL_SECONDS: ["0", "abc"],
    ADVISOR_FMP_MICRO_USDC: ["-1", "1.5", "9223372036854775808"],
    ADVISOR_FUNDAMENTALS_MAX_AGE_DAYS: ["0", "-3"],
    ADVISOR_LEG_SERVICE_MICRO_USDC: ["-1", "0x10"],
    ADVISOR_MAX_PROMPT_TOKENS: ["0", "1e5"],
    ADVISOR_MAX_TOOL_RESULT_TOKENS: ["0", "-2"],
    ADVISOR_PHILOSOPHY_VERSION: ["1", "V1", "../v1"],
    ADVISOR_PRICE_MAX_AGE_SECONDS: ["0", "-1"],
    ADVISOR_QUOTE_TTL_SECONDS: ["0", "-1"],
    ADVISOR_ROUTER_MAX_PROMPT_PRICE_MICRO_USDC_PER_MILLION: ["-1", "2.5"],
    ADVISOR_ROUTER_TIMEOUT_MS: ["0", "-1"],
  };

  for (const [name, values] of Object.entries(invalid)) {
    for (const value of values) {
      assert.throws(
        () => parseAdvisorRuntimeConfig({ ...testEnvironment, [name]: value }),
        new RegExp(name),
        `${name}=${value} must be rejected`,
      );
    }
  }

  assert.throws(
    () => parseAdvisorSchedulerConfig({ ...testEnvironment, ADVISOR_SCHEDULER_SECRET: "short" }),
    /ADVISOR_SCHEDULER_SECRET/,
  );
});

test("the tool-result budget cannot exceed the priced prompt budget", () => {
  assert.throws(
    () =>
      parseAdvisorResearchConfig({
        ...testEnvironment,
        ADVISOR_MAX_PROMPT_TOKENS: "4000",
        ADVISOR_MAX_TOOL_RESULT_TOKENS: "6000",
      }),
    /ADVISOR_MAX_TOOL_RESULT_TOKENS/,
  );
});

test("rejects unsupported Node versions before accepting advisor configuration", () => {
  assert.throws(() => parseAdvisorRuntimeConfig(testEnvironment, "22.0.0"), /Node 24\.11/);
});
