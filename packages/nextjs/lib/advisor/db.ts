import Database from "better-sqlite3";

import {
  createCreditPrismaClient,
  getCreditPrismaClient,
  type CreditPrismaClient,
} from "../credits/db";
import type { AdvisorDatabaseConfig } from "./config";

/**
 * The advisor shares the persistent host database and its committed forward-only migration
 * sequence with Customer Credits, but owns only the `advisor_*` tables. The client exposed here is
 * narrowed to those models so advisor code cannot read or write a credit table.
 */

export const ADVISOR_MIGRATION_NAME = "20260726040000_initial_advisor_schema";

export type AdvisorPrismaClient = Pick<
  CreditPrismaClient,
  | "$disconnect"
  | "$transaction"
  | "advisorCalculation"
  | "advisorCheckup"
  | "advisorCheckupAsset"
  | "advisorCheckupSubscription"
  | "advisorCitation"
  | "advisorOauthClient"
  | "advisorOauthToken"
  | "advisorQuote"
  | "advisorRecommendation"
  | "advisorRun"
>;

const requiredTableNames = [
  "advisor_calculations",
  "advisor_checkup_assets",
  "advisor_checkup_subscriptions",
  "advisor_checkups",
  "advisor_citations",
  "advisor_oauth_clients",
  "advisor_oauth_tokens",
  "advisor_quotes",
  "advisor_recommendations",
  "advisor_runs",
];
const requiredIndexNames = [
  "advisor_checkup_assets_subscription_id_chain_id_token_address_key",
  "advisor_checkups_run_id_key",
  "advisor_checkups_wallet_subscription_id_due_at_key",
  "advisor_oauth_tokens_token_hash_key",
  "advisor_quotes_correlation_id_key",
  "advisor_recommendations_run_id_key",
  "advisor_runs_correlation_id_key",
  "advisor_runs_quote_id_key",
];
const requiredSchemaFragments = [
  `constraint "advisor_quotes_price_total" check ( "price_0g_micro_usdc" + "price_fmp_micro_usdc" + "price_leg_service_micro_usdc" = "maximum_charge_micro_usdc" )`,
  `constraint "advisor_quotes_source" check ("source" in ('web', 'connector', 'checkup'))`,
  `constraint "advisor_runs_status" check ("status" in ('running', 'completed', 'failed'))`,
  `constraint "advisor_calculations_result_or_reason" check (("result_decimal" is null) <> ("unavailable_reason" is null))`,
  `constraint "advisor_recommendations_artifact_version" check ("artifact_version" = 'valueinvestingrecommendation.v1')`,
  `constraint "advisor_checkups_completed_run" check (("state" = 'completed') = ("run_id" is not null))`,
  `constraint "advisor_oauth_tokens_hash_only" check (length("token_hash") = 64 and "token_hash" not glob '*[^0-9a-f]*')`,
];

export function createAdvisorPrismaClient(config: AdvisorDatabaseConfig): AdvisorPrismaClient {
  return createCreditPrismaClient(config);
}

export function getAdvisorPrismaClient(config: AdvisorDatabaseConfig): AdvisorPrismaClient {
  return getCreditPrismaClient(config);
}

function normalizedSchemaSql(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function verifyAdvisorSqliteStructure(path: string): void {
  const database = new Database(path, { fileMustExist: true, readonly: true });
  try {
    const tables = new Set(
      database
        .prepare<[], { name: string }>("SELECT name FROM sqlite_schema WHERE type = 'table'")
        .all()
        .map(row => row.name),
    );
    for (const name of requiredTableNames) {
      if (!tables.has(name)) {
        throw new Error(`Advisor database is missing required table ${name}.`);
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
    if (!migrations.has(ADVISOR_MIGRATION_NAME)) {
      throw new Error(`Advisor database migration ${ADVISOR_MIGRATION_NAME} is not committed.`);
    }

    const indexes = new Set(
      database
        .prepare<[], { name: string }>("SELECT name FROM sqlite_schema WHERE type = 'index'")
        .all()
        .map(row => row.name),
    );
    for (const name of requiredIndexNames) {
      if (!indexes.has(name)) {
        throw new Error(`Advisor database is missing required index ${name}.`);
      }
    }

    const schemaSql = normalizedSchemaSql(
      database
        .prepare<[], { sql: string | null }>(
          `SELECT sql FROM sqlite_schema WHERE type = 'table' AND name LIKE 'advisor_%'`,
        )
        .all()
        .map(row => row.sql ?? "")
        .join(" "),
    );
    for (const fragment of requiredSchemaFragments) {
      if (!schemaSql.includes(normalizedSchemaSql(fragment))) {
        throw new Error("Advisor database is missing a required constraint.");
      }
    }
  } catch (error) {
    if (error instanceof Error && /no such table: _prisma_migrations/.test(error.message)) {
      throw new Error("Advisor database has no committed migration sequence.");
    }
    throw error;
  } finally {
    database.close();
  }
}

export async function verifyAdvisorDatabase(config: AdvisorDatabaseConfig): Promise<void> {
  try {
    verifyAdvisorSqliteStructure(config.databasePath);
  } catch (error) {
    if (error instanceof Error && /unable to open database file|not a database/i.test(error.message)) {
      throw new Error("Advisor database file is unavailable on this host.");
    }
    throw error;
  }

  const database = createAdvisorPrismaClient(config);
  try {
    await Promise.all([
      database.advisorQuote.findFirst(),
      database.advisorRun.findFirst(),
      database.advisorCitation.findFirst(),
      database.advisorCalculation.findFirst(),
      database.advisorRecommendation.findFirst(),
      database.advisorCheckupSubscription.findFirst(),
      database.advisorCheckupAsset.findFirst(),
      database.advisorCheckup.findFirst(),
      database.advisorOauthClient.findFirst(),
      database.advisorOauthToken.findFirst(),
    ]);
  } finally {
    await database.$disconnect();
  }
}
