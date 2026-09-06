-- Value-Investing Advisor persistence.
--
-- Advisor-owned tables share the persistent host database named by CREDIT_DATABASE_PATH and are
-- applied forward-only in the same committed migration sequence as the credit tables. No advisor
-- column stores a raw prompt, a wallet signature, a provider key, or a raw FMP payload. The CHECK
-- constraints below keep the wallet, money, enumeration, and lifecycle invariants true in the
-- database itself rather than only in application code.

-- CreateTable
CREATE TABLE "advisor_quotes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "correlation_id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "context_hash" TEXT NOT NULL,
    "philosophy_version" TEXT NOT NULL,
    "router_model" TEXT NOT NULL,
    "price_version" TEXT NOT NULL,
    "price_0g_micro_usdc" BIGINT NOT NULL,
    "price_fmp_micro_usdc" BIGINT NOT NULL,
    "price_leg_service_micro_usdc" BIGINT NOT NULL,
    "maximum_charge_micro_usdc" BIGINT NOT NULL,
    "prompt_token_budget" INTEGER NOT NULL,
    "completion_token_allowance" INTEGER NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "advisor_quotes_wallet_format"
      CHECK (
        length("wallet") = 42
        AND substr("wallet", 1, 2) = '0x'
        AND substr("wallet", 3) NOT GLOB '*[^0-9a-fA-F]*'
      ),
    CONSTRAINT "advisor_quotes_source"
      CHECK ("source" IN ('web', 'connector', 'checkup')),
    CONSTRAINT "advisor_quotes_price_0g_range"
      CHECK ("price_0g_micro_usdc" BETWEEN 0 AND 9223372036854775807),
    CONSTRAINT "advisor_quotes_price_fmp_range"
      CHECK ("price_fmp_micro_usdc" BETWEEN 0 AND 9223372036854775807),
    CONSTRAINT "advisor_quotes_price_leg_range"
      CHECK ("price_leg_service_micro_usdc" BETWEEN 0 AND 9223372036854775807),
    CONSTRAINT "advisor_quotes_maximum_range"
      CHECK ("maximum_charge_micro_usdc" BETWEEN 0 AND 9223372036854775807),
    CONSTRAINT "advisor_quotes_price_total"
      CHECK (
        "price_0g_micro_usdc" + "price_fmp_micro_usdc" + "price_leg_service_micro_usdc"
        = "maximum_charge_micro_usdc"
      ),
    CONSTRAINT "advisor_quotes_context_budget"
      CHECK ("prompt_token_budget" > 0 AND "completion_token_allowance" > 0)
);

-- CreateTable
CREATE TABLE "advisor_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quote_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "failure_code" TEXT,
    "philosophy_version" TEXT NOT NULL,
    "router_model" TEXT NOT NULL,
    "price_version" TEXT NOT NULL,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "started_at" DATETIME NOT NULL,
    "completed_at" DATETIME,
    CONSTRAINT "advisor_runs_quote_id_fkey"
      FOREIGN KEY ("quote_id") REFERENCES "advisor_quotes" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "advisor_runs_wallet_format"
      CHECK (
        length("wallet") = 42
        AND substr("wallet", 1, 2) = '0x'
        AND substr("wallet", 3) NOT GLOB '*[^0-9a-fA-F]*'
      ),
    CONSTRAINT "advisor_runs_source"
      CHECK ("source" IN ('web', 'connector', 'checkup')),
    CONSTRAINT "advisor_runs_status"
      CHECK ("status" IN ('running', 'completed', 'failed')),
    CONSTRAINT "advisor_runs_failure_code"
      CHECK (("status" = 'failed') = ("failure_code" IS NOT NULL)),
    CONSTRAINT "advisor_runs_completed_at"
      CHECK (("status" = 'running') = ("completed_at" IS NULL)),
    CONSTRAINT "advisor_runs_usage_range"
      CHECK (
        ("prompt_tokens" IS NULL OR "prompt_tokens" >= 0)
        AND ("completion_tokens" IS NULL OR "completion_tokens" >= 0)
      )
);

-- CreateTable
CREATE TABLE "advisor_citations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "period_label" TEXT,
    "observed_at" DATETIME NOT NULL,
    "retrieved_at" DATETIME NOT NULL,
    CONSTRAINT "advisor_citations_run_id_fkey"
      FOREIGN KEY ("run_id") REFERENCES "advisor_runs" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "advisor_citations_evidence"
      CHECK (length("source") > 0 AND length("symbol") > 0)
);

-- CreateTable
CREATE TABLE "advisor_calculations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "formula_version" TEXT NOT NULL,
    "inputs_json" TEXT NOT NULL,
    "result_decimal" TEXT,
    "unavailable_reason" TEXT,
    "citation_ids_json" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL,
    CONSTRAINT "advisor_calculations_run_id_fkey"
      FOREIGN KEY ("run_id") REFERENCES "advisor_runs" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
    -- A calculation is either a reproducible result or a named unavailable reason, never both and
    -- never neither, so a generated response can never cite an invented value.
    CONSTRAINT "advisor_calculations_result_or_reason"
      CHECK (("result_decimal" IS NULL) <> ("unavailable_reason" IS NULL)),
    CONSTRAINT "advisor_calculations_version"
      CHECK (length("method") > 0 AND length("formula_version") > 0)
);

-- CreateTable
CREATE TABLE "advisor_recommendations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "artifact_version" TEXT NOT NULL,
    "asset_chain_id" BIGINT NOT NULL,
    "asset_address" TEXT NOT NULL,
    "asset_symbol" TEXT,
    "stance" TEXT NOT NULL,
    "thesis" TEXT NOT NULL,
    "risks" TEXT NOT NULL,
    "evidence_json" TEXT NOT NULL,
    "calculation_ids_json" TEXT NOT NULL,
    "generated_at" DATETIME NOT NULL,
    "expires_at" DATETIME NOT NULL,
    CONSTRAINT "advisor_recommendations_run_id_fkey"
      FOREIGN KEY ("run_id") REFERENCES "advisor_runs" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "advisor_recommendations_wallet_format"
      CHECK (
        length("wallet") = 42
        AND substr("wallet", 1, 2) = '0x'
        AND substr("wallet", 3) NOT GLOB '*[^0-9a-fA-F]*'
      ),
    CONSTRAINT "advisor_recommendations_asset_address_format"
      CHECK (
        length("asset_address") = 42
        AND substr("asset_address", 1, 2) = '0x'
        AND substr("asset_address", 3) NOT GLOB '*[^0-9a-fA-F]*'
      ),
    CONSTRAINT "advisor_recommendations_artifact_version"
      CHECK ("artifact_version" = 'ValueInvestingRecommendation.v1'),
    CONSTRAINT "advisor_recommendations_stance"
      CHECK (
        "stance" IN (
          'research-only', 'undervalued', 'fairly-valued', 'overvalued', 'insufficient-basis'
        )
      ),
    CONSTRAINT "advisor_recommendations_chain_id_range"
      CHECK ("asset_chain_id" > 0),
    CONSTRAINT "advisor_recommendations_expiry"
      CHECK ("expires_at" > "generated_at")
);

-- CreateTable
CREATE TABLE "advisor_checkup_subscriptions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "wallet" TEXT NOT NULL,
    "cadence" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "next_due_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "advisor_checkup_subscriptions_wallet_format"
      CHECK (
        length("wallet") = 42
        AND substr("wallet", 1, 2) = '0x'
        AND substr("wallet", 3) NOT GLOB '*[^0-9a-fA-F]*'
      ),
    CONSTRAINT "advisor_checkup_subscriptions_cadence"
      CHECK ("cadence" IN ('weekly', 'monthly', 'quarterly')),
    CONSTRAINT "advisor_checkup_subscriptions_state"
      CHECK ("state" IN ('active', 'paused'))
);

-- CreateTable
CREATE TABLE "advisor_checkup_assets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subscription_id" TEXT NOT NULL,
    "chain_id" BIGINT NOT NULL,
    "token_address" TEXT NOT NULL,
    CONSTRAINT "advisor_checkup_assets_subscription_id_fkey"
      FOREIGN KEY ("subscription_id") REFERENCES "advisor_checkup_subscriptions" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "advisor_checkup_assets_token_address_format"
      CHECK (
        length("token_address") = 42
        AND substr("token_address", 1, 2) = '0x'
        AND substr("token_address", 3) NOT GLOB '*[^0-9a-fA-F]*'
      ),
    CONSTRAINT "advisor_checkup_assets_chain_id_range"
      CHECK ("chain_id" > 0)
);

-- CreateTable
CREATE TABLE "advisor_checkups" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subscription_id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "due_at" DATETIME NOT NULL,
    "run_id" TEXT,
    "created_at" DATETIME NOT NULL,
    "resolved_at" DATETIME,
    CONSTRAINT "advisor_checkups_subscription_id_fkey"
      FOREIGN KEY ("subscription_id") REFERENCES "advisor_checkup_subscriptions" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "advisor_checkups_run_id_fkey"
      FOREIGN KEY ("run_id") REFERENCES "advisor_runs" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "advisor_checkups_wallet_format"
      CHECK (
        length("wallet") = 42
        AND substr("wallet", 1, 2) = '0x'
        AND substr("wallet", 3) NOT GLOB '*[^0-9a-fA-F]*'
      ),
    CONSTRAINT "advisor_checkups_state"
      CHECK ("state" IN ('pending', 'completed', 'skipped')),
    -- The scheduler may only create unbilled pending work; a checkup can reference a paid advisor
    -- run only once the customer has completed it.
    CONSTRAINT "advisor_checkups_completed_run"
      CHECK (("state" = 'completed') = ("run_id" IS NOT NULL)),
    CONSTRAINT "advisor_checkups_resolved_at"
      CHECK (("state" = 'pending') = ("resolved_at" IS NULL))
);

-- CreateTable
CREATE TABLE "advisor_oauth_clients" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "client_name" TEXT NOT NULL,
    "redirect_uris_json" TEXT NOT NULL,
    "grant_types_json" TEXT NOT NULL,
    "token_endpoint_auth_method" TEXT NOT NULL,
    "client_secret_hash" TEXT,
    "created_at" DATETIME NOT NULL,
    CONSTRAINT "advisor_oauth_clients_redirect_uris"
      CHECK (length("redirect_uris_json") > 2)
);

-- CreateTable
CREATE TABLE "advisor_oauth_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "client_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "redirect_uri" TEXT,
    "code_challenge" TEXT,
    "expires_at" DATETIME NOT NULL,
    "revoked_at" DATETIME,
    "created_at" DATETIME NOT NULL,
    CONSTRAINT "advisor_oauth_tokens_client_id_fkey"
      FOREIGN KEY ("client_id") REFERENCES "advisor_oauth_clients" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "advisor_oauth_tokens_wallet_format"
      CHECK (
        length("wallet") = 42
        AND substr("wallet", 1, 2) = '0x'
        AND substr("wallet", 3) NOT GLOB '*[^0-9a-fA-F]*'
      ),
    CONSTRAINT "advisor_oauth_tokens_kind"
      CHECK ("kind" IN ('authorization-code', 'access', 'refresh')),
    -- Only the hash of a bearer token or authorization code is ever stored.
    CONSTRAINT "advisor_oauth_tokens_hash_only"
      CHECK (length("token_hash") = 64 AND "token_hash" NOT GLOB '*[^0-9a-f]*'),
    CONSTRAINT "advisor_oauth_tokens_expiry"
      CHECK ("expires_at" > "created_at")
);

-- CreateIndex
CREATE UNIQUE INDEX "advisor_quotes_correlation_id_key" ON "advisor_quotes"("correlation_id");

-- CreateIndex
CREATE INDEX "advisor_quotes_wallet_created_at_idx" ON "advisor_quotes"("wallet", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "advisor_runs_quote_id_key" ON "advisor_runs"("quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "advisor_runs_correlation_id_key" ON "advisor_runs"("correlation_id");

-- CreateIndex
CREATE INDEX "advisor_runs_wallet_started_at_idx" ON "advisor_runs"("wallet", "started_at");

-- CreateIndex
CREATE INDEX "advisor_citations_run_id_idx" ON "advisor_citations"("run_id");

-- CreateIndex
CREATE INDEX "advisor_calculations_run_id_idx" ON "advisor_calculations"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "advisor_recommendations_run_id_key" ON "advisor_recommendations"("run_id");

-- CreateIndex
CREATE INDEX "advisor_recommendations_wallet_expires_at_idx" ON "advisor_recommendations"("wallet", "expires_at");

-- CreateIndex
CREATE INDEX "advisor_checkup_subscriptions_wallet_state_idx" ON "advisor_checkup_subscriptions"("wallet", "state");

-- CreateIndex
CREATE UNIQUE INDEX "advisor_checkup_assets_subscription_id_chain_id_token_address_key" ON "advisor_checkup_assets"("subscription_id", "chain_id", "token_address");

-- CreateIndex
CREATE UNIQUE INDEX "advisor_checkups_run_id_key" ON "advisor_checkups"("run_id");

-- CreateIndex
CREATE INDEX "advisor_checkups_state_due_at_idx" ON "advisor_checkups"("state", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "advisor_checkups_wallet_subscription_id_due_at_key" ON "advisor_checkups"("wallet", "subscription_id", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "advisor_oauth_tokens_token_hash_key" ON "advisor_oauth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "advisor_oauth_tokens_client_id_wallet_idx" ON "advisor_oauth_tokens"("client_id", "wallet");
