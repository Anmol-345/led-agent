import { accessSync, constants, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { DEPLOYMENT } from "../deployment";

// Vault chain and settlement token follow the deployment target: Base + native USDC on
// mainnet, Sepolia + a mock USDC we deploy on testnet. On testnet the mock's address is
// only known after deployment, so it must be supplied via CREDIT_USDC_ADDRESS.
const BASE_CHAIN_ID = DEPLOYMENT.vaultChainId;
const NATIVE_USDC_ADDRESS: `0x${string}` | undefined = DEPLOYMENT.vaultUsdcAddress;
const MINIMUM_SCHEDULER_SECRET_LENGTH = 32;
const zeroAddress = "0x0000000000000000000000000000000000000000";
const zeroPrivateKey = `0x${"0".repeat(64)}`;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const privateKeyPattern = /^0x[0-9a-fA-F]{64}$/;
const forbiddenPublicPrefixes = [
  "NEXT_PUBLIC_CREDIT_",
  "NEXT_PUBLIC_FMP_",
  "NEXT_PUBLIC_0G_",
];

function isAddressValue(value: string): value is `0x${string}` {
  return addressPattern.test(value);
}

function isPrivateKeyValue(value: string): value is `0x${string}` {
  return privateKeyPattern.test(value);
}

export type CreditRuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export type CreditDatabaseConfig = {
  databasePath: string;
  databaseUrl: string;
};

export type CreditMigrationConfig = CreditDatabaseConfig & {
  creditDeploymentBlock: bigint;
};

export type CreditAccountConfig = CreditDatabaseConfig & {
  appOrigin: string;
  baseChainId: number;
  baseRpcUrl: string;
  confirmations: number;
  creditDeploymentBlock: bigint;
  usdcAddress: `0x${string}`;
  vaultAddress: `0x${string}`;
};

export type CreditBillingConfig = CreditAccountConfig & {
  billingSignerPrivateKey: `0x${string}`;
  fmpProductionLicenseConfirmed: boolean;
};

export type CreditSchedulerConfig = CreditAccountConfig & {
  schedulerSecret: string;
};

export type CreditRuntimeConfig = CreditBillingConfig & CreditSchedulerConfig;

function requiredValue(environment: CreditRuntimeEnvironment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the credit runtime.`);
  }
  return value;
}

function assertNodeRuntime(nodeVersion: string): void {
  if (!/^24\.11\.\d+$/.test(nodeVersion)) {
    throw new Error("The credit runtime requires Node 24.11.x.");
  }
}

function assertNoPublicCreditSecrets(environment: CreditRuntimeEnvironment): void {
  for (const name of Object.keys(environment)) {
    if (forbiddenPublicPrefixes.some(prefix => name.startsWith(prefix))) {
      throw new Error("Credit and provider configuration must remain server-only.");
    }
  }
}

function assertPersistentProductionHost(
  environment: CreditRuntimeEnvironment,
  databasePath: string,
): void {
  if (environment.NODE_ENV !== "production") return;
  if (
    environment.VERCEL ||
    environment.AWS_LAMBDA_FUNCTION_NAME ||
    environment.LAMBDA_TASK_ROOT
  ) {
    throw new Error(
      "Production credits require a persistent Node host; Vercel and ephemeral function runtimes are unsupported.",
    );
  }
  const temporaryDirectory = resolve(tmpdir());
  const resolvedDatabasePath = resolve(databasePath);
  if (
    resolvedDatabasePath === temporaryDirectory ||
    resolvedDatabasePath.startsWith(`${temporaryDirectory}${sep}`)
  ) {
    throw new Error("Production credits cannot use a temporary database path.");
  }
}

export function validateCreditDatabasePath(value: string): string {
  if (value === ":memory:" || value.startsWith("file:") || !isAbsolute(value)) {
    throw new Error("CREDIT_DATABASE_PATH must be an absolute local database file path.");
  }

  const databasePath = resolve(value);
  try {
    if (existsSync(databasePath)) {
      if (!statSync(databasePath).isFile()) {
        throw new Error("CREDIT_DATABASE_PATH is not a file.");
      }
      accessSync(databasePath, constants.W_OK);
    } else {
      accessSync(dirname(databasePath), constants.W_OK | constants.X_OK);
    }
  } catch {
    throw new Error("CREDIT_DATABASE_PATH must name a writable local database file.");
  }
  return databasePath;
}

export function creditDatabaseUrl(databasePath: string): string {
  return `file:${validateCreditDatabasePath(databasePath)}`;
}

function validatedBaseRpcUrl(value: string): string {
  const url = new URL(value);
  const loopback = isLoopbackHostname(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("CREDIT_BASE_RPC_URL must use HTTPS or loopback HTTP.");
  }
  return value;
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function validatedAppOrigin(
  value: string,
  environment: CreditRuntimeEnvironment,
): string {
  const url = new URL(value);
  const loopback =
    url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const localDevelopment =
    environment.NODE_ENV !== "production" && url.protocol === "http:" && loopback;
  if (
    (url.protocol !== "https:" && !localDevelopment) ||
    value !== url.origin ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      "CREDIT_APP_ORIGIN must be a canonical HTTPS origin; loopback HTTP is allowed only outside production.",
    );
  }
  return url.origin;
}

function validatedConfirmations(value: string): number {
  const confirmations = Number(value);
  if (!Number.isSafeInteger(confirmations) || confirmations < 1) {
    throw new Error("CREDIT_CONFIRMATIONS must be a positive integer.");
  }
  return confirmations;
}

function validatedDeploymentBlock(value: string): bigint {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error("CREDIT_DEPLOYMENT_BLOCK must be a positive integer.");
  }
  return BigInt(value);
}

function validatedVaultAddress(value: string): `0x${string}` {
  if (
    !isAddressValue(value) ||
    value.toLowerCase() === zeroAddress
  ) {
    throw new Error("CREDIT_VAULT_ADDRESS must be a non-zero address.");
  }
  return value;
}

function validatedBillingSigner(value: string): `0x${string}` {
  if (
    !isPrivateKeyValue(value) ||
    value.toLowerCase() === zeroPrivateKey
  ) {
    throw new Error("CREDIT_BILLING_SIGNER_PRIVATE_KEY must be a non-zero private key.");
  }
  try {
    privateKeyToAccount(value);
  } catch {
    throw new Error("CREDIT_BILLING_SIGNER_PRIVATE_KEY must be a valid secp256k1 private key.");
  }
  return value;
}

function validatedFmpLicence(value: string): boolean {
  if (value !== "true" && value !== "false") {
    throw new Error("FMP_PRODUCTION_LICENSE_CONFIRMED must be true or false.");
  }
  return value === "true";
}

function validatedSchedulerSecret(value: string): string {
  if (value.length < MINIMUM_SCHEDULER_SECRET_LENGTH) {
    throw new Error("CREDIT_SCHEDULER_SECRET must be at least 32 characters.");
  }
  return value;
}

/**
 * On mainnet the settlement token is pinned to Base native USDC and cannot be overridden —
 * pointing the vault at an arbitrary token would let a misconfiguration silently accept a
 * worthless one. On testnet the mock USDC is deployed per environment, so its address must
 * come from CREDIT_USDC_ADDRESS.
 */
function resolvedUsdcAddress(
  environment: CreditRuntimeEnvironment,
): `0x${string}` {
  if (NATIVE_USDC_ADDRESS) return NATIVE_USDC_ADDRESS;
  const configured = requiredValue(environment, "CREDIT_USDC_ADDRESS");
  if (!isAddressValue(configured)) {
    throw new Error("CREDIT_USDC_ADDRESS must be a valid EVM address.");
  }
  return configured;
}

export function parseCreditAccountConfig(
  environment: CreditRuntimeEnvironment,
  nodeVersion = process.versions.node,
): CreditAccountConfig {
  const database = parseCreditDatabaseConfig(environment, nodeVersion);

  return {
    ...database,
    appOrigin: validatedAppOrigin(requiredValue(environment, "CREDIT_APP_ORIGIN"), environment),
    baseChainId: BASE_CHAIN_ID,
    baseRpcUrl: validatedBaseRpcUrl(requiredValue(environment, "CREDIT_BASE_RPC_URL")),
    confirmations: validatedConfirmations(requiredValue(environment, "CREDIT_CONFIRMATIONS")),
    creditDeploymentBlock: validatedDeploymentBlock(
      requiredValue(environment, "CREDIT_DEPLOYMENT_BLOCK"),
    ),
    usdcAddress: resolvedUsdcAddress(environment),
    vaultAddress: validatedVaultAddress(requiredValue(environment, "CREDIT_VAULT_ADDRESS")),
  };
}

export function parseCreditDatabaseConfig(
  environment: CreditRuntimeEnvironment,
  nodeVersion = process.versions.node,
): CreditDatabaseConfig {
  assertNodeRuntime(nodeVersion);
  assertNoPublicCreditSecrets(environment);
  const rawDatabasePath = requiredValue(environment, "CREDIT_DATABASE_PATH");
  assertPersistentProductionHost(environment, rawDatabasePath);
  const databasePath = validateCreditDatabasePath(rawDatabasePath);

  return {
    databasePath,
    databaseUrl: creditDatabaseUrl(databasePath),
  };
}

export function parseCreditMigrationConfig(
  environment: CreditRuntimeEnvironment,
  nodeVersion = process.versions.node,
): CreditMigrationConfig {
  return {
    ...parseCreditDatabaseConfig(environment, nodeVersion),
    creditDeploymentBlock: validatedDeploymentBlock(
      requiredValue(environment, "CREDIT_DEPLOYMENT_BLOCK"),
    ),
  };
}

export function parseCreditBillingConfig(
  environment: CreditRuntimeEnvironment,
  nodeVersion = process.versions.node,
): CreditBillingConfig {
  return {
    ...parseCreditAccountConfig(environment, nodeVersion),
    billingSignerPrivateKey: validatedBillingSigner(
      requiredValue(environment, "CREDIT_BILLING_SIGNER_PRIVATE_KEY"),
    ),
    fmpProductionLicenseConfirmed: validatedFmpLicence(
      requiredValue(environment, "FMP_PRODUCTION_LICENSE_CONFIRMED"),
    ),
  };
}

export function parseCreditSchedulerConfig(
  environment: CreditRuntimeEnvironment,
  nodeVersion = process.versions.node,
): CreditSchedulerConfig {
  return {
    ...parseCreditAccountConfig(environment, nodeVersion),
    schedulerSecret: validatedSchedulerSecret(
      requiredValue(environment, "CREDIT_SCHEDULER_SECRET"),
    ),
  };
}

export function parseCreditRuntimeConfig(
  environment: CreditRuntimeEnvironment,
  nodeVersion = process.versions.node,
): CreditRuntimeConfig {
  return {
    ...parseCreditBillingConfig(environment, nodeVersion),
    schedulerSecret: validatedSchedulerSecret(
      requiredValue(environment, "CREDIT_SCHEDULER_SECRET"),
    ),
  };
}

export function loadCreditAccountConfig(
  environment: CreditRuntimeEnvironment = process.env,
  nodeVersion = process.versions.node,
): CreditAccountConfig {
  return parseCreditAccountConfig(environment, nodeVersion);
}

export function loadCreditDatabaseConfig(
  environment: CreditRuntimeEnvironment = process.env,
  nodeVersion = process.versions.node,
): CreditDatabaseConfig {
  return parseCreditDatabaseConfig(environment, nodeVersion);
}

export function loadCreditMigrationConfig(
  environment: CreditRuntimeEnvironment = process.env,
  nodeVersion = process.versions.node,
): CreditMigrationConfig {
  return parseCreditMigrationConfig(environment, nodeVersion);
}

export function loadCreditBillingConfig(
  environment: CreditRuntimeEnvironment = process.env,
  nodeVersion = process.versions.node,
): CreditBillingConfig {
  return parseCreditBillingConfig(environment, nodeVersion);
}

export function loadCreditSchedulerConfig(
  environment: CreditRuntimeEnvironment = process.env,
  nodeVersion = process.versions.node,
): CreditSchedulerConfig {
  return parseCreditSchedulerConfig(environment, nodeVersion);
}

export function loadCreditRuntimeConfig(
  environment: CreditRuntimeEnvironment = process.env,
  nodeVersion = process.versions.node,
): CreditRuntimeConfig {
  return parseCreditRuntimeConfig(environment, nodeVersion);
}
