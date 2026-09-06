import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
const projectRoot = fileURLToPath(new URL("../../..", import.meta.url));
loadEnvConfig(projectRoot);

import { loadCreditMigrationConfig } from "../lib/credits/config";
import { migrateCreditDatabase } from "../lib/credits/db";

await migrateCreditDatabase(loadCreditMigrationConfig());

console.log("Credit database migrations applied.");
