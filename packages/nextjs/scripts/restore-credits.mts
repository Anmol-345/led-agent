import { loadCreditDatabaseConfig } from "../lib/credits/config";
import { restoreCreditDatabase } from "../lib/credits/db";

function requiredBackupPath(): string {
  const backupPath = process.argv[2];
  if (!backupPath) {
    throw new Error("Usage: restore-credits.mts <absolute-backup-path>");
  }
  return backupPath;
}

await restoreCreditDatabase(requiredBackupPath(), loadCreditDatabaseConfig());

console.log("Credit database restore completed.");
