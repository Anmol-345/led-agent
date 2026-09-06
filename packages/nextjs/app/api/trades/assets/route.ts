import { NextRequest } from "next/server";
import { getEligibleAssets } from "@/lib/trading/registry";

export const runtime = "nodejs";
const privateNoStoreHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const chainIdParam = searchParams.get("chainId");
    const chainId = chainIdParam ? parseInt(chainIdParam, 10) : undefined;

    const assets = getEligibleAssets(chainId);
    return Response.json({ assets }, { headers: privateNoStoreHeaders });
  } catch (err: any) {
    return Response.json(
      { error: err.message || "Failed to load eligible assets" },
      { status: 503, headers: privateNoStoreHeaders }
    );
  }
}
