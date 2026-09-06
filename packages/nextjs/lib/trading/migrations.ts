import Database from "better-sqlite3";

export function runTradeMigrations(db: Database.Database): void {
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS trade_quotes (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      recommendation_id TEXT NOT NULL,
      registry_revision TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('classic', 'uniswapx')),
      input_token TEXT NOT NULL,
      input_amount TEXT NOT NULL,
      output_token TEXT NOT NULL,
      minimum_output TEXT NOT NULL,
      recipient TEXT NOT NULL,
      fee_bps INTEGER NOT NULL CHECK(fee_bps = 10),
      fee_token TEXT NOT NULL,
      fee_amount TEXT NOT NULL,
      fee_recipient TEXT NOT NULL,
      transaction_data TEXT,
      provider_order_id TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trade_orders (
      id TEXT PRIMARY KEY,
      quote_id TEXT UNIQUE NOT NULL REFERENCES trade_quotes(id),
      wallet TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('classic', 'uniswapx')),
      recommendation_id TEXT NOT NULL,
      registry_revision TEXT NOT NULL,
      provider_order_id TEXT UNIQUE,
      transaction_hash TEXT UNIQUE,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trade_receipts (
      order_id TEXT PRIMARY KEY REFERENCES trade_orders(id),
      wallet TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('classic', 'uniswapx')),
      status TEXT NOT NULL CHECK(status IN ('settled', 'reverted', 'filled', 'expired', 'cancelled', 'failed')),
      input_token TEXT NOT NULL,
      input_amount TEXT NOT NULL,
      output_token TEXT NOT NULL,
      output_amount TEXT NOT NULL,
      fee_bps INTEGER NOT NULL CHECK(fee_bps = 10),
      fee_token TEXT NOT NULL,
      fee_amount TEXT NOT NULL,
      fee_recipient TEXT NOT NULL,
      reference TEXT NOT NULL,
      settled_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trade_fee_events (
      order_id TEXT PRIMARY KEY REFERENCES trade_orders(id),
      wallet TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      fee_bps INTEGER NOT NULL CHECK(fee_bps = 10),
      token TEXT NOT NULL,
      amount TEXT NOT NULL,
      recipient TEXT NOT NULL,
      reference TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trade_reconcile_state (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      last_reconciled_at TEXT NOT NULL,
      cursor TEXT
    );
  `);
}
