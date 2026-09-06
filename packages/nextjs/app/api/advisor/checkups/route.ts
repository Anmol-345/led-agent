import { NextResponse } from "next/server";
import { isAddress, type Address } from "viem";

import { CheckupService } from "@/lib/advisor/checkup";
import { getAdvisorConfig } from "@/lib/advisor/service";
import { getAdvisorPrismaClient } from "@/lib/advisor/db";

function safeJsonResponse(data: unknown, status = 200) {
  const json = JSON.stringify(data, (_, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  return new NextResponse(json, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getService() {
  const config = getAdvisorConfig();
  const db = getAdvisorPrismaClient(config);
  return new CheckupService({ database: db });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const wallet = searchParams.get("wallet") as Address;

    if (!wallet || !isAddress(wallet)) {
      return safeJsonResponse({ error: "A valid wallet address is required." }, 400);
    }

    const service = getService();
    const subscriptions = await service.listSubscriptions(wallet);
    const pendingCheckups = await service.listPendingCheckups(wallet);

    return safeJsonResponse({ pendingCheckups, subscriptions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch checkups.";
    return safeJsonResponse({ error: message }, 500);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, assets = [], cadence = "weekly", state, subscriptionId, wallet } = body as {
      action?: "create" | "update" | "delete";
      assets?: { chainId: number; tokenAddress: Address }[];
      cadence?: "weekly" | "monthly" | "quarterly";
      state?: "active" | "paused";
      subscriptionId?: string;
      wallet?: Address;
    };

    if (!wallet || !isAddress(wallet)) {
      return safeJsonResponse({ error: "A valid wallet address is required." }, 400);
    }

    const service = getService();

    if (action === "delete") {
      if (!subscriptionId) {
        return safeJsonResponse({ error: "subscriptionId is required for deletion." }, 400);
      }
      await service.deleteSubscription({ subscriptionId, wallet });
      return safeJsonResponse({ success: true });
    }

    if (action === "update") {
      if (!subscriptionId) {
        return safeJsonResponse({ error: "subscriptionId is required for update." }, 400);
      }
      const updated = await service.updateSubscription({
        assets,
        cadence,
        state,
        subscriptionId,
        wallet,
      });
      return safeJsonResponse({ subscription: updated });
    }

    // Default: create subscription
    const created = await service.createSubscription({
      assets,
      cadence,
      wallet,
    });

    return safeJsonResponse({ subscription: created });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to manage checkup subscription.";
    return safeJsonResponse({ error: message }, 400);
  }
}
