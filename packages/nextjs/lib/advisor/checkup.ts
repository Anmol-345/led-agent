import { randomUUID } from "node:crypto";
import { getAddress, type Address } from "viem";
import type { AdvisorPrismaClient } from "./db";

export type CheckupCadence = "weekly" | "monthly" | "quarterly";
export type SubscriptionState = "active" | "paused";
export type CheckupState = "pending" | "completed" | "skipped";

export type CheckupAsset = {
  chainId: number;
  tokenAddress: Address;
};

export type CheckupSubscription = {
  assets: CheckupAsset[];
  cadence: CheckupCadence;
  createdAt: Date;
  id: string;
  nextDueAt: Date;
  state: SubscriptionState;
  updatedAt: Date;
  wallet: Address;
};

export type PendingCheckup = {
  assets: CheckupAsset[];
  cadence: CheckupCadence;
  dueAt: Date;
  id: string;
  state: CheckupState;
  subscriptionId: string;
  wallet: Address;
};

const cadenceMs: Record<CheckupCadence, number> = {
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
  quarterly: 90 * 24 * 60 * 60 * 1000,
};

export class CheckupService {
  private readonly database: AdvisorPrismaClient;

  constructor(options: { database: AdvisorPrismaClient }) {
    this.database = options.database;
  }

  async createSubscription(input: {
    assets: CheckupAsset[];
    cadence: CheckupCadence;
    now?: Date;
    wallet: Address;
  }): Promise<CheckupSubscription> {
    const wallet = getAddress(input.wallet);
    const now = input.now ?? new Date();
    const id = randomUUID();
    const nextDueAt = new Date(now.getTime() + cadenceMs[input.cadence]);

    await this.database.$transaction(async tx => {
      await tx.advisorCheckupSubscription.create({
        data: {
          cadence: input.cadence.toUpperCase() as any,
          createdAt: now,
          id,
          nextDueAt,
          state: "ACTIVE",
          updatedAt: now,
          wallet,
        },
      });

      for (const asset of input.assets) {
        await tx.advisorCheckupAsset.create({
          data: {
            chainId: BigInt(asset.chainId),
            id: randomUUID(),
            subscriptionId: id,
            tokenAddress: getAddress(asset.tokenAddress),
          },
        });
      }
    });

    return this.getSubscription(id);
  }

  async updateSubscription(input: {
    assets?: CheckupAsset[];
    cadence?: CheckupCadence;
    state?: SubscriptionState;
    subscriptionId: string;
    wallet: Address;
  }): Promise<CheckupSubscription> {
    const wallet = getAddress(input.wallet);
    const sub = await this.database.advisorCheckupSubscription.findFirst({
      where: { id: input.subscriptionId, wallet },
    });
    if (!sub) throw new Error("Checkup subscription not found.");

    const now = new Date();
    const updateData: any = { updatedAt: now };

    if (input.state) {
      updateData.state = input.state.toUpperCase();
    }
    if (input.cadence) {
      updateData.cadence = input.cadence.toUpperCase();
      updateData.nextDueAt = new Date(now.getTime() + cadenceMs[input.cadence]);
    }

    await this.database.$transaction(async tx => {
      await tx.advisorCheckupSubscription.update({
        where: { id: input.subscriptionId },
        data: updateData,
      });

      if (input.assets) {
        await tx.advisorCheckupAsset.deleteMany({
          where: { subscriptionId: input.subscriptionId },
        });
        for (const asset of input.assets) {
          await tx.advisorCheckupAsset.create({
            data: {
              chainId: BigInt(asset.chainId),
              id: randomUUID(),
              subscriptionId: input.subscriptionId,
              tokenAddress: getAddress(asset.tokenAddress),
            },
          });
        }
      }
    });

    return this.getSubscription(input.subscriptionId);
  }

  async deleteSubscription(input: { subscriptionId: string; wallet: Address }): Promise<void> {
    const wallet = getAddress(input.wallet);
    await this.database.$transaction(async tx => {
      await tx.advisorCheckupAsset.deleteMany({
        where: { subscriptionId: input.subscriptionId },
      });
      await tx.advisorCheckup.deleteMany({
        where: { subscriptionId: input.subscriptionId },
      });
      await tx.advisorCheckupSubscription.deleteMany({
        where: { id: input.subscriptionId, wallet },
      });
    });
  }

  async listSubscriptions(wallet: Address): Promise<CheckupSubscription[]> {
    const normalizedWallet = getAddress(wallet);
    const subs = await this.database.advisorCheckupSubscription.findMany({
      where: { wallet: normalizedWallet },
      include: { assets: true },
    });

    return subs.map(s => ({
      assets: (s.assets || []).map(a => ({
        chainId: Number(a.chainId),
        tokenAddress: getAddress(a.tokenAddress),
      })),
      cadence: s.cadence.toLowerCase() as CheckupCadence,
      createdAt: s.createdAt,
      id: s.id,
      nextDueAt: s.nextDueAt,
      state: s.state.toLowerCase() as SubscriptionState,
      updatedAt: s.updatedAt,
      wallet: getAddress(s.wallet),
    }));
  }

  async getSubscription(subscriptionId: string): Promise<CheckupSubscription> {
    const sub = await this.database.advisorCheckupSubscription.findUnique({
      where: { id: subscriptionId },
      include: { assets: true },
    });
    if (!sub) throw new Error("Checkup subscription not found.");

    return {
      assets: (sub.assets || []).map(a => ({
        chainId: Number(a.chainId),
        tokenAddress: getAddress(a.tokenAddress),
      })),
      cadence: sub.cadence.toLowerCase() as CheckupCadence,
      createdAt: sub.createdAt,
      id: sub.id,
      nextDueAt: sub.nextDueAt,
      state: sub.state.toLowerCase() as SubscriptionState,
      updatedAt: sub.updatedAt,
      wallet: getAddress(sub.wallet),
    };
  }

  /**
   * Protected scheduler method: scans active subscriptions that are due, and idempotently creates
   * PENDING checkups without initiating any paid provider work or debiting credit.
   */
  async syncPendingCheckups(input: { now: Date }): Promise<{ syncedCount: number }> {
    const dueSubscriptions = await this.database.advisorCheckupSubscription.findMany({
      where: {
        nextDueAt: { lte: input.now },
        state: "ACTIVE",
      },
      include: { assets: true },
    });

    let syncedCount = 0;

    for (const sub of dueSubscriptions) {
      const existing = await this.database.advisorCheckup.findUnique({
        where: {
          wallet_subscriptionId_dueAt: {
            dueAt: sub.nextDueAt,
            subscriptionId: sub.id,
            wallet: sub.wallet,
          },
        },
      });

      if (!existing) {
        const nextDueAt = new Date(input.now.getTime() + cadenceMs[sub.cadence.toLowerCase() as CheckupCadence]);

        await this.database.$transaction(async tx => {
          await tx.advisorCheckup.create({
            data: {
              createdAt: input.now,
              dueAt: sub.nextDueAt,
              id: randomUUID(),
              state: "PENDING",
              subscriptionId: sub.id,
              wallet: sub.wallet,
            },
          });

          await tx.advisorCheckupSubscription.update({
            where: { id: sub.id },
            data: { nextDueAt, updatedAt: input.now },
          });
        });

        syncedCount++;
      }
    }

    return { syncedCount };
  }

  async listPendingCheckups(wallet: Address): Promise<PendingCheckup[]> {
    const normalizedWallet = getAddress(wallet);
    const pending = await this.database.advisorCheckup.findMany({
      where: { state: "PENDING", wallet: normalizedWallet },
      include: {
        subscription: {
          include: { assets: true },
        },
      },
    });

    return pending
      .filter(p => p.subscription != null)
      .map(p => ({
        assets: (p.subscription.assets || []).map(a => ({
          chainId: Number(a.chainId),
          tokenAddress: getAddress(a.tokenAddress),
        })),
        cadence: (p.subscription.cadence || "weekly").toLowerCase() as CheckupCadence,
        dueAt: p.dueAt,
        id: p.id,
        state: p.state.toLowerCase() as CheckupState,
        subscriptionId: p.subscriptionId,
        wallet: getAddress(p.wallet),
      }));
  }

  async markCheckupCompleted(input: { checkupId: string; runId: string }): Promise<void> {
    await this.database.advisorCheckup.update({
      where: { id: input.checkupId },
      data: {
        resolvedAt: new Date(),
        runId: input.runId,
        state: "COMPLETED",
      },
    });
  }
}
