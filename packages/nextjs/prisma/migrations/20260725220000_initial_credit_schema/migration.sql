-- CreateTable
CREATE TABLE "credit_challenges" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nonce" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "consumed_at" DATETIME
);

-- CreateTable
CREATE TABLE "credit_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "secret_hash" TEXT NOT NULL,
    "challenge_id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "revoked_at" DATETIME,
    CONSTRAINT "credit_sessions_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "credit_challenges" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "credit_authorizations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "challenge_id" TEXT,
    "correlation_id" TEXT NOT NULL,
    "reservation_id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "service_type" TEXT NOT NULL,
    "price_version" TEXT NOT NULL,
    "price_0g_micro_usdc" BIGINT NOT NULL,
    "price_fmp_micro_usdc" BIGINT NOT NULL,
    "price_leg_service_micro_usdc" BIGINT NOT NULL,
    "maximum_charge_micro_usdc" BIGINT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "vault_transaction_hash" TEXT,
    CONSTRAINT "credit_authorizations_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "credit_challenges" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "credit_usage_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "authorization_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "zero_g_micro_usdc" BIGINT NOT NULL,
    "fmp_micro_usdc" BIGINT NOT NULL,
    "leg_service_micro_usdc" BIGINT NOT NULL,
    "total_micro_usdc" BIGINT NOT NULL,
    "provider_reference_hash" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL,
    CONSTRAINT "credit_usage_records_authorization_id_fkey" FOREIGN KEY ("authorization_id") REFERENCES "credit_authorizations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "credit_usage_corrections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "usage_record_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "zero_g_micro_usdc" BIGINT NOT NULL,
    "fmp_micro_usdc" BIGINT NOT NULL,
    "leg_service_micro_usdc" BIGINT NOT NULL,
    "total_micro_usdc" BIGINT NOT NULL,
    "created_at" DATETIME NOT NULL,
    CONSTRAINT "credit_usage_corrections_usage_record_id_fkey" FOREIGN KEY ("usage_record_id") REFERENCES "credit_usage_records" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "credit_chain_events" (
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

    PRIMARY KEY ("chain_id", "transaction_hash", "log_index")
);

-- CreateTable
CREATE TABLE "credit_indexer_state" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "cursor_block_number" BIGINT NOT NULL,
    "cursor_block_hash" TEXT,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "credit_challenges_nonce_key" ON "credit_challenges"("nonce");

-- CreateIndex
CREATE UNIQUE INDEX "credit_challenges_request_id_key" ON "credit_challenges"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_sessions_secret_hash_key" ON "credit_sessions"("secret_hash");

-- CreateIndex
CREATE UNIQUE INDEX "credit_sessions_challenge_id_key" ON "credit_sessions"("challenge_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_authorizations_challenge_id_key" ON "credit_authorizations"("challenge_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_authorizations_correlation_id_key" ON "credit_authorizations"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_authorizations_reservation_id_key" ON "credit_authorizations"("reservation_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_usage_records_authorization_id_key" ON "credit_usage_records"("authorization_id");
