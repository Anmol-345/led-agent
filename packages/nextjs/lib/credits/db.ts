import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  accessSync,
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  openSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import Database from "better-sqlite3";

import type {
  CreditDatabaseConfig,
  CreditMigrationConfig,
} from "./config";
import { PrismaClient } from "./generated/prisma/client";

const maximumMicroUsdc = 9_223_372_036_854_775_807n;
const sqliteBusyTimeoutMilliseconds = 5_000;
const requiredMigrationNames = [
  "20260725220000_initial_credit_schema",
  "20260725233000_harden_credit_persistence",
];
const requiredTableNames = [
  "_prisma_migrations",
  "credit_authorizations",
  "credit_chain_events",
  "credit_challenges",
  "credit_indexer_state",
  "credit_sessions",
  "credit_usage_corrections",
  "credit_usage_records",
];
const requiredIndexNames = [
  "credit_authorizations_challenge_id_key",
  "credit_authorizations_correlation_id_key",
  "credit_authorizations_reservation_id_key",
  "credit_challenges_nonce_key",
  "credit_sessions_challenge_id_key",
  "credit_sessions_secret_hash_key",
  "credit_usage_records_authorization_id_key",
];
const requiredSchemaFragments = [
  `constraint "credit_sessions_challenge_id_fkey" foreign key ("challenge_id") references "credit_challenges" ("id")`,
  `constraint "credit_authorizations_challenge_id_fkey" foreign key ("challenge_id") references "credit_challenges" ("id")`,
  `constraint "credit_authorizations_price_0g_range" check ("price_0g_micro_usdc" between 0 and 9223372036854775807)`,
  `constraint "credit_authorizations_price_fmp_range" check ("price_fmp_micro_usdc" between 0 and 9223372036854775807)`,
  `constraint "credit_authorizations_price_leg_range" check ("price_leg_service_micro_usdc" between 0 and 9223372036854775807)`,
  `constraint "credit_authorizations_maximum_range" check ("maximum_charge_micro_usdc" between 0 and 9223372036854775807)`,
  `constraint "credit_authorizations_price_total" check ( "price_0g_micro_usdc" + "price_fmp_micro_usdc" + "price_leg_service_micro_usdc" = "maximum_charge_micro_usdc" )`,
  `constraint "credit_authorizations_reservation_signature" check ( "reservation_signature" is null or ( length("reservation_signature") between 2 and 4098 and length("reservation_signature") % 2 = 0 and substr("reservation_signature", 1, 2) = '0x' and substr("reservation_signature", 3) not glob '*[^0-9a-fa-f]*' ) )`,
  `constraint "credit_authorizations_status" check ("status" in ( 'pending', 'reserved', 'provisional', 'settled', 'released', 'failed', 'expired', 'rejected' ))`,
  `constraint "credit_usage_records_authorization_id_fkey" foreign key ("authorization_id") references "credit_authorizations" ("id")`,
  `constraint "credit_usage_records_zero_g_range" check ("zero_g_micro_usdc" between 0 and 9223372036854775807)`,
  `constraint "credit_usage_records_fmp_range" check ("fmp_micro_usdc" between 0 and 9223372036854775807)`,
  `constraint "credit_usage_records_leg_range" check ("leg_service_micro_usdc" between 0 and 9223372036854775807)`,
  `constraint "credit_usage_records_total_range" check ("total_micro_usdc" between 0 and 9223372036854775807)`,
  `constraint "credit_usage_records_customer_charge_range" check ( "customer_charge_micro_usdc" between 0 and "total_micro_usdc" )`,
  `constraint "credit_usage_records_component_total" check ( "zero_g_micro_usdc" + "fmp_micro_usdc" + "leg_service_micro_usdc" = "total_micro_usdc" )`,
  `constraint "credit_usage_corrections_usage_record_id_fkey" foreign key ("usage_record_id") references "credit_usage_records" ("id")`,
  `constraint "credit_usage_corrections_zero_g_range" check ("zero_g_micro_usdc" between 0 and 9223372036854775807)`,
  `constraint "credit_usage_corrections_fmp_range" check ("fmp_micro_usdc" between 0 and 9223372036854775807)`,
  `constraint "credit_usage_corrections_leg_range" check ("leg_service_micro_usdc" between 0 and 9223372036854775807)`,
  `constraint "credit_usage_corrections_total_range" check ("total_micro_usdc" between 0 and 9223372036854775807)`,
  `constraint "credit_usage_corrections_component_total" check ( "zero_g_micro_usdc" + "fmp_micro_usdc" + "leg_service_micro_usdc" = "total_micro_usdc" )`,
  `constraint "credit_chain_events_amount_range" check ("amount_micro_usdc" between 0 and 9223372036854775807)`,
];
const appendOnlyCreditCorrectionExtension = {
  query: {
    creditUsageCorrection: {
      async delete() {
        throw new Error("Credit usage corrections are append-only.");
      },
      async deleteMany() {
        throw new Error("Credit usage corrections are append-only.");
      },
      async update() {
        throw new Error("Credit usage corrections are append-only.");
      },
      async updateMany() {
        throw new Error("Credit usage corrections are append-only.");
      },
      async upsert() {
        throw new Error("Credit usage corrections are append-only.");
      },
    },
  },
};

function checkedExistingLocalFile(path: string, description: string): string {
  if (!isAbsolute(path)) {
    throw new Error(`${description} must be an absolute local file path.`);
  }
  const localPath = resolve(path);
  if (!existsSync(localPath) || !statSync(localPath).isFile()) {
    throw new Error(`${description} must name an existing local file.`);
  }
  return localPath;
}

function checkedNewLocalFile(path: string, description: string): string {
  if (!isAbsolute(path)) {
    throw new Error(`${description} must be an absolute local file path.`);
  }
  const localPath = resolve(path);
  if (existsSync(localPath)) {
    throw new Error(`${description} must name a clean local file path.`);
  }
  try {
    accessSync(dirname(localPath), constants.W_OK | constants.X_OK);
  } catch {
    throw new Error(`${description} must have a writable local parent directory.`);
  }
  return localPath;
}

function secureExistingFile(path: string): void {
  if (!existsSync(path)) return;
  if (!statSync(path).isFile()) {
    throw new Error(`Credit database file is not a regular file: ${path}`);
  }
  chmodSync(path, 0o600);
}

function createOwnerOnlyFile(path: string): void {
  closeSync(openSync(path, "wx", 0o600));
  chmodSync(path, 0o600);
}

function creditDatabaseFiles(path: string): string[] {
  return [path, ...["-journal", "-shm", "-wal"].map(suffix => `${path}${suffix}`)];
}

function ensureCreditDatabaseFiles(path: string): void {
  if (!existsSync(path)) {
    try {
      createOwnerOnlyFile(path);
    } catch {
      if (!existsSync(path)) {
        throw new Error("Credit database file could not be created securely.");
      }
    }
  }
  for (const file of creditDatabaseFiles(path)) {
    secureExistingFile(file);
  }
}

function removeCreditDatabaseFiles(path: string): void {
  for (const file of creditDatabaseFiles(path)) {
    rmSync(file, { force: true });
  }
}

export function validateMicroUsdc(amount: bigint): bigint {
  if (amount < 0n || amount > maximumMicroUsdc) {
    throw new Error("Credit amounts must be between 0 and 9223372036854775807 micro-USDC.");
  }
  return amount;
}

export function createCreditPrismaClient(config: CreditDatabaseConfig) {
  ensureCreditDatabaseFiles(config.databasePath);
  const adapter = new PrismaBetterSqlite3({
    url: config.databaseUrl,
    timeout: sqliteBusyTimeoutMilliseconds,
  });
  return new PrismaClient({ adapter }).$extends(appendOnlyCreditCorrectionExtension);
}

export type CreditPrismaClient = ReturnType<typeof createCreditPrismaClient>;

let creditPrismaClient: CreditPrismaClient | undefined;
let creditPrismaDatabaseUrl: string | undefined;

export function getCreditPrismaClient(config: CreditDatabaseConfig): CreditPrismaClient {
  if (creditPrismaClient) {
    if (creditPrismaDatabaseUrl !== config.databaseUrl) {
      throw new Error("Credit database configuration changed after client initialization.");
    }
    return creditPrismaClient;
  }

  creditPrismaClient = createCreditPrismaClient(config);
  creditPrismaDatabaseUrl = config.databaseUrl;
  return creditPrismaClient;
}

async function initializeCreditDatabase(
  database: CreditPrismaClient,
  config: CreditMigrationConfig,
): Promise<void> {
  await database.creditIndexerState.upsert({
    create: {
      cursorBlockNumber: config.creditDeploymentBlock - 1n,
      id: 1,
      updatedAt: new Date(0),
    },
    update: {},
    where: { id: 1 },
  });
}

export async function migrateCreditDatabase(config: CreditMigrationConfig): Promise<void> {
  const prismaConfigPath = fileURLToPath(
    new URL("../../prisma.config.ts", import.meta.url),
  );
  // Resolve via Node module resolution so Next/webpack does not try to bundle a
  // relative node_modules/prisma path at build time (breaks on Vercel).
  const require = createRequire(import.meta.url);
  const prismaCliPath = require.resolve("prisma/build/index.js");

  ensureCreditDatabaseFiles(config.databasePath);
  execFileSync(
    process.execPath,
    [prismaCliPath, "migrate", "deploy", "--config", prismaConfigPath],
    {
      cwd: dirname(prismaConfigPath),
      env: { ...process.env, CREDIT_DATABASE_PATH: config.databasePath },
      stdio: "inherit",
    },
  );

  const database = createCreditPrismaClient(config);
  try {
    await initializeCreditDatabase(database, config);
  } finally {
    await database.$disconnect();
  }
}

function normalizedSchemaSql(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function verifySqliteStructure(path: string): void {
  const database = new Database(path, { fileMustExist: true, readonly: true });
  try {
    const integrity = database.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") {
      throw new Error("Credit database integrity check failed.");
    }
    const foreignKeyViolations = database
      .prepare<
        [],
        { fkid: number; parent: string; rowid: number; table: string }
      >("PRAGMA foreign_key_check")
      .all();
    if (foreignKeyViolations.length !== 0) {
      throw new Error("Credit database foreign-key verification failed.");
    }

    const tables = new Set(
      database
        .prepare<[], { name: string }>(
          "SELECT name FROM sqlite_schema WHERE type = 'table'",
        )
        .all()
        .map(row => row.name),
    );
    for (const name of requiredTableNames) {
      if (!tables.has(name)) {
        throw new Error(`Credit database is missing required table ${name}.`);
      }
    }

    const migrations = new Set(
      database
        .prepare<[], { name: string }>(
          `SELECT migration_name AS name
           FROM _prisma_migrations
           WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
        )
        .all()
        .map(row => row.name),
    );
    for (const name of requiredMigrationNames) {
      if (!migrations.has(name)) {
        throw new Error(`Credit database migration ${name} is not committed.`);
      }
    }

    const indexes = new Set(
      database
        .prepare<[], { name: string }>(
          "SELECT name FROM sqlite_schema WHERE type = 'index'",
        )
        .all()
        .map(row => row.name),
    );
    for (const name of requiredIndexNames) {
      if (!indexes.has(name)) {
        throw new Error(`Credit database is missing required index ${name}.`);
      }
    }

    const schemaSql = normalizedSchemaSql(
      database
        .prepare<[], { sql: string | null }>(
          `SELECT sql FROM sqlite_schema
           WHERE type = 'table' AND name LIKE 'credit_%'`,
        )
        .all()
        .map(row => row.sql ?? "")
        .join(" "),
    );
    for (const fragment of requiredSchemaFragments) {
      if (!schemaSql.includes(normalizedSchemaSql(fragment))) {
        throw new Error("Credit database is missing a required constraint.");
      }
    }
  } finally {
    database.close();
  }
}

async function verifyCreditDatabase(config: CreditDatabaseConfig): Promise<void> {
  ensureCreditDatabaseFiles(config.databasePath);
  verifySqliteStructure(config.databasePath);
  const database = createCreditPrismaClient(config);
  try {
    await Promise.all([
      database.creditChallenge.findFirst(),
      database.creditSession.findFirst(),
      database.creditAuthorization.findFirst(),
      database.creditUsageRecord.findFirst(),
      database.creditUsageCorrection.findFirst(),
      database.creditChainEvent.findFirst(),
      database.creditIndexerState.findUniqueOrThrow({ where: { id: 1 } }),
    ]);
  } finally {
    await database.$disconnect();
  }
}

function verifySqliteIntegrity(path: string): void {
  const database = new Database(path, { fileMustExist: true, readonly: true });
  try {
    const result = database.pragma("integrity_check", { simple: true });
    if (result !== "ok") {
      throw new Error("Credit database integrity check failed.");
    }
  } finally {
    database.close();
  }
}

export async function backupCreditDatabase(
  config: CreditDatabaseConfig,
  backupPath: string,
): Promise<void> {
  const sourcePath = checkedExistingLocalFile(config.databasePath, "Credit database path");
  const targetPath = checkedNewLocalFile(backupPath, "Credit backup path");

  await verifyCreditDatabase(config);
  const source = new Database(sourcePath, { fileMustExist: true, readonly: true });
  try {
    createOwnerOnlyFile(targetPath);
    await source.backup(targetPath);
    chmodSync(targetPath, 0o600);
    verifySqliteIntegrity(targetPath);
  } catch (error) {
    removeCreditDatabaseFiles(targetPath);
    throw error;
  } finally {
    source.close();
  }
}

export async function restoreCreditDatabase(
  backupPath: string,
  config: CreditDatabaseConfig,
): Promise<void> {
  const sourcePath = checkedExistingLocalFile(backupPath, "Credit backup path");
  const targetPath = checkedNewLocalFile(config.databasePath, "Credit restore path");
  const temporaryPath = `${targetPath}.restore-${randomUUID()}.tmp`;

  verifySqliteIntegrity(sourcePath);
  try {
    createOwnerOnlyFile(temporaryPath);
    copyFileSync(sourcePath, temporaryPath);
    chmodSync(temporaryPath, 0o600);
    verifySqliteIntegrity(temporaryPath);
    await verifyCreditDatabase({
      ...config,
      databasePath: temporaryPath,
      databaseUrl: `file:${temporaryPath}`,
    });
    for (const sidecar of creditDatabaseFiles(temporaryPath).slice(1)) {
      rmSync(sidecar, { force: true });
    }
    renameSync(temporaryPath, targetPath);
    chmodSync(targetPath, 0o600);
  } catch (error) {
    removeCreditDatabaseFiles(temporaryPath);
    throw error;
  }
}
