import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// inventory database — use with: npx prisma <command> --config prisma/inventory/prisma.config.ts
export default defineConfig({
  schema: "schema.prisma",
  migrations: {
    path: "migrations",
  },
  datasource: {
    url: env("DATABASE_URL_INVENTORY"),
  },
});
