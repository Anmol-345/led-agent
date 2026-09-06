import { NextRequest } from "next/server";
import { getTradingService } from "@/lib/trading/service";

export const runtime = "nodejs";
const privateNoStoreHeaders = { "Cache-Control": "private, no-store" };

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ orderId: string }> }
): Promise<Response> {
  try {
    const params = await props.params;
    const orderId = params.orderId;
    const body = await request.json();
    const { sessionAction } = body;

    const { orchestrator } = getTradingService();
    const result = await orchestrator.getOrderStatus({
      sessionAction,
      orderId,
    });

    if (!result.success) {
      return Response.json(
        { error: result.reason },
        { status: 422, headers: privateNoStoreHeaders }
      );
    }

    return Response.json(
      { order: result.order, receipt: result.receipt },
      { headers: privateNoStoreHeaders }
    );
  } catch (err: any) {
    return Response.json(
      { error: err.message || "Failed to fetch order status" },
      { status: 500, headers: privateNoStoreHeaders }
    );
  }
}
