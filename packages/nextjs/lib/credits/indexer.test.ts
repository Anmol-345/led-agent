import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  encodeAbiParameters,
  padHex,
  parseAbiParameters,
  toEventSelector,
  toHex,
  type Address,
  type Hex,
} from "viem";

import { parseCreditRuntimeConfig, type CreditRuntimeEnvironment } from "./config";
import { createCreditPrismaClient, migrateCreditDatabase } from "./db";
import { VaultIndexer, type VaultIndexerRpc, type VaultLog } from "./indexer";
import { BaseVaultClient } from "./vault";
import { DEPLOYMENT } from "../deployment";

/** Credit events are indexed on the vault chain, which follows the deploy target. */
const VAULT_CHAIN_ID_BIG = BigInt(DEPLOYMENT.vaultChainId);

const vaultAddress = "0x1111111111111111111111111111111111111111";
const alternateVaultAddress = "0x3333333333333333333333333333333333333333";
const wallet = "0x2222222222222222222222222222222222222222";
const testEnvironment: CreditRuntimeEnvironment = {
  CREDIT_APP_ORIGIN: "https://leg.example.test",
  CREDIT_BASE_RPC_URL: "https://base.example.test",
  CREDIT_BILLING_SIGNER_PRIVATE_KEY: `0x${"1".repeat(64)}`,
  CREDIT_CONFIRMATIONS: "2",
  CREDIT_DEPLOYMENT_BLOCK: "100",
  CREDIT_SCHEDULER_SECRET: "scheduler-secret-with-at-least-thirty-two-characters",
  CREDIT_VAULT_ADDRESS: vaultAddress,
  CREDIT_USDC_ADDRESS: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  FMP_PRODUCTION_LICENSE_CONFIRMED: "true",
};

function blockHash(blockNumber: bigint): Hex {
  return toHex(blockNumber, { size: 32 });
}

function depositedLog(input: {
  blockNumber: bigint;
  transactionNumber: bigint;
  amount?: bigint;
  address?: Address;
  blockHash?: Hex;
}): VaultLog {
  return {
    address: input.address ?? vaultAddress,
    blockHash: input.blockHash ?? blockHash(input.blockNumber),
    blockNumber: input.blockNumber,
    data: encodeAbiParameters(parseAbiParameters("uint256"), [input.amount ?? 100n]),
    logIndex: 0,
    topics: [
      toEventSelector("Deposited(address,uint256)"),
      padHex(wallet, { size: 32 }),
    ],
    transactionHash: toHex(input.transactionNumber, { size: 32 }),
  };
}

function revenueLog(blockNumber: bigint): VaultLog {
  return {
    address: vaultAddress,
    blockHash: blockHash(blockNumber),
    blockNumber,
    data: encodeAbiParameters(parseAbiParameters("uint256"), [100n]),
    logIndex: 0,
    topics: [
      toEventSelector("RevenueWithdrawn(address,uint256)"),
      padHex(wallet, { size: 32 }),
    ],
    transactionHash: toHex(999n, { size: 32 }),
  };
}

async function setupTest() {
  const directory = mkdtempSync(join(tmpdir(), "leg-indexer-test-"));
  const config = parseCreditRuntimeConfig({
    ...testEnvironment,
    CREDIT_DATABASE_PATH: join(directory, "credits.sqlite"),
  });
  await migrateCreditDatabase(config);
  const prisma = createCreditPrismaClient(config);
  const vaultClient = new BaseVaultClient({
    rpcUrl: config.baseRpcUrl,
    vaultAddress: config.vaultAddress,
  });

  let head = 105n;
  let logs: VaultLog[] = [];
  let activeCalls = 0;
  let maximumActiveCalls = 0;
  const scans: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
  const hashOverrides = new Map<bigint, Hex>();
  const rpc: VaultIndexerRpc = {
    async getBlockHash(blockNumber) {
      return hashOverrides.get(blockNumber) ?? blockHash(blockNumber);
    },
    async getLatestBlockNumber() {
      return head;
    },
    async getLogs(fromBlock, toBlock) {
      activeCalls += 1;
      maximumActiveCalls = Math.max(maximumActiveCalls, activeCalls);
      scans.push({ fromBlock, toBlock });
      await new Promise(resolve => setImmediate(resolve));
      activeCalls -= 1;
      return logs.filter(
        log => log.blockNumber >= fromBlock && log.blockNumber <= toBlock,
      );
    },
  };
  const indexer = new VaultIndexer({ config, prisma, rpc, vaultClient });

  return {
    config,
    directory,
    getMaximumActiveCalls: () => maximumActiveCalls,
    hashOverrides,
    indexer,
    prisma,
    rpc,
    scans,
    setHead: (nextHead: bigint) => {
      head = nextHead;
    },
    setLogs: (nextLogs: VaultLog[]) => {
      logs = nextLogs;
    },
    vaultClient,
  };
}

test("advances the confirmed cursor across an empty range from deployment", async t => {
  const context = await setupTest();
  t.after(async () => {
    await context.prisma.$disconnect();
    rmSync(context.directory, { force: true, recursive: true });
  });

  const summary = await context.indexer.sync();
  const state = await context.prisma.creditIndexerState.findUniqueOrThrow({
    where: { id: 1 },
  });

  assert.equal(summary.confirmedHeadBlockNumber, 103n);
  assert.equal(summary.projectedEvents, 0);
  assert.equal(state.cursorBlockNumber, 103n);
  assert.equal(state.cursorBlockHash, blockHash(103n));
  assert.equal(state.chainId, VAULT_CHAIN_ID_BIG);
  assert.equal(state.vaultAddress, vaultAddress);
  assert.equal(state.deploymentBlock, 100n);
  assert.deepEqual(context.scans, [{ fromBlock: 100n, toBlock: 105n }]);
});

test("binds a pristine database once and rejects another vault or deployment", async t => {
  const context = await setupTest();
  t.after(async () => {
    await context.prisma.$disconnect();
    rmSync(context.directory, { force: true, recursive: true });
  });
  await context.indexer.sync();

  const wrongVaultConfig = parseCreditRuntimeConfig({
    ...testEnvironment,
    CREDIT_DATABASE_PATH: context.config.databasePath,
    CREDIT_VAULT_ADDRESS: alternateVaultAddress,
  });
  const wrongVaultIndexer = new VaultIndexer({
    config: wrongVaultConfig,
    prisma: context.prisma,
    rpc: context.rpc,
    vaultClient: new BaseVaultClient({
      rpcUrl: wrongVaultConfig.baseRpcUrl,
      vaultAddress: wrongVaultConfig.vaultAddress,
    }),
  });
  await assert.rejects(
    wrongVaultIndexer.sync(105n),
    /bound to a different vault deployment/,
  );

  const wrongDeploymentConfig = parseCreditRuntimeConfig({
    ...testEnvironment,
    CREDIT_DATABASE_PATH: context.config.databasePath,
    CREDIT_DEPLOYMENT_BLOCK: "101",
  });
  const wrongDeploymentIndexer = new VaultIndexer({
    config: wrongDeploymentConfig,
    prisma: context.prisma,
    rpc: context.rpc,
    vaultClient: context.vaultClient,
  });
  await assert.rejects(
    wrongDeploymentIndexer.prepareAuthorizationSnapshot(wallet),
    /bound to a different vault deployment/,
  );
});

test("refuses to claim an unbound database whose cursor already advanced", async t => {
  const context = await setupTest();
  t.after(async () => {
    await context.prisma.$disconnect();
    rmSync(context.directory, { force: true, recursive: true });
  });
  await context.prisma.creditIndexerState.update({
    data: {
      cursorBlockNumber: 100n,
      updatedAt: new Date(),
    },
    where: { id: 1 },
  });

  await assert.rejects(
    context.indexer.sync(),
    /cannot claim an unbound database after its cursor advanced/,
  );

  await context.prisma.creditIndexerState.update({
    data: {
      cursorBlockNumber: 99n,
      updatedAt: new Date(),
    },
    where: { id: 1 },
  });
  await context.prisma.creditChainEvent.create({
    data: {
      amountMicroUsdc: 100n,
      blockHash: blockHash(100n),
      blockNumber: 100n,
      chainId: VAULT_CHAIN_ID_BIG,
      eventName: "Deposited",
      finality: "PENDING",
      logIndex: 0n,
      observedAt: new Date(),
      transactionHash: toHex(9_999n, { size: 32 }),
      wallet,
    },
  });
  await assert.rejects(
    context.indexer.sync(),
    /cannot claim an unbound database with eligible chain events/,
  );
});

test("fetches a long scan as bounded contiguous RPC ranges", async t => {
  const context = await setupTest();
  t.after(async () => {
    await context.prisma.$disconnect();
    rmSync(context.directory, { force: true, recursive: true });
  });
  context.setHead(4_205n);

  const summary = await context.indexer.sync();

  assert.deepEqual(context.scans, [
    { fromBlock: 100n, toBlock: 2_099n },
    { fromBlock: 2_100n, toBlock: 4_099n },
    { fromBlock: 4_100n, toBlock: 4_205n },
  ]);
  assert.ok(
    context.scans.every(
      scan => scan.toBlock - scan.fromBlock + 1n <= 2_000n,
    ),
  );
  assert.equal(summary.cursorBlockNumber, 4_203n);
});

test("promotes a pending deposit on a later sync and resumes after restart", async t => {
  const context = await setupTest();
  t.after(async () => {
    await context.prisma.$disconnect();
    rmSync(context.directory, { force: true, recursive: true });
  });

  const log = depositedLog({ blockNumber: 102n, transactionNumber: 1n });
  context.setHead(103n);
  context.setLogs([log, log]);
  await context.indexer.sync();

  const pending = await context.prisma.creditChainEvent.findUniqueOrThrow({
    where: {
      chainId_transactionHash_logIndex: {
        chainId: VAULT_CHAIN_ID_BIG,
        logIndex: 0n,
        transactionHash: log.transactionHash,
      },
    },
  });
  assert.equal(pending.finality, "PENDING");
  assert.equal(await context.prisma.creditChainEvent.count(), 1);

  context.setHead(104n);
  const restarted = new VaultIndexer({
    config: context.config,
    prisma: context.prisma,
    rpc: {
      getBlockHash: async blockNumber => blockHash(blockNumber),
      getLatestBlockNumber: async () => 104n,
      getLogs: async (fromBlock, toBlock) => {
        context.scans.push({ fromBlock, toBlock });
        return [log].filter(
          entry =>
            entry.blockNumber >= fromBlock && entry.blockNumber <= toBlock,
        );
      },
    },
    vaultClient: context.vaultClient,
  });
  await restarted.sync();

  const confirmed = await context.prisma.creditChainEvent.findUniqueOrThrow({
    where: {
      chainId_transactionHash_logIndex: {
        chainId: VAULT_CHAIN_ID_BIG,
        logIndex: 0n,
        transactionHash: log.transactionHash,
      },
    },
  });
  assert.equal(confirmed.finality, "CONFIRMED");
  assert.equal(context.scans.at(-1)?.fromBlock, 102n);
});

test("automatically reverses an orphaned pending deposit with a safe reason", async t => {
  const context = await setupTest();
  t.after(async () => {
    await context.prisma.$disconnect();
    rmSync(context.directory, { force: true, recursive: true });
  });

  const orphan = depositedLog({
    blockHash: toHex(1_002n, { size: 32 }),
    blockNumber: 102n,
    transactionNumber: 2n,
  });
  context.setHead(103n);
  context.setLogs([orphan]);
  await context.indexer.sync();

  const replacement = depositedLog({
    blockHash: toHex(2_002n, { size: 32 }),
    blockNumber: 102n,
    transactionNumber: 3n,
  });
  context.setLogs([replacement]);
  await context.indexer.sync();

  const reversed = await context.prisma.creditChainEvent.findUniqueOrThrow({
    where: {
      chainId_transactionHash_logIndex: {
        chainId: VAULT_CHAIN_ID_BIG,
        logIndex: 0n,
        transactionHash: orphan.transactionHash,
      },
    },
  });
  const canonical = await context.prisma.creditChainEvent.findUniqueOrThrow({
    where: {
      chainId_transactionHash_logIndex: {
        chainId: VAULT_CHAIN_ID_BIG,
        logIndex: 0n,
        transactionHash: replacement.transactionHash,
      },
    },
  });

  assert.equal(reversed.finality, "REVERSED");
  assert.equal(
    reversed.reason,
    "Replaced by a Base reorganization before confirmation.",
  );
  assert.equal(canonical.finality, "PENDING");
});

test("rewinds to deployment when a confirmed cursor hash is no longer canonical", async t => {
  const context = await setupTest();
  t.after(async () => {
    await context.prisma.$disconnect();
    rmSync(context.directory, { force: true, recursive: true });
  });
  const orphan = depositedLog({
    blockNumber: 100n,
    transactionNumber: 20n,
  });
  context.setLogs([orphan]);
  await context.indexer.sync();
  context.setLogs([]);
  context.hashOverrides.set(103n, toHex(9_103n, { size: 32 }));

  const summary = await context.indexer.sync();
  const reversed = await context.prisma.creditChainEvent.findUniqueOrThrow({
    where: {
      chainId_transactionHash_logIndex: {
        chainId: VAULT_CHAIN_ID_BIG,
        logIndex: 0n,
        transactionHash: orphan.transactionHash,
      },
    },
  });

  assert.equal(summary.scannedFromBlock, 100n);
  assert.equal(reversed.finality, "REVERSED");
  assert.equal(
    reversed.reason,
    "Canonical Base history changed after confirmation.",
  );
});

test("serializes concurrent sync calls across indexer instances", async t => {
  const context = await setupTest();
  t.after(async () => {
    await context.prisma.$disconnect();
    rmSync(context.directory, { force: true, recursive: true });
  });
  const second = new VaultIndexer({
    config: context.config,
    prisma: context.prisma,
    rpc: context.rpc,
    vaultClient: context.vaultClient,
  });

  await Promise.all([context.indexer.sync(), second.sync()]);

  assert.equal(context.getMaximumActiveCalls(), 1);
  assert.equal(
    (await context.prisma.creditIndexerState.findUniqueOrThrow({ where: { id: 1 } }))
      .cursorBlockNumber,
    103n,
  );
});

test("database cursor CAS rejects a stale independent client without event downgrade", async t => {
  const context = await setupTest();
  const competingClient = createCreditPrismaClient(context.config);
  t.after(async () => {
    await competingClient.$disconnect();
    await context.prisma.$disconnect();
    rmSync(context.directory, { force: true, recursive: true });
  });
  const log = depositedLog({
    blockNumber: 104n,
    transactionNumber: 44n,
  });
  let competingWriteComplete = false;
  const staleIndexer = new VaultIndexer({
    config: context.config,
    prisma: context.prisma,
    rpc: {
      getBlockHash: async blockNumber => blockHash(blockNumber),
      getLatestBlockNumber: async () => 105n,
      getLogs: async () => {
        if (!competingWriteComplete) {
          await competingClient.$transaction(async transaction => {
            await transaction.creditChainEvent.create({
              data: {
                amountMicroUsdc: 100n,
                blockHash: log.blockHash,
                blockNumber: log.blockNumber,
                chainId: VAULT_CHAIN_ID_BIG,
                eventName: "Deposited",
                finality: "CONFIRMED",
                logIndex: 0n,
                observedAt: new Date(),
                transactionHash: log.transactionHash,
                wallet,
              },
            });
            await transaction.creditIndexerState.update({
              data: {
                cursorBlockHash: blockHash(104n),
                cursorBlockNumber: 104n,
                updatedAt: new Date(),
              },
              where: { id: 1 },
            });
          });
          competingWriteComplete = true;
        }
        return [log];
      },
    },
    vaultClient: context.vaultClient,
  });

  await assert.rejects(
    staleIndexer.sync(),
    /cursor changed concurrently/,
  );

  const state = await competingClient.creditIndexerState.findUniqueOrThrow({
    where: { id: 1 },
  });
  const event = await competingClient.creditChainEvent.findUniqueOrThrow({
    where: {
      chainId_transactionHash_logIndex: {
        chainId: VAULT_CHAIN_ID_BIG,
        logIndex: 0n,
        transactionHash: log.transactionHash,
      },
    },
  });
  assert.equal(state.cursorBlockNumber, 104n);
  assert.equal(state.cursorBlockHash, blockHash(104n));
  assert.equal(event.finality, "CONFIRMED");
});

test("ignores other contracts and configured-vault logs without customer movement", async t => {
  const context = await setupTest();
  t.after(async () => {
    await context.prisma.$disconnect();
    rmSync(context.directory, { force: true, recursive: true });
  });
  context.setLogs([
    depositedLog({
      address: "0x3333333333333333333333333333333333333333",
      blockNumber: 102n,
      transactionNumber: 4n,
    }),
    revenueLog(102n),
    {
      ...depositedLog({
        blockNumber: 102n,
        transactionNumber: 400n,
      }),
      topics: [toHex(123n, { size: 32 })],
    },
  ]);

  const summary = await context.indexer.sync();

  assert.equal(summary.observedLogs, 3);
  assert.equal(summary.projectedEvents, 0);
  assert.equal(await context.prisma.creditChainEvent.count(), 0);
});

test("does not fabricate chain events for reverted wallet transactions", async t => {
  const context = await setupTest();
  t.after(async () => {
    await context.prisma.$disconnect();
    rmSync(context.directory, { force: true, recursive: true });
  });

  context.setLogs([]);
  await context.indexer.sync();

  assert.equal(await context.prisma.creditChainEvent.count(), 0);
});

test("uses one chosen head for authorization snapshot indexing and vault reads", async t => {
  const context = await setupTest();
  t.after(async () => {
    await context.prisma.$disconnect();
    rmSync(context.directory, { force: true, recursive: true });
  });
  context.setHead(103n);
  context.setLogs([
    depositedLog({
      amount: 40n,
      blockNumber: 102n,
      transactionNumber: 5n,
    }),
  ]);
  let snapshotBlock: bigint | undefined;
  const indexer = new VaultIndexer({
    config: context.config,
    getAccountSnapshot: async (_customer, blockNumber) => {
      snapshotBlock = blockNumber;
      return { available: 140n, blockNumber, reserved: 10n };
    },
    prisma: context.prisma,
    rpc: {
      getBlockHash: async blockNumber => blockHash(blockNumber),
      getLatestBlockNumber: async () => 103n,
      getLogs: async (fromBlock, toBlock) =>
        depositedLog({
          amount: 40n,
          blockNumber: 102n,
          transactionNumber: 5n,
        }).blockNumber >= fromBlock &&
        depositedLog({
          amount: 40n,
          blockNumber: 102n,
          transactionNumber: 5n,
        }).blockNumber <= toBlock
          ? [
              depositedLog({
                amount: 40n,
                blockNumber: 102n,
                transactionNumber: 5n,
              }),
            ]
          : [],
    },
    vaultClient: context.vaultClient,
  });

  const snapshot = await indexer.prepareAuthorizationSnapshot(wallet);

  assert.equal(snapshot.blockNumber, 103n);
  assert.equal(snapshotBlock, 103n);
  assert.equal(snapshot.available, 140n);
  assert.equal(snapshot.reserved, 10n);
  assert.equal(snapshot.pendingDeposits, 40n);
});

test("fails an authorization snapshot closed if its chosen block reorganizes", async t => {
  const context = await setupTest();
  t.after(async () => {
    await context.prisma.$disconnect();
    rmSync(context.directory, { force: true, recursive: true });
  });
  let headHashReads = 0;
  const indexer = new VaultIndexer({
    config: context.config,
    getAccountSnapshot: async (_customer, blockNumber) => ({
      available: 100n,
      blockNumber,
      reserved: 0n,
    }),
    prisma: context.prisma,
    rpc: {
      getBlockHash: async blockNumber => {
        if (blockNumber !== 105n) return blockHash(blockNumber);
        headHashReads += 1;
        return toHex(105n + BigInt(headHashReads), { size: 32 });
      },
      getLatestBlockNumber: async () => 105n,
      getLogs: async () => [],
    },
    vaultClient: context.vaultClient,
  });

  await assert.rejects(
    indexer.prepareAuthorizationSnapshot(wallet),
    /changed the authorization snapshot block/,
  );
});
