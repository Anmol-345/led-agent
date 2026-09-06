import { defineConfig } from "prisma/config";

import { creditDatabaseUrl } from "./lib/credits/config";

const databasePath = process.env.CREDIT_DATABASE_PATH;

if (!databasePath && process.env.PRISMA_CREDIT_GENERATE !== "true") {
  throw new Error("CREDIT_DATABASE_PATH is required to run Prisma credit commands.");
}

export default defineConfig({
  datasource: {
    url: databasePath
      ? creditDatabaseUrl(databasePath)
      : "file:/tmp/leg-credit-prisma-generation.sqlite",
  },
  migrations: { path: "prisma/migrations" },
  schema: "prisma/schema.prisma",
});
