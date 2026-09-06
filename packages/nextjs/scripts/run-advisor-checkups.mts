import { CheckupService } from "../lib/advisor/checkup.js";
import { loadAdvisorResearchConfig } from "../lib/advisor/config.js";
import { getAdvisorPrismaClient } from "../lib/advisor/db.js";

async function main() {
  console.log("[run-advisor-checkups] Starting protected checkup scanner...");

  try {
    const config = loadAdvisorResearchConfig(process.env);
    const db = getAdvisorPrismaClient(config);
    const service = new CheckupService({ database: db });

    const now = new Date();
    const result = await service.syncPendingCheckups({ now });

    console.log(`[run-advisor-checkups] Successfully synced ${result.syncedCount} pending checkups at ${now.toISOString()}.`);
    process.exit(0);
  } catch (error) {
    console.error("[run-advisor-checkups] Error scanning checkups:", error);
    process.exit(1);
  }
}

main();
