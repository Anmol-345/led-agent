import { loadCreditSchedulerConfig } from "@/lib/credits/config";
import { getCreditPrismaClient } from "@/lib/credits/db";
import { VaultIndexer } from "@/lib/credits/indexer";
import { handleSyncRoute } from "@/lib/credits/sync";
import { BaseVaultClient } from "@/lib/credits/vault";

export async function POST(request: Request) {
  try {
    const config = loadCreditSchedulerConfig();
    return handleSyncRoute(
      { authHeader: request.headers.get("authorization") },
      {
        config,
        createIndexer: prisma =>
          new VaultIndexer({
            config,
            prisma,
            vaultClient: new BaseVaultClient({
              rpcUrl: config.baseRpcUrl,
              vaultAddress: config.vaultAddress,
            }),
          }),
        getPrismaClient: () => getCreditPrismaClient(config),
      },
    );
  } catch {
    return Response.json(
      { error: "Credit indexer runtime is unavailable." },
      { status: 503 },
    );
  }
}
