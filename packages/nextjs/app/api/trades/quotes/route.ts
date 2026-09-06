import { NextRequest } from "next/server";
import { getTradingService } from "@/lib/trading/service";

export const runtime = "nodejs";
const privateNoStoreHeaders = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = await request.json();
    const {
      sessionAction,
      recommendation,
      assetReference,
      chainId,
      amount,
      inputTokenAddress,
    } = body;

    const { orchestrator } = getTradingService();
    const result = await orchestrator.requestQuote({
      sessionAction,
      recommendation,
      assetReference,
      chainId: Number(chainId),
      amount: String(amount),
      inputTokenAddress,
    });

    if (!result.success) {
      const providerFailure = result.reason.startsWith("Uniswap API ");
      return Response.json(
        { error: result.reason },
        { status: providerFailure ? 502 : 422, headers: privateNoStoreHeaders }
      );
    }

    // `standIn` is only present on the testnet deployment, where `quote` is a substitute
    // swap and `displayQuote` holds the real mainnet pricing. Clients must render the
    // stand-in disclosure whenever it is set.
    return Response.json(
      {
        quote: result.quote,
        order: result.order,
        ...(result.approval ? { approval: result.approval } : {}),
        ...(result.displayQuote ? { displayQuote: result.displayQuote } : {}),
        ...(result.standIn ? { standIn: result.standIn } : {}),
      },
      { headers: privateNoStoreHeaders }
    );
  } catch (err: any) {
    return Response.json(
      { error: err.message || "Failed to create quote" },
      { status: 500, headers: privateNoStoreHeaders }
    );
  }
}
