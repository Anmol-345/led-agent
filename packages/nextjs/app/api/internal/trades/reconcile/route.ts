import { NextRequest } from "next/server";
import { reconcilePendingOrders } from "@/lib/trading/reconciler";
import { getTradingService } from "@/lib/trading/service";

export const runtime = "nodejs";
const privateNoStoreHeaders = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const authHeader = request.headers.get("authorization");
    const expectedSecret = process.env.TRADE_RECONCILER_SECRET;

    if (
      expectedSecret &&
      (!authHeader || authHeader !== `Bearer ${expectedSecret}`)
    ) {
      return Response.json(
        { error: "Unauthorized reconciliation request" },
        { status: 401, headers: privateNoStoreHeaders }
      );
    }

    const { repository, config, orchestrator } = getTradingService();
    // Gateway from service
    const gateway = (orchestrator as any).gateway;

    const summary = await reconcilePendingOrders(repository, gateway, config);

    return Response.json({ summary }, { headers: privateNoStoreHeaders });
  } catch (err: any) {
    return Response.json(
      { error: err.message || "Reconciliation failed" },
      { status: 500, headers: privateNoStoreHeaders }
    );
  }
}
