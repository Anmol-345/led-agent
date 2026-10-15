import { defineConfig } from "prisma/config";

import { creditDatabaseUrl } from "./lib/credits/config";

const databasePath = process.env.CREDIT_DATABASE_PATH;


export default defineConfig({
  datasource: {
    url: databasePath
      ? creditDatabaseUrl(databasePath)
      : "file:/tmp/leg-credit-prisma-generation.sqlite",
  },
  migrations: { path: "prisma/migrations" },
  schema: "prisma/schema.prisma",
});
