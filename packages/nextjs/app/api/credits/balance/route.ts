import { NextRequest, NextResponse } from "next/server";
import { isAddress, getAddress } from "viem";
import { loadCreditAccountConfig } from "@/lib/credits/config";
import { BaseVaultClient } from "@/lib/credits/vault";

export const runtime = "nodejs";
const privateNoStoreHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest): Promise<Response> {
  const url = new URL(request.url);
  const walletParam = url.searchParams.get("wallet");

  if (!walletParam || !isAddress(walletParam)) {
    return NextResponse.json(
      { error: "A valid wallet query parameter is required." },
      { status: 400, headers: privateNoStoreHeaders },
    );
  }

  const wallet = getAddress(walletParam);

  try {
    const config = loadCreditAccountConfig();
    const vaultClient = new BaseVaultClient({
      vaultAddress: config.vaultAddress,
      rpcUrl: config.baseRpcUrl,
    });
    const snapshot = await vaultClient.getAccountSnapshot(wallet);
    return NextResponse.json(
      {
        available: snapshot.available.toString(),
        reserved: snapshot.reserved.toString(),
        total: (snapshot.available + snapshot.reserved).toString(),
        blockNumber: snapshot.blockNumber.toString(),
      },
      { headers: privateNoStoreHeaders },
    );
  } catch (error) {
    // Never invent a balance. This previously returned a hardcoded 50 USDC on any error,
    // so a misconfigured vault address or a dead RPC showed the customer spendable credit
    // that does not exist — and the failure stayed invisible.
    const reason = error instanceof Error ? error.message : "Credit balance unavailable.";
    console.error("[api/credits/balance]", reason);
    return NextResponse.json(
      { error: "Credit balance is temporarily unavailable." },
      { status: 503, headers: privateNoStoreHeaders },
    );
  }
}
