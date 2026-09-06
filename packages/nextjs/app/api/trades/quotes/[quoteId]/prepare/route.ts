import { NextRequest } from "next/server";
import { getTradingService } from "@/lib/trading/service";

export const runtime = "nodejs";
const privateNoStoreHeaders = { "Cache-Control": "private, no-store" };

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ quoteId: string }> }
): Promise<Response> {
  try {
    const params = await props.params;
    const quoteId = params.quoteId;
    const body = await request.json();
    const { sessionAction } = body;

    const { orchestrator } = getTradingService();
    const result = await orchestrator.prepareAction({
      sessionAction,
      quoteId,
    });

    if (!result.success) {
      return Response.json(
        { error: result.reason },
        { status: 422, headers: privateNoStoreHeaders }
      );
    }

    return Response.json(
      { quote: result.quote, order: result.order },
      { headers: privateNoStoreHeaders }
    );
  } catch (err: any) {
    return Response.json(
      { error: err.message || "Failed to prepare trade action" },
      { status: 500, headers: privateNoStoreHeaders }
    );
  }
}
