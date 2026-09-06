PRAGMA foreign_keys=OFF;

CREATE TABLE "new_credit_challenges" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nonce" TEXT NOT NULL,
    "message_hash" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "consumed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "new_credit_challenges" (
    "id", "nonce", "message_hash", "wallet", "action", "request_id",
    "expires_at", "consumed_at", "created_at"
)
SELECT
    "id", "nonce", 'legacy:' || "id", "wallet", "action", "request_id",
    "expires_at", "consumed_at", CURRENT_TIMESTAMP
FROM "credit_challenges";

UPDATE "credit_sessions"
SET "revoked_at" = COALESCE("revoked_at", CURRENT_TIMESTAMP);

ALTER TABLE "credit_indexer_state"
ADD COLUMN "chain_id" BIGINT;
ALTER TABLE "credit_indexer_state"
ADD COLUMN "vault_address" TEXT;
ALTER TABLE "credit_indexer_state"
ADD COLUMN "deployment_block" BIGINT;

CREATE TABLE "new_credit_authorizations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "challenge_id" TEXT,
    "correlation_id" TEXT NOT NULL,
    "reservation_id" TEXT NOT NULL,
    "reservation_signature" TEXT,
    "wallet" TEXT NOT NULL,
    "service_type" TEXT NOT NULL,
    "price_version" TEXT NOT NULL,
    "price_0g_micro_usdc" BIGINT NOT NULL,
    "price_fmp_micro_usdc" BIGINT NOT NULL,
    "price_leg_service_micro_usdc" BIGINT NOT NULL,
    "maximum_charge_micro_usdc" BIGINT NOT NULL,
    "charge_purpose" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "rejection_reason" TEXT,
    "vault_transaction_hash" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "credit_authorizations_challenge_id_fkey"
      FOREIGN KEY ("challenge_id") REFERENCES "new_credit_challenges" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "credit_authorizations_price_0g_range"
      CHECK ("price_0g_micro_usdc" BETWEEN 0 AND 9223372036854775807),
    CONSTRAINT "credit_authorizations_price_fmp_range"
      CHECK ("price_fmp_micro_usdc" BETWEEN 0 AND 9223372036854775807),
    CONSTRAINT "credit_authorizations_price_leg_range"
      CHECK ("price_leg_service_micro_usdc" BETWEEN 0 AND 9223372036854775807),
    CONSTRAINT "credit_authorizations_maximum_range"
      CHECK ("maximum_charge_micro_usdc" BETWEEN 0 AND 9223372036854775807),
    CONSTRAINT "credit_authorizations_price_total"
      CHECK (
        "price_0g_micro_usdc" + "price_fmp_micro_usdc" +
        "price_leg_service_micro_usdc" = "maximum_charge_micro_usdc"
      ),
    CONSTRAINT "credit_authorizations_reservation_signature"
      CHECK (
        "reservation_signature" IS NULL OR (
          LENGTH("reservation_signature") BETWEEN 2 AND 4098 AND
          LENGTH("reservation_signature") % 2 = 0 AND
          SUBSTR("reservation_signature", 1, 2) = '0x' AND
          SUBSTR("reservation_signature", 3) NOT GLOB '*[^0-9A-Fa-f]*'
        )
      ),
    CONSTRAINT "credit_authorizations_status"
      CHECK ("status" IN (
        'pending', 'reserved', 'provisional', 'settled', 'released',
        'failed', 'expired', 'rejected'
      ))
);

INSERT INTO "new_credit_authorizations" (
    "id", "challenge_id", "correlation_id", "reservation_id",
    "reservation_signature", "wallet",
    "service_type", "price_version", "price_0g_micro_usdc",
    "price_fmp_micro_usdc", "price_leg_service_micro_usdc",
    "maximum_charge_micro_usdc", "charge_purpose", "expires_at", "status",
    "rejection_reason", "vault_transaction_hash", "created_at", "updated_at"
)
SELECT
    "id", "challenge_id", "correlation_id", "reservation_id", NULL, "wallet",
    "service_type", "price_version", 0, 0, 0, 0,
    'legacy:' || "service_type", "expires_at", 'rejected',
    'Legacy authorization rejected: no verified onchain reservation or customer charge exists.',
    NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "credit_authorizations";

CREATE TABLE "new_credit_usage_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "authorization_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "zero_g_micro_usdc" BIGINT NOT NULL,
    "fmp_micro_usdc" BIGINT NOT NULL,
    "leg_service_micro_usdc" BIGINT NOT NULL,
    "total_micro_usdc" BIGINT NOT NULL,
    "customer_charge_micro_usdc" BIGINT NOT NULL,
    "provider_reference_hash" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL,
    CONSTRAINT "credit_usage_records_authorization_id_fkey"
      FOREIGN KEY ("authorization_id") REFERENCES "new_credit_authorizations" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "credit_usage_records_zero_g_range"
      CHECK ("zero_g_micro_usdc" BETWEEN 0 AND 9223372036854775807),
    CONSTRAINT "credit_usage_records_fmp_range"
      CHECK ("fmp_micro_usdc" BETWEEN 0 AND 9223372036854775807),
    CONSTRAINT "credit_usage_records_leg_range"
      CHECK ("leg_service_micro_usdc" BETWEEN 0 AND 9223372036854775807),
    CONSTRAINT "credit_usage_records_total_range"
      CHECK ("total_micro_usdc" BETWEEN 0 AND 9223372036854775807),
    CONSTRAINT "credit_usage_records_customer_charge_range"
      CHECK (
        "customer_charge_micro_usdc" BETWEEN 0 AND "total_micro_usdc"
      ),
    CONSTRAINT "credit_usage_records_component_total"
      CHECK (
        "zero_g_micro_usdc" + "fmp_micro_usdc" +
        "leg_service_micro_usdc" = "total_micro_usdc"
      )
);

INSERT INTO "new_credit_usage_records" (
    "id", "authorization_id", "status", "zero_g_micro_usdc",
    "fmp_micro_usdc", "leg_service_micro_usdc", "total_micro_usdc",
    "customer_charge_micro_usdc", "provider_reference_hash", "created_at"
)
SELECT
    "id", "authorization_id", "status", "zero_g_micro_usdc",
    "fmp_micro_usdc", "leg_service_micro_usdc", "total_micro_usdc",
    0,
    "provider_reference_hash", "created_at"
FROM "credit_usage_records";

CREATE TABLE "new_credit_usage_corrections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "usage_record_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "zero_g_micro_usdc" BIGINT NOT NULL,
    "fmp_micro_usdc" BIGINT NOT NULL,
    "leg_service_micro_usdc" BIGINT NOT NULL,
    "total_micro_usdc" BIGINT NOT NULL,
    "created_at" DATETIME NOT NULL,
    CONSTRAINT "credit_usage_corrections_usage_record_id_fkey"
      FOREIGN KEY ("usage_record_id") REFERENCES "new_credit_usage_records" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "credit_usage_corrections_zero_g_range"
      CHECK ("zero_g_micro_usdc" BETWEEN 0 AND 9223372036854775807),
    CONSTRAINT "credit_usage_corrections_fmp_range"
      CHECK ("fmp_micro_usdc" BETWEEN 0 AND 9223372036854775807),
    CONSTRAINT "credit_usage_corrections_leg_range"
      CHECK ("leg_service_micro_usdc" BETWEEN 0 AND 9223372036854775807),
    CONSTRAINT "credit_usage_corrections_total_range"
      CHECK ("total_micro_usdc" BETWEEN 0 AND 9223372036854775807),
    CONSTRAINT "credit_usage_corrections_component_total"
      CHECK (
        "zero_g_micro_usdc" + "fmp_micro_usdc" +
        "leg_service_micro_usdc" = "total_micro_usdc"
      )
);

INSERT INTO "new_credit_usage_corrections" (
    "id", "usage_record_id", "reason", "zero_g_micro_usdc",
    "fmp_micro_usdc", "leg_service_micro_usdc", "total_micro_usdc", "created_at"
)
SELECT
    "id", "usage_record_id", "reason", "zero_g_micro_usdc",
    "fmp_micro_usdc", "leg_service_micro_usdc", "total_micro_usdc", "created_at"
FROM "credit_usage_corrections";

CREATE TABLE "new_credit_chain_events" (
    "chain_id" BIGINT NOT NULL,
    "transaction_hash" TEXT NOT NULL,
    "log_index" BIGINT NOT NULL,
    "block_number" BIGINT NOT NULL,
    "block_hash" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "amount_micro_usdc" BIGINT NOT NULL,
    "finality" TEXT NOT NULL,
    "reason" TEXT,
    "observed_at" DATETIME NOT NULL,
    CONSTRAINT "credit_chain_events_amount_range"
      CHECK ("amount_micro_usdc" BETWEEN 0 AND 9223372036854775807),
    PRIMARY KEY ("chain_id", "transaction_hash", "log_index")
);

INSERT INTO "new_credit_chain_events" (
    "chain_id", "transaction_hash", "log_index", "block_number", "block_hash",
    "event_name", "wallet", "amount_micro_usdc", "finality", "reason", "observed_at"
)
SELECT
    "chain_id", "transaction_hash", "log_index", "block_number", "block_hash",
    "event_name", "wallet", "amount_micro_usdc", 'reversed',
    'Legacy chain event reversed: source vault deployment was not recorded.',
    "observed_at"
FROM "credit_chain_events";

DROP TABLE "credit_chain_events";
DROP TABLE "credit_usage_corrections";
DROP TABLE "credit_usage_records";
DROP TABLE "credit_authorizations";
DROP TABLE "credit_challenges";

ALTER TABLE "new_credit_challenges" RENAME TO "credit_challenges";
ALTER TABLE "new_credit_authorizations" RENAME TO "credit_authorizations";
ALTER TABLE "new_credit_usage_records" RENAME TO "credit_usage_records";
ALTER TABLE "new_credit_usage_corrections" RENAME TO "credit_usage_corrections";
ALTER TABLE "new_credit_chain_events" RENAME TO "credit_chain_events";

CREATE UNIQUE INDEX "credit_challenges_nonce_key"
ON "credit_challenges"("nonce");
CREATE UNIQUE INDEX "credit_authorizations_challenge_id_key"
ON "credit_authorizations"("challenge_id");
CREATE UNIQUE INDEX "credit_authorizations_correlation_id_key"
ON "credit_authorizations"("correlation_id");
CREATE UNIQUE INDEX "credit_authorizations_reservation_id_key"
ON "credit_authorizations"("reservation_id");
CREATE UNIQUE INDEX "credit_usage_records_authorization_id_key"
ON "credit_usage_records"("authorization_id");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
