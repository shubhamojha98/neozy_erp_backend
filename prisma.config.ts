import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Panel (main) database — used by default: npx prisma migrate dev / generate / db seed
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
