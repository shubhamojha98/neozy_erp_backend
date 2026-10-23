import { CompanyStatus, DataScope, Prisma, TenantStatus, UserStatus } from "../generated/panel/client";
import {panel} from "../lib/globalprimsaclient";

export const SUPER_ADMIN = "SUPER_ADMIN";

const SCOPE_RANK: Record<DataScope, number> = { SELF: 0, TEAM: 1, COMPANY: 2, COMPANY_TREE: 3 };

export type MenuNode = { code: string; name: string; path: string | null; icon: string | null; children: MenuNode[] };

export type AccessContext = {
  userId: number;
  companyId: number | null;
  companyUserId: number | null;
  isSuperAdmin: boolean;
  dataScope: DataScope | null;
  roles: string[];
  permissions: string[];
  menus: MenuNode[];
};

/** Minimal user shape needed for access checks. */
export const accessUserInclude = {
  platform_role: { select: { code: true, is_active: true } },
  home_company: { select: { id: true, hierarchy_path: true } },
} satisfies Prisma.UserInclude;

export type AccessUser = Prisma.UserGetPayload<{ include: typeof accessUserInclude }>;

export const isSuperAdmin = (user: Pick<AccessUser, "platform_role">) =>
  user.platform_role?.code === SUPER_ADMIN && user.platform_role.is_active;

/** Company + its tenant must be active. */
function usableCompany(now = new Date()): Prisma.CompanyWhereInput {
  return {
    deleted_at: null,
    status: { in: [CompanyStatus.ACTIVE, CompanyStatus.TRIAL] },
    tenant: {
      deleted_at: null,
      status: { in: [TenantStatus.ACTIVE, TenantStatus.TRIAL] },
      OR: [{ valid_till: null }, { valid_till: { gt: now } }],
    },
  };
}

/** Rule: company user may only use his home company or its sub-companies. */
function insideHomeTree(user: AccessUser): Prisma.CompanyWhereInput {
  if (!user.home_company) return { id: -1 };
  return { tenant_id: user.tenant_id ?? -1, hierarchy_path: { startsWith: user.home_company.hierarchy_path } };
}

export type CompanyOption = { id: number; code: string; name: string; parent_company_id: number | null; is_default: boolean };

/** Companies shown in the company switcher. */
export async function listAccessibleCompanies(user: AccessUser): Promise<CompanyOption[]> {
  const select = { id: true, code: true, name: true, parent_company_id: true } as const;

  if (isSuperAdmin(user)) {
    const rows = await panel.company.findMany({ where: usableCompany(), select, orderBy: { name: "asc" } });
    return rows.map((c) => ({ ...c, is_default: false }));
  }

  const rows = await panel.companyUser.findMany({
    where: { user_id: user.id, is_active: true, company: { ...usableCompany(), ...insideHomeTree(user) } },
    select: { is_default: true, company: { select } },
    orderBy: { company: { name: "asc" } },
  });
  return rows.map((r) => ({ ...r.company, is_default: r.is_default }));
}

/** Company opened right after login. Super admin starts without a company (platform console). */
export async function resolveDefaultCompanyId(user: AccessUser): Promise<number | null> {
  if (isSuperAdmin(user)) return null;
  const companies = await listAccessibleCompanies(user);
  return (companies.find((c) => c.is_default) ?? companies[0])?.id ?? null;
}

export async function canAccessCompany(user: AccessUser, companyId: number): Promise<boolean> {
  if (isSuperAdmin(user)) {
    return (await panel.company.count({ where: { id: companyId, ...usableCompany() } })) > 0;
  }
  const count = await panel.companyUser.count({
    where: { user_id: user.id, company_id: companyId, is_active: true, company: { ...usableCompany(), ...insideHomeTree(user) } },
  });
  return count > 0;
}

/** Permissions usable inside a company: active, non-platform module, core or enabled for the company. */
export function companyPermissionWhere(companyId: number, now = new Date()): Prisma.PermissionWhereInput {
  return {
    is_active: true,
    menu: {
      is_active: true,
      module: {
        is_active: true,
        is_platform: false,
        OR: [
          { is_core: true },
          { companies: { some: { company_id: companyId, is_active: true, OR: [{ valid_till: null }, { valid_till: { gt: now } }] } } },
        ],
      },
    },
  };
}

const EMPTY = (userId: number, companyId: number | null): AccessContext => ({
  userId, companyId, companyUserId: null, isSuperAdmin: false, dataScope: null, roles: [], permissions: [], menus: [],
});

/**
 * Everything the panel needs for one user inside one company:
 * effective permissions = (role permissions + active GRANTs) − active REVOKEs, limited to enabled modules.
 */
export async function getAccessContext(userId: number, companyId: number | null): Promise<AccessContext> {
  const now = new Date();
  const user = await panel.user.findFirst({
    where: { id: userId, deleted_at: null, status: UserStatus.ACTIVE },
    include: accessUserInclude,
  });
  if (!user) return EMPTY(userId, companyId);

  if (isSuperAdmin(user)) {
    const all = await panel.permission.findMany({
      where: { is_active: true, menu: { is_active: true, module: { is_active: true } } },
      select: { code: true },
    });
    const permissions = all.map((p) => p.code);
    return {
      userId, companyId, companyUserId: null, isSuperAdmin: true, dataScope: DataScope.COMPANY_TREE,
      roles: [SUPER_ADMIN], permissions, menus: await buildMenus(new Set(permissions)),
    };
  }
  if (companyId == null) return EMPTY(userId, companyId);

  const membership = await panel.companyUser.findFirst({
    where: { user_id: userId, company_id: companyId, is_active: true, company: { ...usableCompany(now), ...insideHomeTree(user) } },
    select: {
      id: true,
      roles: {
        where: { role: { is_active: true, deleted_at: null } },
        select: { role: { select: { code: true, data_scope: true, permissions: { select: { permission: { select: { code: true } } } } } } },
      },
      permission_overrides: {
        where: { AND: [{ OR: [{ valid_from: null }, { valid_from: { lte: now } }] }, { OR: [{ valid_until: null }, { valid_until: { gt: now } }] }] },
        select: { effect: true, permission: { select: { code: true } } },
      },
    },
  });
  if (!membership) return EMPTY(userId, companyId);

  const granted = new Set<string>();
  let dataScope: DataScope | null = null;
  for (const { role } of membership.roles) {
    role.permissions.forEach((rp) => granted.add(rp.permission.code));
    if (!dataScope || SCOPE_RANK[role.data_scope] > SCOPE_RANK[dataScope]) dataScope = role.data_scope;
  }
  membership.permission_overrides.filter((o) => o.effect === "GRANT").forEach((o) => granted.add(o.permission.code));
  membership.permission_overrides.filter((o) => o.effect === "REVOKE").forEach((o) => granted.delete(o.permission.code));

  const allowed = await panel.permission.findMany({
    where: { code: { in: [...granted] }, ...companyPermissionWhere(companyId, now) },
    select: { code: true },
  });
  const permissions = allowed.map((p) => p.code);

  return {
    userId, companyId, companyUserId: membership.id, isSuperAdmin: false, dataScope,
    roles: membership.roles.map((r) => r.role.code), permissions, menus: await buildMenus(new Set(permissions)),
  };
}

export const can = (ctx: Pick<AccessContext, "isSuperAdmin" | "permissions">, code: string) =>
  ctx.isSuperAdmin || ctx.permissions.includes(code);

// ============================================================
// SESSION REVOKE — token_version badhte hi purane saare token turant band
// User ka role / permission / company access badle to ye call karo.
// (User deactivate / delete / company se hatana authMiddleware khud pakad leta hai)
// ============================================================
export const revokeUserSessions = (userIds: number[]) =>
  panel.user.updateMany({ where: { id: { in: userIds } }, data: { token_version: { increment: 1 } } });

/** Password reset / deactivate → token ke saath refresh token bhi band (har device se logout) */
export const logoutUserEverywhere = (userIds: number[]) =>
  panel.$transaction([
    panel.user.updateMany({ where: { id: { in: userIds } }, data: { token_version: { increment: 1 } } }),
    panel.userSession.updateMany({
      where: { user_id: { in: userIds }, revoked_at: null },
      data: { revoked_at: new Date(), revoke_reason: "ADMIN_ACTION" },
    }),
  ]);

/** Role ki permissions badli → us role wale saare users ka session band */
export const revokeRoleSessions = async (roleId: number) => {
  const members = await panel.companyUserRole.findMany({ where: { role_id: roleId }, select: { company_user: { select: { user_id: true } } } });
  return revokeUserSessions(members.map((m) => m.company_user.user_id));
};

/** Company ids a business query may read (COMPANY_TREE = company + all sub-companies). */
/** Data scope ke liye itna hi chahiye (AccessContext ya JWT user dono se ban jata hai) */
export type ScopeContext = Pick<AccessContext, "companyId" | "isSuperAdmin" | "companyUserId" | "dataScope">;

export async function scopedCompanyIds(ctx: ScopeContext): Promise<number[]> {
  if (ctx.companyId == null || (!ctx.isSuperAdmin && !ctx.companyUserId)) return [];
  if (ctx.dataScope !== DataScope.COMPANY_TREE) return [ctx.companyId];
  const self = await panel.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { hierarchy_path: true } });
  const tree = await panel.company.findMany({
    where: { hierarchy_path: { startsWith: self.hierarchy_path }, deleted_at: null },
    select: { id: true },
  });
  return tree.map((c) => c.id);
}

/** CompanyUser ids visible for SELF / TEAM scopes. null = no user filter. */
export async function scopedCompanyUserIds(ctx: ScopeContext): Promise<number[] | null> {
  if (ctx.isSuperAdmin || !ctx.companyUserId) return null;
  if (ctx.dataScope === DataScope.SELF) return [ctx.companyUserId];
  if (ctx.dataScope !== DataScope.TEAM) return null;
  const ids = [ctx.companyUserId];
  for (let frontier = [ctx.companyUserId]; frontier.length; ) {
    const next = await panel.companyUser.findMany({
      where: { reports_to_id: { in: frontier }, company_id: ctx.companyId!, is_active: true },
      select: { id: true },
    });
    frontier = next.map((n) => n.id).filter((id) => !ids.includes(id));
    ids.push(...frontier);
  }
  return ids;
}

async function buildMenus(permissions: Set<string>): Promise<MenuNode[]> {
  const modules = await panel.module.findMany({
    where: { is_active: true },
    orderBy: { display_order: "asc" },
    select: {
      code: true, name: true, icon: true,
      menus: {
        where: { is_active: true },
        orderBy: { display_order: "asc" },
        select: { id: true, parent_id: true, code: true, name: true, path: true, icon: true },
      },
    },
  });

  const result: MenuNode[] = [];
  for (const mod of modules) {
    const byParent = new Map<number | null, typeof mod.menus>();
    mod.menus.forEach((m) => byParent.set(m.parent_id, [...(byParent.get(m.parent_id) ?? []), m]));
    const build = (parentId: number | null): MenuNode[] =>
      (byParent.get(parentId) ?? []).flatMap((m) => {
        const children = build(m.id);
        if (!permissions.has(`${m.code}.view`) && !children.length) return [];
        return [{ code: m.code, name: m.name, path: m.path, icon: m.icon, children }];
      });
    const children = build(null);
    if (children.length) result.push({ code: mod.code, name: mod.name, path: null, icon: mod.icon, children });
  }
  return result;
}
