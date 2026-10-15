import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient as panelClient } from "../generated/panel/client";
import { PrismaClient as dbLogClient } from "../generated/db-log/client";
import { PrismaClient as inventoryClient } from "../generated/inventory/client";
import { PrismaClient as projectClient } from "../generated/project/client";
import { PrismaClient as leadClient } from "../generated/lead/client";

const globalForPrisma = global as any;

export type PanelPrisma = panelClient;
export type DbLogPrisma = dbLogClient;
export type InventoryPrisma = inventoryClient;
export type ProjectPrisma = projectClient;

// Prisma 7: every client needs a driver adapter. `?schema=` in the URL is read here
// (Prisma 6 did this automatically).
const adapter = (url: string | undefined) => {
  const schema = url ? new URL(url).searchParams.get("schema") ?? undefined : undefined;
  return new PrismaPg(
    { connectionString: url, ...(schema && { options: `-c search_path=${schema}` }) },
    { schema },
  );
};

export const panel: PanelPrisma =
  globalForPrisma.panel ?? new panelClient({ adapter: adapter(process.env.DATABASE_URL), log: ["warn", "error"] });

export const dblog: DbLogPrisma =
  globalForPrisma.dblog ?? new dbLogClient({ adapter: adapter(process.env.DATABASE_LOGS), log: ["warn", "error"] });

export const inventory: InventoryPrisma =
  globalForPrisma.inventory ??
  new inventoryClient({ adapter: adapter(process.env.DATABASE_URL_INVENTORY), log: ["warn", "error"] });

export const project: ProjectPrisma =
  globalForPrisma.project ??
  new projectClient({ adapter: adapter(process.env.DATABASE_URL_PROJECT), log: ["warn", "error"] });

export const lead: leadClient =
  globalForPrisma.lead ?? new leadClient({ adapter: adapter(process.env.DATABASE_URL_LEADS), log: ["warn", "error"] });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.panel = panel;
  globalForPrisma.dblog = dblog;
  globalForPrisma.inventory = inventory;
  globalForPrisma.project = project;
  globalForPrisma.lead = lead;
}
