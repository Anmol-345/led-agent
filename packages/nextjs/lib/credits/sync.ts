import { createHash, timingSafeEqual } from "node:crypto";

import type { CreditSchedulerConfig } from "./config";
import type { VaultIndexerSyncSummary } from "./indexer";

type SyncIndexer = {
  sync(): Promise<VaultIndexerSyncSummary>;
};

type SyncRouteDependencies<Database> = {
  config: CreditSchedulerConfig;
  createIndexer(database: Database): SyncIndexer;
  getPrismaClient(): Database;
};

function schedulerToken(authHeader: string | null | undefined): string {
  return authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
}

function validSchedulerToken(
  authHeader: string | null | undefined,
  schedulerSecret: string,
): boolean {
  const providedHash = createHash("sha256")
    .update(schedulerToken(authHeader))
    .digest();
  const expectedHash = createHash("sha256").update(schedulerSecret).digest();
  return timingSafeEqual(providedHash, expectedHash);
}

function jsonSummary(summary: VaultIndexerSyncSummary) {
  return {
    confirmedHeadBlockNumber: summary.confirmedHeadBlockNumber.toString(),
    cursorBlockNumber: summary.cursorBlockNumber.toString(),
    headBlockNumber: summary.headBlockNumber.toString(),
    observedLogs: summary.observedLogs,
    projectedEvents: summary.projectedEvents,
    reversedEvents: summary.reversedEvents,
    scannedFromBlock: summary.scannedFromBlock?.toString() ?? null,
    scannedToBlock: summary.scannedToBlock?.toString() ?? null,
    status: "synced",
  };
}

export async function handleSyncRoute<Database>(
  input: { authHeader?: string | null },
  dependencies: SyncRouteDependencies<Database>,
): Promise<Response> {
  if (!validSchedulerToken(input.authHeader, dependencies.config.schedulerSecret)) {
    return Response.json(
      { error: "Unauthorized: invalid scheduler secret." },
      { status: 401 },
    );
  }

  try {
    const database = dependencies.getPrismaClient();
    const summary = await dependencies.createIndexer(database).sync();
    return Response.json(jsonSummary(summary));
  } catch {
    return Response.json(
      { error: "Credit indexer sync failed." },
      { status: 503 },
    );
  }
}
