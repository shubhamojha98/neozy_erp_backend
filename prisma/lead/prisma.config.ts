import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// lead database — use with: npx prisma <command> --config prisma/lead/prisma.config.ts
export default defineConfig({
  schema: "schema.prisma",
  migrations: {
    path: "migrations",
  },
  datasource: {
    url: env("DATABASE_URL_LEADS"),
  },
});
