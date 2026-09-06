import { NextRequest } from "next/server";

import {
  CREDIT_SESSION_COOKIE,
  handleAccountRoute,
} from "@/lib/credits/api";
import { loadCreditAccountConfig } from "@/lib/credits/config";
import { getCreditPrismaClient } from "@/lib/credits/db";
import { VaultIndexer } from "@/lib/credits/indexer";
import { CreditLedgerService } from "@/lib/credits/ledger";
import { BaseVaultClient } from "@/lib/credits/vault";

export const runtime = "nodejs";

const privateNoStoreHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const config = loadCreditAccountConfig();
    const prisma = getCreditPrismaClient(config);
    const vaultClient = new BaseVaultClient({
      vaultAddress: config.vaultAddress,
      rpcUrl: config.baseRpcUrl,
    });
    const authorizationSnapshotProvider = new VaultIndexer({
      config,
      prisma,
      vaultClient,
    });
    const ledger = new CreditLedgerService({
      prisma,
      config,
      vaultClient,
      authorizationSnapshotProvider,
    });
    return handleAccountRoute(
      { sessionToken: request.cookies.get(CREDIT_SESSION_COOKIE)?.value },
      {
        prisma,
        vaultChainId: config.baseChainId,
        usdcAddress: config.usdcAddress,
        appOrigin: config.appOrigin,
        baseRpcUrl: config.baseRpcUrl,
        getAccount(wallet) {
          return ledger.getAccount(wallet);
        },
      },
    );
  } catch {
    return Response.json(
      { error: "Credit account is temporarily unavailable." },
      { status: 503, headers: privateNoStoreHeaders },
    );
  }
}
