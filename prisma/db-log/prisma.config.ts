import "dotenv/config";
import { defineConfig } from "prisma/config";

// db-log database — use with: npx prisma <command> --config prisma/db-log/prisma.config.ts
export default defineConfig({
  schema: "schema.prisma",
  migrations: {
    path: "migrations",
  },
  datasource: {
    // DATABASE_LOGS is optional (not set in every .env), so generate still works without it
    url: process.env.DATABASE_LOGS ?? "",
  },
});
