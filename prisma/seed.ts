import bcrypt from "bcrypt";
import {
  DataScope,
  PermissionAction as A,
  PlatformType,
  Prisma,
  PrismaClient,
  RoleScope,
  UserStatus,
} from "../generated/panel/client";
import { panel as prisma } from "../lib/globalprimsaclient";

/**
 * Seed: run with `npx prisma db seed` (seed command is in prisma.config.ts)
 * Initial setup only: modules, menus, permissions, role master templates and the super admin.
 * Everything else (tenants, companies, users, roles) is created from the panel.
 * Safe to re-run. Env: SUPER_ADMIN_USERNAME, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD (required in production)
 */

// ============================================================
// CATALOG — modules, menus, actions, role master templates
// ============================================================
const CRUD = [A.VIEW, A.CREATE, A.EDIT, A.DELETE];

type MenuDef = {
  code: string;
  name: string;
  path: string;
  icon?: string;
  actions: A[];
  platform?: PlatformType;
};
type ModuleDef = {
  code: string;
  name: string;
  icon: string;
  is_platform?: boolean;
  is_core?: boolean;
  menus: MenuDef[];
};

const MODULES: ModuleDef[] = [
  {
    code: "PLATFORM",
    name: "Platform Console",
    icon: "shield",
    is_platform: true,
    menus: [
      {
        code: "platform.dashboard",
        name: "Admin Dashboard",
        path: "/dashboard/admin-dashboard",
        actions: [A.VIEW],
      },
      {
        code: "platform.companies",
        name: "Companies",
        path: "/dashboard/platform/companies",
        actions: [...CRUD, A.EXPORT],
      },
      {
        code: "platform.role_masters",
        name: "Role Master",
        path: "/dashboard/platform/role-masters",
        actions: CRUD,
      },
      {
        code: "platform.modules",
        name: "Modules & Menus",
        path: "/dashboard/platform/modules",
        actions: [A.VIEW, A.EDIT],
      },
      {
        code: "platform.users",
        name: "All Users",
        path: "/dashboard/platform/users",
        actions: [A.VIEW, A.EDIT, A.EXPORT],
      },
    ],
  },
  {
    code: "DASHBOARD",
    name: "Dashboard",
    icon: "layout-dashboard",
    is_core: true,
    menus: [
      {
        code: "dashboard.overview",
        name: "Overview",
        path: "/dashboard/overview",
        actions: [A.VIEW],
      },
    ],
  },
  {
    code: "LEADS",
    name: "Leads",
    icon: "target",
    menus: [
      {
        code: "leads.leads",
        name: "Leads",
        path: "/dashboard/leads",
        actions: [...CRUD, A.ASSIGN, A.IMPORT, A.EXPORT],
      },
      {
        code: "leads.followups",
        name: "Follow-ups",
        path: "/dashboard/leads/follow-ups",
        actions: CRUD,
      },
      {
        code: "leads.site_surveys",
        name: "Site Surveys",
        path: "/dashboard/leads/site-surveys",
        actions: [...CRUD, A.APPROVE, A.ASSIGN],
      },
    ],
  },
  {
    code: "SALES",
    name: "Sales",
    icon: "indian-rupee",
    menus: [
      {
        code: "sales.customers",
        name: "Customers",
        path: "/dashboard/sales/customers",
        actions: [...CRUD, A.EXPORT, A.IMPORT],
      },
      {
        code: "sales.quotations",
        name: "Quotations",
        path: "/dashboard/sales/quotations",
        actions: [...CRUD, A.APPROVE, A.PRINT, A.EXPORT],
      },
      {
        code: "sales.orders",
        name: "Sales Orders",
        path: "/dashboard/sales/orders",
        actions: [...CRUD, A.APPROVE, A.PRINT, A.EXPORT],
      },
      {
        code: "sales.invoices",
        name: "Invoices",
        path: "/dashboard/sales/invoices",
        actions: [...CRUD, A.APPROVE, A.PRINT, A.EXPORT],
      },
      {
        code: "sales.payments",
        name: "Payments",
        path: "/dashboard/sales/payments",
        actions: [...CRUD, A.APPROVE, A.EXPORT],
      },
    ],
  },
  {
    code: "INVENTORY",
    name: "Inventory",
    icon: "package",
    menus: [
      {
        code: "inventory.products",
        name: "Products",
        path: "/dashboard/inventory/products",
        actions: [...CRUD, A.IMPORT, A.EXPORT],
      },
      {
        code: "inventory.warehouses",
        name: "Warehouses",
        path: "/dashboard/inventory/warehouses",
        actions: CRUD,
      },
      {
        code: "inventory.stock",
        name: "Stock",
        path: "/dashboard/inventory/stock",
        actions: [A.VIEW, A.EDIT, A.EXPORT],
      },
      {
        code: "inventory.vendors",
        name: "Vendors",
        path: "/dashboard/inventory/vendors",
        actions: [...CRUD, A.EXPORT],
      },
      {
        code: "inventory.purchase_orders",
        name: "Purchase Orders",
        path: "/dashboard/inventory/purchase-orders",
        actions: [...CRUD, A.APPROVE, A.PRINT, A.EXPORT],
      },
      {
        code: "inventory.transfers",
        name: "Stock Transfers",
        path: "/dashboard/inventory/transfers",
        actions: [...CRUD, A.APPROVE],
      },
    ],
  },
  {
    code: "PROJECTS",
    name: "Projects",
    icon: "sun",
    menus: [
      {
        code: "projects.projects",
        name: "Projects",
        path: "/dashboard/projects",
        actions: [...CRUD, A.ASSIGN, A.EXPORT],
      },
      {
        code: "projects.installations",
        name: "Installations",
        path: "/dashboard/projects/installations",
        actions: [...CRUD, A.ASSIGN],
      },
      {
        code: "projects.subsidy",
        name: "Subsidy & Net Metering",
        path: "/dashboard/projects/subsidy",
        actions: [...CRUD, A.APPROVE],
      },
      {
        code: "projects.commissioning",
        name: "Commissioning",
        path: "/dashboard/projects/commissioning",
        actions: [A.VIEW, A.CREATE, A.EDIT, A.APPROVE, A.PRINT],
      },
      {
        code: "projects.service",
        name: "Service & AMC",
        path: "/dashboard/projects/service",
        actions: [...CRUD, A.ASSIGN],
      },
    ],
  },
  {
    code: "REPORTS",
    name: "Reports",
    icon: "bar-chart-3",
    menus: [
      {
        code: "reports.sales",
        name: "Sales Reports",
        path: "/dashboard/reports/sales",
        actions: [A.VIEW, A.EXPORT, A.PRINT],
      },
      {
        code: "reports.inventory",
        name: "Inventory Reports",
        path: "/dashboard/reports/inventory",
        actions: [A.VIEW, A.EXPORT, A.PRINT],
      },
      {
        code: "reports.projects",
        name: "Project Reports",
        path: "/dashboard/reports/projects",
        actions: [A.VIEW, A.EXPORT, A.PRINT],
      },
    ],
  },
  {
    code: "ADMIN",
    name: "Administration",
    icon: "settings",
    is_core: true,
    menus: [
      {
        code: "admin.company",
        name: "Company Profile",
        path: "/dashboard/admin/company",
        actions: [A.VIEW, A.EDIT],
      },
      {
        code: "admin.sub_companies",
        name: "Sub Companies",
        path: "/dashboard/admin/sub-companies",
        actions: [A.VIEW, A.CREATE, A.EDIT],
      },
      {
        code: "admin.users",
        name: "Users",
        path: "/dashboard/admin/users",
        actions: [...CRUD, A.EXPORT],
      },
      {
        code: "admin.roles",
        name: "Roles & Permissions",
        path: "/dashboard/admin/roles",
        actions: CRUD,
      },
      {
        code: "admin.audit_logs",
        name: "Audit Logs",
        path: "/dashboard/admin/audit-logs",
        actions: [A.VIEW, A.EXPORT],
      },
    ],
  },
];

/**
 * Permission patterns:
 *   "*"                      all company (non-platform) permissions
 *   "SALES"                  every permission of a module (uppercase = module code)
 *   "sales.quotations"       every action of a menu
 *   "sales.quotations:VIEW,CREATE"
 *   "SALES:VIEW"             one action across a module
 */
type RoleMasterDef = {
  code: string;
  name: string;
  description: string;
  scope: RoleScope;
  data_scope: DataScope;
  is_system?: boolean;
  permissions: string[];
};

const ROLE_MASTERS: RoleMasterDef[] = [
  {
    code: "SUPER_ADMIN",
    name: "Super Admin",
    scope: RoleScope.PLATFORM,
    data_scope: DataScope.COMPANY_TREE,
    is_system: true,
    description: "Developer-managed platform owner. Bypasses company RBAC.",
    permissions: [],
  },
  {
    code: "COMPANY_ADMIN",
    name: "Company Admin",
    scope: RoleScope.COMPANY,
    data_scope: DataScope.COMPANY_TREE,
    is_system: true,
    description: "Full access inside the company and its sub-companies.",
    permissions: ["*"],
  },
  {
    code: "SALES_MANAGER",
    name: "Sales Manager",
    scope: RoleScope.COMPANY,
    data_scope: DataScope.TEAM,
    description: "Owns leads and sales pipeline for the team.",
    permissions: [
      "dashboard.overview",
      "LEADS",
      "SALES",
      "reports.sales",
      "inventory.products:VIEW",
      "inventory.stock:VIEW",
      "projects.projects:VIEW",
    ],
  },
  {
    code: "SALES_EXECUTIVE",
    name: "Sales Executive",
    scope: RoleScope.COMPANY,
    data_scope: DataScope.SELF,
    description: "Works own leads, surveys and quotations.",
    permissions: [
      "dashboard.overview",
      "leads.leads:VIEW,CREATE,EDIT",
      "leads.followups:VIEW,CREATE,EDIT",
      "leads.site_surveys:VIEW,CREATE,EDIT",
      "sales.customers:VIEW,CREATE,EDIT",
      "sales.quotations:VIEW,CREATE,EDIT,PRINT",
      "inventory.products:VIEW",
    ],
  },
  {
    code: "INVENTORY_MANAGER",
    name: "Inventory Manager",
    scope: RoleScope.COMPANY,
    data_scope: DataScope.COMPANY,
    description: "Products, stock, vendors and purchase.",
    permissions: [
      "dashboard.overview",
      "INVENTORY",
      "reports.inventory",
      "sales.orders:VIEW",
      "projects.projects:VIEW",
    ],
  },
  {
    code: "PROJECT_MANAGER",
    name: "Project Manager",
    scope: RoleScope.COMPANY,
    data_scope: DataScope.COMPANY,
    description: "Installation, subsidy, commissioning and service.",
    permissions: [
      "dashboard.overview",
      "PROJECTS",
      "reports.projects",
      "sales.customers:VIEW",
      "sales.orders:VIEW",
      "inventory.stock:VIEW",
      "inventory.transfers:VIEW,CREATE",
    ],
  },
  {
    code: "ACCOUNTANT",
    name: "Accountant",
    scope: RoleScope.COMPANY,
    data_scope: DataScope.COMPANY,
    description: "Invoices, payments and financial reports.",
    permissions: [
      "dashboard.overview",
      "sales.invoices",
      "sales.payments",
      "sales.orders:VIEW,PRINT,EXPORT",
      "sales.customers:VIEW",
      "inventory.purchase_orders:VIEW,APPROVE,PRINT",
      "inventory.vendors:VIEW",
      "reports.sales",
      "reports.inventory",
    ],
  },
  {
    code: "VIEWER",
    name: "Viewer",
    scope: RoleScope.COMPANY,
    data_scope: DataScope.COMPANY,
    description: "Read-only access to business modules.",
    permissions: [
      "DASHBOARD",
      "LEADS:VIEW",
      "SALES:VIEW",
      "INVENTORY:VIEW",
      "PROJECTS:VIEW",
      "REPORTS:VIEW",
    ],
  },
];

// ============================================================
// HELPERS
// ============================================================
type Db = PrismaClient | Prisma.TransactionClient;
type PermRow = {
  id: number;
  code: string;
  action: string;
  menu_code: string;
  module_code: string;
  is_platform: boolean;
};

async function loadPermissionCatalog(db: Db): Promise<PermRow[]> {
  const rows = await db.permission.findMany({
    where: {
      is_active: true,
      menu: { is_active: true, module: { is_active: true } },
    },
    select: {
      id: true,
      code: true,
      action: true,
      menu: {
        select: {
          code: true,
          module: { select: { code: true, is_platform: true } },
        },
      },
    },
  });
  return rows.map((p) => ({
    id: p.id,
    code: p.code,
    action: p.action,
    menu_code: p.menu.code,
    module_code: p.menu.module.code,
    is_platform: p.menu.module.is_platform,
  }));
}

/** Expands patterns ("*", "SALES", "SALES:VIEW", "sales.quotations", "sales.quotations:VIEW,EDIT") to permission ids. */
function expandPatterns(
  patterns: string[],
  catalog: PermRow[],
  scope: RoleScope = RoleScope.COMPANY,
): number[] {
  const pool =
    scope === RoleScope.COMPANY
      ? catalog.filter((p) => !p.is_platform)
      : catalog;
  const ids = new Set<number>();
  for (const pattern of patterns) {
    const [target, actionList] = pattern.split(":");
    const actions = actionList
      ? new Set(actionList.split(",").map((a) => a.trim()))
      : null;
    const isModule = target === target.toUpperCase();
    const matched = pool.filter(
      (p) =>
        (target === "*" ||
          (isModule ? p.module_code === target : p.menu_code === target)) &&
        (!actions || actions.has(p.action)),
    );
    if (!matched.length)
      throw new Error(`Permission pattern "${pattern}" matched nothing`);
    matched.forEach((p) => ids.add(p.id));
  }
  return [...ids];
}

// ============================================================
// SEED
// ============================================================
const isProd = process.env.NODE_ENV === "production";
const BCRYPT_ROUNDS = 12;

const hash = (pw: string) => bcrypt.hash(pw, BCRYPT_ROUNDS);
const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

function requireStrongPassword(name: string, fallback: string) {
  const value = process.env[name] ?? (isProd ? undefined : fallback);
  if (!value) throw new Error(`${name} is required in production`);
  const strong =
    value.length >= 12 &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /\d/.test(value) &&
    /[^A-Za-z0-9]/.test(value);
  if (isProd && !strong)
    throw new Error(
      `${name} must be 12+ chars with upper, lower, digit and symbol`,
    );
  return value;
}

async function seedCatalog() {
  for (const [mi, mod] of MODULES.entries()) {
    const module = await prisma.module.upsert({
      where: { code: mod.code },
      update: {
        name: mod.name,
        icon: mod.icon,
        is_platform: !!mod.is_platform,
        is_core: !!mod.is_core,
        display_order: mi + 1,
      },
      create: {
        code: mod.code,
        name: mod.name,
        icon: mod.icon,
        is_platform: !!mod.is_platform,
        is_core: !!mod.is_core,
        display_order: mi + 1,
      },
    });
    for (const [i, m] of mod.menus.entries()) {
      const menu = await prisma.menu.upsert({
        where: { code: m.code },
        update: {
          module_id: module.id,
          name: m.name,
          path: m.path,
          icon: m.icon,
          display_order: i + 1,
        },
        create: {
          module_id: module.id,
          code: m.code,
          name: m.name,
          path: m.path,
          icon: m.icon,
          display_order: i + 1,
          platform: m.platform,
        },
      });
      for (const action of m.actions) {
        const code = `${m.code}.${action.toLowerCase()}`;
        await prisma.permission.upsert({
          where: { code },
          update: { name: `${titleCase(action)} ${m.name}` },
          create: {
            code,
            menu_id: menu.id,
            action,
            name: `${titleCase(action)} ${m.name}`,
          },
        });
      }
    }
  }
}

async function seedRoleMasters() {
  const catalog = await loadPermissionCatalog(prisma);
  for (const [i, rm] of ROLE_MASTERS.entries()) {
    const data = {
      name: rm.name,
      description: rm.description,
      scope: rm.scope,
      default_data_scope: rm.data_scope,
      is_system: !!rm.is_system,
      display_order: i + 1,
    };
    const master = await prisma.roleMaster.upsert({
      where: { code: rm.code },
      update: data,
      create: { code: rm.code, ...data },
    });
    const ids = expandPatterns(rm.permissions, catalog, rm.scope);
    await prisma.$transaction([
      prisma.roleMasterPermission.deleteMany({
        where: { role_master_id: master.id },
      }),
      prisma.roleMasterPermission.createMany({
        data: ids.map((permission_id) => ({
          role_master_id: master.id,
          permission_id,
        })),
      }),
    ]);
  }
}

async function seedSuperAdmin() {
  const username = (
    process.env.SUPER_ADMIN_USERNAME ?? "superadmin"
  ).toLowerCase();
  const email = (
    process.env.SUPER_ADMIN_EMAIL ?? "superadmin@panel.local"
  ).toLowerCase();
  const password = requireStrongPassword(
    "SUPER_ADMIN_PASSWORD",
    "SuperAdmin@12345",
  );
  const role = await prisma.roleMaster.findUniqueOrThrow({
    where: { code: "SUPER_ADMIN" },
  });
  return prisma.user.upsert({
    where: { username },
    update: { platform_role_id: role.id }, // never overwrite password on re-seed
    create: {
      username,
      email,
      password_hash: await hash(password),
      first_name: "Super",
      last_name: "Admin",
      platform_role_id: role.id,
      status: UserStatus.ACTIVE,
      must_change_password: isProd,
      password_changed_at: new Date(),
    },
  });
}

async function main() {
  await seedCatalog();
  await seedRoleMasters();
  await seedSuperAdmin();
  console.log("Seed complete");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
