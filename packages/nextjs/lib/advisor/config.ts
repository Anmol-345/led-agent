import {
  parseCreditDatabaseConfig,
  type CreditDatabaseConfig,
} from "../credits/config";
import { DEPLOYMENT } from "../deployment";

/**
 * Advisor configuration is server-only. It shares the persistent Node host database named by
 * `CREDIT_DATABASE_PATH` but owns its own provider, pricing, freshness, connector, and scheduler
 * values. Every value is validated here so a missing or invalid runtime value fails closed before
 * an advisor quote or run rather than at the first provider call.
 */

const MAXIMUM_MICRO_USDC = 9_223_372_036_854_775_807n;
const MINIMUM_SCHEDULER_SECRET_LENGTH = 32;
const forbiddenPublicPrefixes = [
  "NEXT_PUBLIC_ADVISOR_",
  "NEXT_PUBLIC_FMP_",
  "NEXT_PUBLIC_0G_",
];
const philosophyVersionPattern = /^v[1-9][0-9]*$/;
const positiveIntegerPattern = /^[1-9][0-9]*$/;
const nonNegativeIntegerPattern = /^(0|[1-9][0-9]*)$/;

export type AdvisorRuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export type AdvisorDatabaseConfig = CreditDatabaseConfig;

export type AdvisorRouterConfig = {
  apiKey: string;
  baseUrl: string;
  maxCompletionPriceMicroUsdcPerMillionTokens: bigint;
  maxPromptPriceMicroUsdcPerMillionTokens: bigint;
  model: string;
  timeoutMilliseconds: number;
};

export type AdvisorFmpConfig = {
  apiKey: string;
  baseUrl: string;
  commercialRightsReference: string;
  productionLicenseConfirmed: boolean;
};

export type AdvisorFreshnessConfig = {
  maxFundamentalAgeDays: number;
  maxPriceAgeSeconds: number;
};

export type AdvisorPricingConfig = {
  completionTokenAllowance: number;
  fmpMicroUsdc: bigint;
  legServiceMicroUsdc: bigint;
  maxPromptTokens: number;
  maxToolResultTokens: number;
  quoteTtlSeconds: number;
  version: string;
};

export type AdvisorConnectorConfig = AdvisorDatabaseConfig & {
  connector: {
    authorizationCodeTtlSeconds: number;
    issuerOrigin: string;
    tokenTtlSeconds: number;
  };
};

export type AdvisorSchedulerConfig = AdvisorDatabaseConfig & {
  schedulerSecret: string;
};

export type AdvisorResearchConfig = AdvisorDatabaseConfig & {
  fmp: AdvisorFmpConfig;
  freshness: AdvisorFreshnessConfig;
  philosophyVersion: string;
  pricing: AdvisorPricingConfig;
  router: AdvisorRouterConfig;
};

export type AdvisorRuntimeConfig = AdvisorResearchConfig &
  AdvisorConnectorConfig &
  AdvisorSchedulerConfig;

function requiredValue(environment: AdvisorRuntimeEnvironment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the advisor runtime.`);
  }
  return value;
}

function assertNoPublicAdvisorSecrets(environment: AdvisorRuntimeEnvironment): void {
  for (const name of Object.keys(environment)) {
    if (forbiddenPublicPrefixes.some(prefix => name.startsWith(prefix))) {
      throw new Error("Advisor provider configuration must remain server-only.");
    }
  }
}

function positiveInteger(environment: AdvisorRuntimeEnvironment, name: string): number {
  const value = requiredValue(environment, name);
  if (!positiveIntegerPattern.test(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a safe positive integer.`);
  }
  return parsed;
}

function microUsdc(environment: AdvisorRuntimeEnvironment, name: string): bigint {
  const value = requiredValue(environment, name);
  if (!nonNegativeIntegerPattern.test(value)) {
    throw new Error(`${name} must be a whole micro-USDC amount.`);
  }
  const parsed = BigInt(value);
  if (parsed > MAXIMUM_MICRO_USDC) {
    throw new Error(`${name} must not exceed 9223372036854775807 micro-USDC.`);
  }
  return parsed;
}

function httpsUrl(environment: AdvisorRuntimeEnvironment, name: string): string {
  const value = requiredValue(environment, name);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTPS URL.`);
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.search || url.hash) {
    throw new Error(`${name} must be an HTTPS URL without a query or fragment.`);
  }
  return value.replace(/\/+$/, "");
}

function canonicalOrigin(environment: AdvisorRuntimeEnvironment, name: string): string {
  const value = requiredValue(environment, name);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a canonical HTTPS origin.`);
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const localDevelopment =
    environment.NODE_ENV !== "production" && url.protocol === "http:" && loopback;
  if ((url.protocol !== "https:" && !localDevelopment) || value !== url.origin) {
    throw new Error(
      `${name} must be a canonical HTTPS origin; loopback HTTP is allowed only outside production.`,
    );
  }
  return url.origin;
}

function philosophyVersion(environment: AdvisorRuntimeEnvironment): string {
  const value = requiredValue(environment, "ADVISOR_PHILOSOPHY_VERSION");
  if (!philosophyVersionPattern.test(value)) {
    throw new Error("ADVISOR_PHILOSOPHY_VERSION must name a published version such as v1.");
  }
  return value;
}

function productionLicenseConfirmed(environment: AdvisorRuntimeEnvironment): boolean {
  const value = requiredValue(environment, "FMP_PRODUCTION_LICENSE_CONFIRMED");
  if (value !== "true" && value !== "false") {
    throw new Error("FMP_PRODUCTION_LICENSE_CONFIRMED must be true or false.");
  }
  if (value === "false" && environment.NODE_ENV === "production") {
    throw new Error(
      "Production advisor research requires the confirmed FMP commercial data right.",
    );
  }
  return value === "true";
}

function schedulerSecret(environment: AdvisorRuntimeEnvironment): string {
  const value = requiredValue(environment, "ADVISOR_SCHEDULER_SECRET");
  if (value.length < MINIMUM_SCHEDULER_SECRET_LENGTH) {
    throw new Error("ADVISOR_SCHEDULER_SECRET must be at least 32 characters.");
  }
  return value;
}

function parseAdvisorPricingConfig(environment: AdvisorRuntimeEnvironment): AdvisorPricingConfig {
  const pricing: AdvisorPricingConfig = {
    completionTokenAllowance: positiveInteger(environment, "ADVISOR_COMPLETION_TOKEN_ALLOWANCE"),
    fmpMicroUsdc: microUsdc(environment, "ADVISOR_FMP_MICRO_USDC"),
    legServiceMicroUsdc: microUsdc(environment, "ADVISOR_LEG_SERVICE_MICRO_USDC"),
    maxPromptTokens: positiveInteger(environment, "ADVISOR_MAX_PROMPT_TOKENS"),
    maxToolResultTokens: positiveInteger(environment, "ADVISOR_MAX_TOOL_RESULT_TOKENS"),
    quoteTtlSeconds: positiveInteger(environment, "ADVISOR_QUOTE_TTL_SECONDS"),
    version: requiredValue(environment, "ADVISOR_PRICE_VERSION"),
  };

  // Tool results are priced inside the prompt budget, so an unreachable capacity would quote a
  // context the run can never send.
  if (pricing.maxToolResultTokens >= pricing.maxPromptTokens) {
    throw new Error("ADVISOR_MAX_TOOL_RESULT_TOKENS must stay below ADVISOR_MAX_PROMPT_TOKENS.");
  }
  return pricing;
}

export function parseAdvisorDatabaseConfig(
  environment: AdvisorRuntimeEnvironment,
  nodeVersion = process.versions.node,
): AdvisorDatabaseConfig {
  assertNoPublicAdvisorSecrets(environment);
  return parseCreditDatabaseConfig(environment, nodeVersion);
}

export function parseAdvisorResearchConfig(
  environment: AdvisorRuntimeEnvironment,
  nodeVersion = process.versions.node,
): AdvisorResearchConfig {
  return {
    ...parseAdvisorDatabaseConfig(environment, nodeVersion),
    fmp: {
      apiKey: requiredValue(environment, "FMP_API_KEY"),
      baseUrl: httpsUrl(environment, "FMP_BASE_URL"),
      commercialRightsReference: requiredValue(environment, "FMP_COMMERCIAL_RIGHTS_REFERENCE"),
      productionLicenseConfirmed: productionLicenseConfirmed(environment),
    },
    freshness: {
      maxFundamentalAgeDays: positiveInteger(environment, "ADVISOR_FUNDAMENTALS_MAX_AGE_DAYS"),
      maxPriceAgeSeconds: positiveInteger(environment, "ADVISOR_PRICE_MAX_AGE_SECONDS"),
    },
    philosophyVersion: philosophyVersion(environment),
    pricing: parseAdvisorPricingConfig(environment),
    router: {
      apiKey: requiredValue(environment, "ADVISOR_ROUTER_API_KEY"),
      // Defaults to the 0G router matching the deployment target. Mainnet and testnet are
      // fully separate environments with different endpoints, balances, API keys and model
      // catalogues, so the key must match the target too.
      baseUrl: environment.ADVISOR_ROUTER_BASE_URL
        ? httpsUrl(environment, "ADVISOR_ROUTER_BASE_URL")
        : DEPLOYMENT.zeroGBaseUrl,
      maxCompletionPriceMicroUsdcPerMillionTokens: microUsdc(
        environment,
        "ADVISOR_ROUTER_MAX_COMPLETION_PRICE_MICRO_USDC_PER_MILLION",
      ),
      maxPromptPriceMicroUsdcPerMillionTokens: microUsdc(
        environment,
        "ADVISOR_ROUTER_MAX_PROMPT_PRICE_MICRO_USDC_PER_MILLION",
      ),
      model: requiredValue(environment, "ADVISOR_ROUTER_MODEL"),
      timeoutMilliseconds: positiveInteger(environment, "ADVISOR_ROUTER_TIMEOUT_MS"),
    },
  };
}

export function parseAdvisorConnectorConfig(
  environment: AdvisorRuntimeEnvironment,
  nodeVersion = process.versions.node,
): AdvisorConnectorConfig {
  return {
    ...parseAdvisorDatabaseConfig(environment, nodeVersion),
    connector: {
      authorizationCodeTtlSeconds: positiveInteger(
        environment,
        "ADVISOR_CONNECTOR_AUTHORIZATION_CODE_TTL_SECONDS",
      ),
      issuerOrigin: canonicalOrigin(environment, "ADVISOR_CONNECTOR_ISSUER_ORIGIN"),
      tokenTtlSeconds: positiveInteger(environment, "ADVISOR_CONNECTOR_TOKEN_TTL_SECONDS"),
    },
  };
}

export function parseAdvisorSchedulerConfig(
  environment: AdvisorRuntimeEnvironment,
  nodeVersion = process.versions.node,
): AdvisorSchedulerConfig {
  return {
    ...parseAdvisorDatabaseConfig(environment, nodeVersion),
    schedulerSecret: schedulerSecret(environment),
  };
}

export function parseAdvisorRuntimeConfig(
  environment: AdvisorRuntimeEnvironment,
  nodeVersion = process.versions.node,
): AdvisorRuntimeConfig {
  return {
    ...parseAdvisorResearchConfig(environment, nodeVersion),
    ...parseAdvisorConnectorConfig(environment, nodeVersion),
    ...parseAdvisorSchedulerConfig(environment, nodeVersion),
  };
}

export function loadAdvisorDatabaseConfig(
  environment: AdvisorRuntimeEnvironment = process.env,
  nodeVersion = process.versions.node,
): AdvisorDatabaseConfig {
  return parseAdvisorDatabaseConfig(environment, nodeVersion);
}

export function loadAdvisorResearchConfig(
  environment: AdvisorRuntimeEnvironment = process.env,
  nodeVersion = process.versions.node,
): AdvisorResearchConfig {
  return parseAdvisorResearchConfig(environment, nodeVersion);
}

export function loadAdvisorConnectorConfig(
  environment: AdvisorRuntimeEnvironment = process.env,
  nodeVersion = process.versions.node,
): AdvisorConnectorConfig {
  return parseAdvisorConnectorConfig(environment, nodeVersion);
}

export function loadAdvisorSchedulerConfig(
  environment: AdvisorRuntimeEnvironment = process.env,
  nodeVersion = process.versions.node,
): AdvisorSchedulerConfig {
  return parseAdvisorSchedulerConfig(environment, nodeVersion);
}

export function loadAdvisorRuntimeConfig(
  environment: AdvisorRuntimeEnvironment = process.env,
  nodeVersion = process.versions.node,
): AdvisorRuntimeConfig {
  return parseAdvisorRuntimeConfig(environment, nodeVersion);
}
