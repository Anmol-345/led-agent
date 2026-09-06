import { loadCreditDatabaseConfig } from "../lib/credits/config";
import { backupCreditDatabase } from "../lib/credits/db";

function requiredBackupPath(): string {
  const backupPath = process.argv[2];
  if (!backupPath) {
    throw new Error("Usage: backup-credits.mts <absolute-backup-path>");
  }
  return backupPath;
}

await backupCreditDatabase(loadCreditDatabaseConfig(), requiredBackupPath());

console.log("Credit database backup completed.");
