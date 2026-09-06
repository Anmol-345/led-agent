import type { Address, Hex, Log } from "viem";

import type { CreditAccountConfig } from "./config";
import type { CreditPrismaClient } from "./db";
import {
  CreditEventFinality,
  type CreditIndexerState,
} from "./generated/prisma/client";
import { BaseVaultClient } from "./vault";

export type VaultLog = {
  address: Address;
  blockHash: Hex;
  blockNumber: bigint;
  data: Hex;
  logIndex: number;
  topics: Log["topics"];
  transactionHash: Hex;
};

export type VaultIndexerRpc = {
  getBlockHash(blockNumber: bigint): Promise<Hex>;
  getLatestBlockNumber(): Promise<bigint>;
  getLogs(fromBlock: bigint, toBlock: bigint): Promise<readonly VaultLog[]>;
};

export type VaultIndexerSyncSummary = {
  confirmedHeadBlockNumber: bigint;
  cursorBlockNumber: bigint;
  headBlockNumber: bigint;
  observedLogs: number;
  projectedEvents: number;
  reversedEvents: number;
  scannedFromBlock: bigint | null;
  scannedToBlock: bigint | null;
};

export type AuthorizationAccountSnapshot = {
  available: bigint;
  blockNumber: bigint;
  pendingDeposits: bigint;
  reserved: bigint;
};

type CustomerProjection = {
  amountMicroUsdc: bigint;
  blockHash: Hex;
  blockNumber: bigint;
  eventName: "Deposited" | "Withdrawn";
  logIndex: bigint;
  transactionHash: Hex;
  wallet: string;
};

const maximumLogBlockRange = 2_000n;
let syncQueue = Promise.resolve();

function serializeSync<Result>(work: () => Promise<Result>): Promise<Result> {
  const result = syncQueue.then(work, work);
  syncQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function minimum(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function maximum(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

async function boundedLogs(
  rpc: VaultIndexerRpc,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<readonly VaultLog[]> {
  const logs: VaultLog[] = [];
  for (
    let chunkStart = fromBlock;
    chunkStart <= toBlock;
    chunkStart += maximumLogBlockRange
  ) {
    const chunkEnd = minimum(
      toBlock,
      chunkStart + maximumLogBlockRange - 1n,
    );
    logs.push(...(await rpc.getLogs(chunkStart, chunkEnd)));
  }
  return logs;
}

function customerProjection(
  vaultClient: BaseVaultClient,
  log: VaultLog,
): CustomerProjection | null {
  if (log.address.toLowerCase() !== vaultClient.vaultAddress.toLowerCase()) {
    return null;
  }

  try {
    const decoded = vaultClient.decodeVaultEventLog({
      data: log.data,
      topics: log.topics,
    });
    switch (decoded.eventName) {
      case "Deposited":
        return {
          amountMicroUsdc: decoded.args.amount,
          blockHash: log.blockHash,
          blockNumber: log.blockNumber,
          eventName: decoded.eventName,
          logIndex: BigInt(log.logIndex),
          transactionHash: log.transactionHash,
          wallet: decoded.args.customer.toLowerCase(),
        };
      case "Withdrawn":
        return {
          amountMicroUsdc: decoded.args.amount,
          blockHash: log.blockHash,
          blockNumber: log.blockNumber,
          eventName: decoded.eventName,
          logIndex: BigInt(log.logIndex),
          transactionHash: log.transactionHash,
          wallet: decoded.args.customer.toLowerCase(),
        };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function defaultRpc(vaultClient: BaseVaultClient): VaultIndexerRpc {
  return {
    async getBlockHash(blockNumber) {
      const block = await vaultClient.publicClient.getBlock({ blockNumber });
      if (block.hash === null) {
        throw new Error(`Base block ${blockNumber} has no canonical hash.`);
      }
      return block.hash;
    },
    getLatestBlockNumber: () => vaultClient.publicClient.getBlockNumber(),
    async getLogs(fromBlock, toBlock) {
      const logs = await vaultClient.publicClient.getLogs({
        address: vaultClient.vaultAddress,
        fromBlock,
        toBlock,
      });
      return logs.flatMap(log =>
        log.blockHash === null ||
        log.blockNumber === null ||
        log.logIndex === null ||
        log.transactionHash === null
          ? []
          : [
              {
                address: log.address,
                blockHash: log.blockHash,
                blockNumber: log.blockNumber,
                data: log.data,
                logIndex: log.logIndex,
                topics: log.topics,
                transactionHash: log.transactionHash,
              },
            ],
      );
    },
  };
}

export class VaultIndexer {
  private readonly chainId: bigint;
  private readonly config: CreditAccountConfig;
  private readonly getAccountSnapshot: (
    customer: Address,
    blockNumber: bigint,
  ) => Promise<{ available: bigint; reserved: bigint; blockNumber: bigint }>;
  private readonly prisma: CreditPrismaClient;
  private readonly rpc: VaultIndexerRpc;
  private readonly vaultClient: BaseVaultClient;

  constructor(options: {
    config: CreditAccountConfig;
    getAccountSnapshot?: (
      customer: Address,
      blockNumber: bigint,
    ) => Promise<{ available: bigint; reserved: bigint; blockNumber: bigint }>;
    prisma: CreditPrismaClient;
    rpc?: VaultIndexerRpc;
    vaultClient: BaseVaultClient;
  }) {
    this.chainId = BigInt(options.config.baseChainId);
    this.config = options.config;
    this.getAccountSnapshot =
      options.getAccountSnapshot ??
      ((customer, blockNumber) =>
        options.vaultClient.getAccountSnapshot(customer, blockNumber));
    this.prisma = options.prisma;
    this.rpc = options.rpc ?? defaultRpc(options.vaultClient);
    this.vaultClient = options.vaultClient;
  }

  sync(headBlockNumber?: bigint): Promise<VaultIndexerSyncSummary> {
    return serializeSync(async () => {
      const state = await this.boundIndexerState();
      return this.runSync(
        state,
        headBlockNumber ?? (await this.rpc.getLatestBlockNumber()),
      );
    });
  }

  processLogs(
    logs: readonly VaultLog[],
    headBlockNumber: bigint,
  ): Promise<void> {
    return serializeSync(async () => {
      await this.runSync(
        await this.boundIndexerState(),
        headBlockNumber,
        logs,
      );
    });
  }

  prepareAuthorizationSnapshot(
    wallet: Address,
  ): Promise<AuthorizationAccountSnapshot> {
    return serializeSync(async () => {
      const state = await this.boundIndexerState();
      const blockNumber = await this.rpc.getLatestBlockNumber();
      const blockHash = await this.rpc.getBlockHash(blockNumber);
      await this.runSync(state, blockNumber);
      const account = await this.getAccountSnapshot(wallet, blockNumber);
      if ((await this.rpc.getBlockHash(blockNumber)) !== blockHash) {
        throw new Error("Base changed the authorization snapshot block during indexing.");
      }
      const pending = await this.prisma.creditChainEvent.findMany({
        select: { amountMicroUsdc: true },
        where: {
          blockNumber: { lte: blockNumber },
          chainId: this.chainId,
          eventName: "Deposited",
          finality: CreditEventFinality.PENDING,
          wallet: wallet.toLowerCase(),
        },
      });
      return {
        available: account.available,
        blockNumber,
        pendingDeposits: pending.reduce(
          (total, event) => total + event.amountMicroUsdc,
          0n,
        ),
        reserved: account.reserved,
      };
    });
  }

  private async boundIndexerState(): Promise<CreditIndexerState> {
    const chainId = this.chainId;
    const deploymentBlock = this.config.creditDeploymentBlock;
    const initialCursor = deploymentBlock - 1n;
    const vaultAddress = this.config.vaultAddress.toLowerCase();

    return this.prisma.$transaction(async transaction => {
      const state = await transaction.creditIndexerState.findUniqueOrThrow({
        where: { id: 1 },
      });
      if (
        state.chainId === chainId &&
        state.vaultAddress === vaultAddress &&
        state.deploymentBlock === deploymentBlock
      ) {
        return state;
      }
      if (
        state.chainId !== null ||
        state.vaultAddress !== null ||
        state.deploymentBlock !== null
      ) {
        throw new Error(
          "Credit database is bound to a different vault deployment.",
        );
      }
      if (state.cursorBlockNumber !== initialCursor) {
        throw new Error(
          "Credit indexer cannot claim an unbound database after its cursor advanced.",
        );
      }
      const eligibleEvents = await transaction.creditChainEvent.count({
        where: {
          finality: {
            in: [
              CreditEventFinality.PENDING,
              CreditEventFinality.CONFIRMED,
            ],
          },
        },
      });
      if (eligibleEvents !== 0) {
        throw new Error(
          "Credit indexer cannot claim an unbound database with eligible chain events.",
        );
      }

      const updatedAt = new Date(
        Math.max(Date.now(), state.updatedAt.getTime() + 1),
      );
      const claim = await transaction.creditIndexerState.updateMany({
        data: {
          chainId,
          deploymentBlock,
          updatedAt,
          vaultAddress,
        },
        where: {
          chainId: null,
          cursorBlockHash: state.cursorBlockHash,
          cursorBlockNumber: initialCursor,
          deploymentBlock: null,
          id: 1,
          updatedAt: state.updatedAt,
          vaultAddress: null,
        },
      });
      if (claim.count !== 1) {
        throw new Error(
          "Credit indexer deployment binding changed concurrently; retry sync.",
        );
      }
      return transaction.creditIndexerState.findUniqueOrThrow({
        where: { id: 1 },
      });
    });
  }

  private async runSync(
    storedState: CreditIndexerState,
    headBlockNumber: bigint,
    suppliedLogs?: readonly VaultLog[],
  ): Promise<VaultIndexerSyncSummary> {
    const initialCursor = this.config.creditDeploymentBlock - 1n;
    const confirmationDepth = BigInt(this.config.confirmations);
    const confirmedCandidate = headBlockNumber - confirmationDepth;
    const confirmedHeadBlockNumber = maximum(initialCursor, confirmedCandidate);
    const storedCursor = maximum(
      initialCursor,
      storedState.cursorBlockNumber,
    );

    let confirmedReorg = false;
    if (
      suppliedLogs === undefined &&
      storedState.cursorBlockHash &&
      storedCursor >= this.config.creditDeploymentBlock &&
      storedCursor <= headBlockNumber
    ) {
      confirmedReorg =
        (await this.rpc.getBlockHash(storedCursor)) !==
        storedState.cursorBlockHash;
    }

    const effectiveCursor = confirmedReorg ? initialCursor : storedCursor;
    const nextConfirmedBlock = effectiveCursor + 1n;
    const pendingWindowStart = maximum(
      this.config.creditDeploymentBlock,
      confirmedHeadBlockNumber + 1n,
    );
    const scanFromBlock = minimum(nextConfirmedBlock, pendingWindowStart);
    const shouldScan =
      scanFromBlock <= headBlockNumber &&
      headBlockNumber >= this.config.creditDeploymentBlock;
    const observedLogs = shouldScan
      ? suppliedLogs?.filter(
          log =>
            log.blockNumber >= scanFromBlock &&
            log.blockNumber <= headBlockNumber,
        ) ?? (await boundedLogs(this.rpc, scanFromBlock, headBlockNumber))
      : [];
    const logs = [
      ...new Map(
        observedLogs.map(log => [
          `${log.address}:${log.transactionHash}:${log.logIndex}`,
          log,
        ]),
      ).values(),
    ];
    const projections = new Map<string, CustomerProjection>();

    for (const log of logs) {
      const projection = customerProjection(this.vaultClient, log);
      if (projection) {
        projections.set(
          `${this.chainId}:${projection.transactionHash}:${projection.logIndex}`,
          projection,
        );
      }
    }

    const cursorBlockNumber = maximum(
      effectiveCursor,
      confirmedHeadBlockNumber,
    );
    const suppliedCursorHash = suppliedLogs?.find(
      log => log.blockNumber === cursorBlockNumber,
    )?.blockHash;
    const cursorBlockHash =
      cursorBlockNumber < this.config.creditDeploymentBlock
        ? null
        : suppliedLogs
          ? suppliedCursorHash ??
            (cursorBlockNumber === storedCursor
              ? storedState.cursorBlockHash
              : null)
          : await this.rpc.getBlockHash(cursorBlockNumber);
    let reversedEvents = 0;
    const cursorUpdatedAt = new Date(
      Math.max(Date.now(), storedState.updatedAt.getTime() + 1),
    );

    await this.prisma.$transaction(async transaction => {
      if (confirmedReorg) {
        const result = await transaction.creditChainEvent.updateMany({
          data: {
            finality: CreditEventFinality.REVERSED,
            reason: "Canonical Base history changed after confirmation.",
          },
          where: {
            blockNumber: { gte: this.config.creditDeploymentBlock },
            chainId: this.chainId,
          },
        });
        reversedEvents += result.count;
      }

      if (shouldScan) {
        const result = await transaction.creditChainEvent.updateMany({
          data: {
            finality: CreditEventFinality.REVERSED,
            reason: "Replaced by a Base reorganization before confirmation.",
          },
          where: {
            blockNumber: {
              gte: scanFromBlock,
              lte: headBlockNumber,
            },
            chainId: this.chainId,
            finality: CreditEventFinality.PENDING,
          },
        });
        reversedEvents += result.count;
      }

      for (const projection of projections.values()) {
        const finality =
          projection.blockNumber <= confirmedHeadBlockNumber
            ? CreditEventFinality.CONFIRMED
            : CreditEventFinality.PENDING;
        await transaction.creditChainEvent.upsert({
          create: {
            amountMicroUsdc: projection.amountMicroUsdc,
            blockHash: projection.blockHash,
            blockNumber: projection.blockNumber,
            chainId: this.chainId,
            eventName: projection.eventName,
            finality,
            logIndex: projection.logIndex,
            observedAt: new Date(),
            transactionHash: projection.transactionHash,
            wallet: projection.wallet,
          },
          update: {
            amountMicroUsdc: projection.amountMicroUsdc,
            blockHash: projection.blockHash,
            blockNumber: projection.blockNumber,
            eventName: projection.eventName,
            finality,
            reason: null,
            wallet: projection.wallet,
          },
          where: {
            chainId_transactionHash_logIndex: {
              chainId: this.chainId,
              logIndex: projection.logIndex,
              transactionHash: projection.transactionHash,
            },
          },
        });
      }

      const cursorUpdate = await transaction.creditIndexerState.updateMany({
        data: {
          cursorBlockHash,
          cursorBlockNumber,
          updatedAt: cursorUpdatedAt,
        },
        where: {
          cursorBlockHash: storedState.cursorBlockHash,
          cursorBlockNumber: storedState.cursorBlockNumber,
          id: 1,
          updatedAt: storedState.updatedAt,
        },
      });
      if (cursorUpdate.count !== 1) {
        throw new Error(
          "Credit indexer cursor changed concurrently; retry sync.",
        );
      }
    });

    return {
      confirmedHeadBlockNumber,
      cursorBlockNumber,
      headBlockNumber,
      observedLogs: logs.length,
      projectedEvents: projections.size,
      reversedEvents,
      scannedFromBlock: shouldScan ? scanFromBlock : null,
      scannedToBlock: shouldScan ? headBlockNumber : null,
    };
  }
}
