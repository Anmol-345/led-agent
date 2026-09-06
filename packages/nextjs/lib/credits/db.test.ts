import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import {
  backupCreditDatabase,
  createCreditPrismaClient,
  getCreditPrismaClient,
  migrateCreditDatabase,
  restoreCreditDatabase,
  validateMicroUsdc,
} from "./db";
import {
  parseCreditRuntimeConfig,
  type CreditRuntimeConfig,
  type CreditRuntimeEnvironment,
} from "./config";
import { CreditLedgerService } from "./ledger";

const testDirectory = mkdtempSync(join(tmpdir(), "leg-credit-prisma-"));
const testEnvironment: CreditRuntimeEnvironment = {
  CREDIT_APP_ORIGIN: "https://leg.example.test",
  CREDIT_BASE_RPC_URL: "https://base.example.test",
  CREDIT_BILLING_SIGNER_PRIVATE_KEY: `0x${"1".repeat(64)}`,
  CREDIT_CONFIRMATIONS: "12",
  CREDIT_DATABASE_PATH: join(testDirectory, "unused.sqlite"),
  CREDIT_DEPLOYMENT_BLOCK: "100",
  CREDIT_SCHEDULER_SECRET: "scheduler-secret-with-at-least-thirty-two-characters",
  CREDIT_VAULT_ADDRESS: "0x1111111111111111111111111111111111111111",
  CREDIT_USDC_ADDRESS: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  FMP_PRODUCTION_LICENSE_CONFIRMED: "true",
};

test.after(() => rmSync(testDirectory, { force: true, recursive: true }));

function creditConfig(fileName: string): CreditRuntimeConfig {
  return parseCreditRuntimeConfig({
    ...testEnvironment,
    CREDIT_DATABASE_PATH: join(testDirectory, fileName),
  });
}

function fileMode(path: string): number {
  return statSync(path).mode & 0o777;
}

async function insertConstrainedCreditRecords(
  database: ReturnType<typeof createCreditPrismaClient>,
): Promise<void> {
  await database.creditChallenge.create({
    data: {
      action: "READ_ACCOUNT",
      expiresAt: new Date("2026-07-25T12:00:00.000Z"),
      id: "challenge-1",
      messageHash: "challenge-message-hash",
      nonce: "nonce-1",
      requestId: "request-1",
      wallet: "0x1111111111111111111111111111111111111111",
    },
  });
  await database.creditSession.create({
    data: {
      action: "READ_ACCOUNT",
      challengeId: "challenge-1",
      expiresAt: new Date("2026-07-25T12:00:00.000Z"),
      id: "session-1",
      requestId: "request-1",
      secretHash: "hashed-session-secret",
      wallet: "0x1111111111111111111111111111111111111111",
    },
  });
  await database.creditAuthorization.create({
    data: {
      challengeId: "challenge-1",
      correlationId: "correlation-1",
      chargePurpose: "advisor request",
      expiresAt: new Date("2026-07-25T12:00:00.000Z"),
      id: "authorization-1",
      maximumChargeMicroUsdc: 10n,
      priceFmpMicroUsdc: 3n,
      priceLegServiceMicroUsdc: 5n,
      priceVersion: "2026-07-25",
      priceZeroGMicroUsdc: 2n,
      reservationId: "reservation-1",
      reservationSignature: "0x01",
      serviceType: "ADVISOR",
      status: "RESERVED",
      vaultTransactionHash: "0xtransaction",
      wallet: "0x1111111111111111111111111111111111111111",
    },
  });
  await database.creditUsageRecord.create({
    data: {
      authorizationId: "authorization-1",
      createdAt: new Date("2026-07-25T12:00:00.000Z"),
      customerChargeMicroUsdc: 0n,
      fmpMicroUsdc: 3n,
      id: "usage-1",
      legServiceMicroUsdc: 5n,
      providerReferenceHash: "hashed-provider-reference",
      status: "PROVISIONAL",
      totalMicroUsdc: 10n,
      zeroGMicroUsdc: 2n,
    },
  });
  await database.creditUsageCorrection.create({
    data: {
      createdAt: new Date("2026-07-25T12:01:00.000Z"),
      fmpMicroUsdc: 3n,
      id: "correction-1",
      legServiceMicroUsdc: 5n,
      reason: "provider reconciliation",
      totalMicroUsdc: 10n,
      usageRecordId: "usage-1",
      zeroGMicroUsdc: 2n,
    },
  });
  await database.creditChainEvent.create({
    data: {
      amountMicroUsdc: 10n,
      blockHash: "0xblock",
      blockNumber: 100n,
      chainId: 8453n,
      eventName: "Deposited",
      finality: "CONFIRMED",
      logIndex: 0n,
      observedAt: new Date("2026-07-25T12:00:00.000Z"),
      transactionHash: "0xevent",
      wallet: "0x1111111111111111111111111111111111111111",
    },
  });
}

test("deploys Prisma migrations once and preserves typed local credit constraints", async () => {
  const config = creditConfig("credits.sqlite");
  await migrateCreditDatabase(config);
  await migrateCreditDatabase(config);

  const database = createCreditPrismaClient(config);
  try {
    await insertConstrainedCreditRecords(database);
    await database.creditChallenge.create({
      data: {
        action: "AUTHORIZE_ADVISOR",
        expiresAt: new Date("2026-07-25T12:05:00.000Z"),
        id: "challenge-retry",
        messageHash: "challenge-retry-message-hash",
        nonce: "nonce-retry",
        requestId: "request-1",
        wallet: "0x1111111111111111111111111111111111111111",
      },
    });
    assert.equal(
      await database.creditChallenge.count({ where: { requestId: "request-1" } }),
      2,
    );
    await assert.rejects(
      database.creditChainEvent.create({
        data: {
          amountMicroUsdc: 10n,
          blockHash: "0xblock",
          blockNumber: 101n,
          chainId: 8453n,
          eventName: "Deposited",
          finality: "CONFIRMED",
          logIndex: 0n,
          observedAt: new Date("2026-07-25T12:00:00.000Z"),
          transactionHash: "0xevent",
          wallet: "0x1111111111111111111111111111111111111111",
        },
      }),
    );
    assert.throws(() => validateMicroUsdc(-1n));
    assert.throws(() => validateMicroUsdc(9_223_372_036_854_775_808n));

    const session = await database.creditSession.findUniqueOrThrow({
      select: { secretHash: true },
      where: { id: "session-1" },
    });
    const correction = await database.creditUsageCorrection.findUniqueOrThrow({
      where: { id: "correction-1" },
    });

    assert.equal(session.secretHash, "hashed-session-secret");
    assert.equal(correction.reason, "provider reconciliation");
    assert.equal(
      await database.creditAuthorization
        .findUniqueOrThrow({ where: { id: "authorization-1" } })
        .then(authorization => authorization.reservationSignature),
      "0x01",
    );
    await assert.rejects(
      database.creditUsageCorrection.update({
        data: { reason: "rewritten" },
        where: { id: "correction-1" },
      }),
    );
    await assert.rejects(
      database.creditAuthorization.create({
        data: {
          chargePurpose: "invalid negative price",
          correlationId: "negative-correlation",
          expiresAt: new Date("2026-07-25T12:00:00.000Z"),
          id: "negative-authorization",
          maximumChargeMicroUsdc: 0n,
          priceFmpMicroUsdc: 0n,
          priceLegServiceMicroUsdc: 0n,
          priceVersion: "2026-07-25",
          priceZeroGMicroUsdc: -1n,
          reservationId: "negative-reservation",
          serviceType: "ADVISOR",
          status: "PENDING",
          wallet: "0x1111111111111111111111111111111111111111",
        },
      }),
    );
    await assert.rejects(
      database.creditUsageRecord.create({
        data: {
          authorizationId: "authorization-1",
          createdAt: new Date(),
          customerChargeMicroUsdc: 11n,
          fmpMicroUsdc: 3n,
          id: "inconsistent-usage",
          legServiceMicroUsdc: 5n,
          providerReferenceHash: "hash",
          status: "SETTLED",
          totalMicroUsdc: 10n,
          zeroGMicroUsdc: 2n,
        },
      }),
    );
    for (const [index, reservationSignature] of [
      "not-hex",
      "0x0",
      `0x${"1".repeat(4_098)}`,
    ].entries()) {
      await assert.rejects(
        database.creditAuthorization.create({
          data: {
            chargePurpose: "invalid reservation signature",
            correlationId: `invalid-signature-correlation-${index}`,
            expiresAt: new Date("2026-07-25T12:00:00.000Z"),
            id: `invalid-signature-authorization-${index}`,
            maximumChargeMicroUsdc: 1n,
            priceFmpMicroUsdc: 0n,
            priceLegServiceMicroUsdc: 1n,
            priceVersion: "2026-07-25",
            priceZeroGMicroUsdc: 0n,
            reservationId: `invalid-signature-reservation-${index}`,
            reservationSignature,
            serviceType: "ADVISOR",
            status: "PENDING",
            wallet: "0x1111111111111111111111111111111111111111",
          },
        }),
      );
    }
  } finally {
    await database.$disconnect();
  }
});

test("backs up a live database and atomically restores verified credit records", async () => {
  const sourceConfig = creditConfig("source.sqlite");
  const backupPath = join(testDirectory, "credits-backup.sqlite");
  const restoredConfig = creditConfig("restored.sqlite");
  await migrateCreditDatabase(sourceConfig);

  const source = createCreditPrismaClient(sourceConfig);
  try {
    await insertConstrainedCreditRecords(source);

    await backupCreditDatabase(sourceConfig, backupPath);
  } finally {
    await source.$disconnect();
  }
  await restoreCreditDatabase(backupPath, restoredConfig);

  const restored = createCreditPrismaClient(restoredConfig);
  try {
    const challenge = await restored.creditChallenge.findUniqueOrThrow({
      select: { nonce: true, requestId: true },
      where: { id: "challenge-1" },
    });
    const event = await restored.creditChainEvent.findUniqueOrThrow({
      select: { amountMicroUsdc: true, finality: true, transactionHash: true },
      where: {
        chainId_transactionHash_logIndex: {
          chainId: 8453n,
          logIndex: 0n,
          transactionHash: "0xevent",
        },
      },
    });
    const authorization = await restored.creditAuthorization.findUniqueOrThrow({
      select: { reservationSignature: true },
      where: { id: "authorization-1" },
    });

    assert.equal(challenge.nonce, "nonce-1");
    assert.equal(challenge.requestId, "request-1");
    assert.equal(authorization.reservationSignature, "0x01");
    assert.equal(event.transactionHash, "0xevent");
    assert.equal(event.amountMicroUsdc, 10n);
    assert.equal(event.finality, "CONFIRMED");
    assert.equal(fileMode(sourceConfig.databasePath), 0o600);
    assert.equal(fileMode(backupPath), 0o600);
    assert.equal(fileMode(restoredConfig.databasePath), 0o600);
  } finally {
    await restored.$disconnect();
  }
});

test("database creation, existing files, and SQLite sidecars are owner-only", async () => {
  const config = creditConfig("permission-hardening.sqlite");
  await migrateCreditDatabase(config);
  const raw = new Database(config.databasePath);

  try {
    raw.pragma("journal_mode = WAL");
    raw.exec("CREATE TABLE permission_probe (id INTEGER PRIMARY KEY); INSERT INTO permission_probe DEFAULT VALUES;");
    const sidecars = [`${config.databasePath}-wal`, `${config.databasePath}-shm`];
    assert.ok(sidecars.every(existsSync));

    chmodSync(config.databasePath, 0o666);
    sidecars.forEach(path => chmodSync(path, 0o666));

    const client = createCreditPrismaClient(config);
    assert.equal(fileMode(config.databasePath), 0o600);
    sidecars.forEach(path => assert.equal(fileMode(path), 0o600));
    await client.$disconnect();
  } finally {
    raw.close();
  }
});

test("backup and restore remain owner-only under a permissive umask", async () => {
  const sourceConfig = creditConfig("permissive-source.sqlite");
  const restoredConfig = creditConfig("permissive-restored.sqlite");
  const backupPath = join(testDirectory, "permissive-backup.sqlite");
  await migrateCreditDatabase(sourceConfig);
  chmodSync(sourceConfig.databasePath, 0o666);

  const previousUmask = process.umask(0);
  try {
    await backupCreditDatabase(sourceConfig, backupPath);
    await restoreCreditDatabase(backupPath, restoredConfig);
  } finally {
    process.umask(previousUmask);
  }

  assert.equal(fileMode(sourceConfig.databasePath), 0o600);
  assert.equal(fileMode(backupPath), 0o600);
  assert.equal(fileMode(restoredConfig.databasePath), 0o600);
});

test("restore rejects missing migrations, schema objects, constraints, and foreign-key violations", async () => {
  const sourceConfig = creditConfig("restore-probe-source.sqlite");
  const validBackup = join(testDirectory, "restore-probe-valid.sqlite");
  await migrateCreditDatabase(sourceConfig);
  await backupCreditDatabase(sourceConfig, validBackup);

  const corruptions: Array<{
    mutate(path: string): void;
    name: string;
  }> = [
    {
      name: "missing schema",
      mutate(path) {
        rmSync(path);
        new Database(path).close();
      },
    },
    {
      name: "unfinished migration",
      mutate(path) {
        const database = new Database(path);
        database
          .prepare(
            "UPDATE _prisma_migrations SET finished_at = NULL WHERE migration_name = ?",
          )
          .run("20260725233000_harden_credit_persistence");
        database.close();
      },
    },
    {
      name: "missing required index",
      mutate(path) {
        const database = new Database(path);
        database.exec("DROP INDEX credit_sessions_secret_hash_key");
        database.close();
      },
    },
    {
      name: "weakened amount constraint",
      mutate(path) {
        const database = new Database(path);
        database.pragma("foreign_keys = OFF");
        database.exec(`
          CREATE TABLE weakened_credit_chain_events (
            chain_id BIGINT NOT NULL,
            transaction_hash TEXT NOT NULL,
            log_index BIGINT NOT NULL,
            block_number BIGINT NOT NULL,
            block_hash TEXT NOT NULL,
            event_name TEXT NOT NULL,
            wallet TEXT NOT NULL,
            amount_micro_usdc BIGINT NOT NULL,
            finality TEXT NOT NULL,
            reason TEXT,
            observed_at DATETIME NOT NULL,
            PRIMARY KEY (chain_id, transaction_hash, log_index)
          );
          INSERT INTO weakened_credit_chain_events
          SELECT * FROM credit_chain_events;
          DROP TABLE credit_chain_events;
          ALTER TABLE weakened_credit_chain_events RENAME TO credit_chain_events;
        `);
        database.close();
      },
    },
    {
      name: "foreign-key violation",
      mutate(path) {
        const database = new Database(path);
        database.pragma("foreign_keys = OFF");
        database.exec(`
          INSERT INTO credit_sessions (
            id, secret_hash, challenge_id, wallet, action, request_id, expires_at
          ) VALUES (
            'orphan-session', 'orphan-secret', 'missing-challenge',
            '0x1111111111111111111111111111111111111111',
            'read-account', 'orphan-request', '2099-01-01T00:00:00.000Z'
          )
        `);
        database.close();
      },
    },
  ];

  for (const [index, corruption] of corruptions.entries()) {
    const candidate = join(testDirectory, `restore-probe-${index}.sqlite`);
    const target = creditConfig(`restore-probe-target-${index}.sqlite`);
    copyFileSync(validBackup, candidate);
    corruption.mutate(candidate);

    await assert.rejects(
      restoreCreditDatabase(candidate, target),
      corruption.name,
    );
    assert.equal(existsSync(target.databasePath), false);
  }
});

test("forward migration rejects every unverifiable legacy authorization without inventing customer debits", async () => {
  const legacyConfig = creditConfig("legacy.sqlite");
  const legacyPath = legacyConfig.databasePath;
  const legacy = new Database(legacyPath);
  const initialMigration = readFileSync(
    new URL("../../prisma/migrations/20260725220000_initial_credit_schema/migration.sql", import.meta.url),
    "utf8",
  );
  const forwardMigration = readFileSync(
    new URL(
      "../../prisma/migrations/20260725233000_harden_credit_persistence/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );

  try {
    legacy.exec(initialMigration);
    legacy.exec(`
      INSERT INTO credit_challenges (
        id, nonce, wallet, action, request_id, expires_at
      ) VALUES (
        'legacy-challenge', 'legacy-nonce',
        '0x1111111111111111111111111111111111111111',
        'read-account', 'legacy-request', '2026-07-25T12:00:00.000Z'
      );
      INSERT INTO credit_sessions (
        id, secret_hash, challenge_id, wallet, action, request_id, expires_at
      ) VALUES (
        'legacy-session', 'legacy-secret-hash', 'legacy-challenge',
        '0x1111111111111111111111111111111111111111',
        'read-account', 'legacy-request', '2099-07-25T12:00:00.000Z'
      );
      INSERT INTO credit_authorizations (
        id, challenge_id, correlation_id, reservation_id, wallet, service_type,
        price_version, price_0g_micro_usdc, price_fmp_micro_usdc,
        price_leg_service_micro_usdc, maximum_charge_micro_usdc, expires_at,
        status
      ) VALUES (
        'legacy-authorization', 'legacy-challenge', 'legacy-correlation',
        'legacy-reservation', '0x1111111111111111111111111111111111111111',
        'advisor', 'legacy', 0, 0, 0, 10, '2026-07-25T12:00:00.000Z',
        'settled'
      ), (
        'legacy-reserved', NULL, 'legacy-reserved-correlation',
        'legacy-reserved-reservation',
        '0x1111111111111111111111111111111111111111',
        'advisor', 'legacy', 2, 3, 5, 10, '2026-07-25T12:00:00.000Z',
        'reserved'
      ), (
        'legacy-provisional', NULL, 'legacy-provisional-correlation',
        'legacy-provisional-reservation',
        '0x1111111111111111111111111111111111111111',
        'advisor', 'legacy', 0, 0, 10, 10, '2026-07-25T12:00:00.000Z',
        'provisional'
      ), (
        'legacy-pending', NULL, 'legacy-pending-correlation',
        'legacy-pending-reservation',
        '0x1111111111111111111111111111111111111111',
        'advisor', 'legacy', 0, 0, 10, 10, '2026-07-25T12:00:00.000Z',
        'pending'
      );
      INSERT INTO credit_usage_records (
        id, authorization_id, status, zero_g_micro_usdc, fmp_micro_usdc,
        leg_service_micro_usdc, total_micro_usdc, provider_reference_hash,
        created_at
      ) VALUES (
        'legacy-usage', 'legacy-authorization', 'settled', 2, 3, 5, 10,
        'legacy-provider-hash', '2026-07-25T12:00:00.000Z'
      );
      INSERT INTO credit_chain_events (
        chain_id, transaction_hash, log_index, block_number, block_hash,
        event_name, wallet, amount_micro_usdc, finality, observed_at
      ) VALUES (
        8453, 'legacy-pending-transaction', 0, 100, 'legacy-block',
        'Deposited', '0x1111111111111111111111111111111111111111',
        10, 'pending', '2026-07-25T12:00:00.000Z'
      ), (
        8453, 'legacy-rejected-transaction', 0, 100, 'legacy-block',
        'Deposited', '0x1111111111111111111111111111111111111111',
        10, 'rejected', '2026-07-25T12:00:00.000Z'
      );
    `);

    legacy.exec(forwardMigration);

    const challenge = legacy
      .prepare<[], { message_hash: string }>(
        "SELECT message_hash FROM credit_challenges WHERE id = 'legacy-challenge'",
      )
      .get();
    const usage = legacy
      .prepare<
        [],
        {
          customer_charge_micro_usdc: number;
          fmp_micro_usdc: number;
          leg_service_micro_usdc: number;
          total_micro_usdc: number;
          zero_g_micro_usdc: number;
        }
      >(
        `SELECT customer_charge_micro_usdc, fmp_micro_usdc,
                leg_service_micro_usdc, total_micro_usdc, zero_g_micro_usdc
         FROM credit_usage_records WHERE id = 'legacy-usage'`,
      )
      .get();
    const authorization = legacy
      .prepare<
        [],
        {
          maximum_charge_micro_usdc: number;
          price_fmp_micro_usdc: number;
          price_leg_service_micro_usdc: number;
          price_0g_micro_usdc: number;
          rejection_reason: string | null;
          reservation_signature: string | null;
          status: string;
        }
      >(
        `SELECT maximum_charge_micro_usdc, price_fmp_micro_usdc,
                price_leg_service_micro_usdc, price_0g_micro_usdc,
                rejection_reason, reservation_signature, status
         FROM credit_authorizations WHERE id = 'legacy-authorization'`,
      )
      .get();
    const legacyStatuses = legacy
      .prepare<[], { rejection_reason: string | null; status: string }>(
        `SELECT rejection_reason, status
         FROM credit_authorizations
         WHERE id IN (
           'legacy-authorization', 'legacy-reserved',
           'legacy-provisional', 'legacy-pending'
         )
         ORDER BY id`,
      )
      .all();
    const session = legacy
      .prepare<[], { expires_at: string; revoked_at: string | null }>(
        "SELECT expires_at, revoked_at FROM credit_sessions WHERE id = 'legacy-session'",
      )
      .get();
    const legacyEvents = legacy
      .prepare<[], { finality: string; reason: string | null }>(
        "SELECT finality, reason FROM credit_chain_events ORDER BY transaction_hash",
      )
      .all();
    assert.equal(challenge?.message_hash, "legacy:legacy-challenge");
    assert.equal(authorization?.maximum_charge_micro_usdc, 0);
    assert.equal(authorization?.price_0g_micro_usdc, 0);
    assert.equal(authorization?.price_fmp_micro_usdc, 0);
    assert.equal(authorization?.price_leg_service_micro_usdc, 0);
    assert.equal(authorization?.reservation_signature, null);
    assert.equal(usage?.customer_charge_micro_usdc, 0);
    assert.deepEqual(
      [
        usage?.zero_g_micro_usdc,
        usage?.fmp_micro_usdc,
        usage?.leg_service_micro_usdc,
        usage?.total_micro_usdc,
      ],
      [2, 3, 5, 10],
    );
    assert.deepEqual(
      legacyStatuses.map(row => row.status),
      ["rejected", "rejected", "rejected", "rejected"],
    );
    assert.ok(
      legacyStatuses.every(
        row =>
          row.rejection_reason ===
          "Legacy authorization rejected: no verified onchain reservation or customer charge exists.",
      ),
    );
    assert.equal(authorization?.status, "rejected");
    assert.ok(authorization?.rejection_reason);
    assert.equal(session?.expires_at, "2099-07-25T12:00:00.000Z");
    assert.ok(session?.revoked_at);
    assert.deepEqual(
      legacyEvents,
      [
        {
          finality: "reversed",
          reason:
            "Legacy chain event reversed: source vault deployment was not recorded.",
        },
        {
          finality: "reversed",
          reason:
            "Legacy chain event reversed: source vault deployment was not recorded.",
        },
      ],
    );
    assert.throws(() =>
      legacy.exec(`
        UPDATE credit_usage_records
        SET customer_charge_micro_usdc = 11
        WHERE id = 'legacy-usage'
      `),
    );
    assert.deepEqual(legacy.pragma("foreign_key_check"), []);
  } finally {
    legacy.close();
  }

  const migrated = createCreditPrismaClient(legacyConfig);
  try {
    const ledger = new CreditLedgerService({
      config: legacyConfig,
      prisma: migrated,
    });
    await assert.rejects(
      ledger.finalize({
        authorizationId: "legacy-authorization",
        components: null,
        outcome: "succeeded",
        providerReference: null,
      }),
      /cannot be finalized.*REJECTED/,
    );
  } finally {
    await migrated.$disconnect();
  }
});

test("production client is singleton and missing schema fails closed", async () => {
  const config = creditConfig("missing-schema.sqlite");
  const first = getCreditPrismaClient(config);
  const second = getCreditPrismaClient(config);

  assert.equal(first, second);
  await assert.rejects(first.creditIndexerState.findUnique({ where: { id: 1 } }));
  await first.$disconnect();
});
