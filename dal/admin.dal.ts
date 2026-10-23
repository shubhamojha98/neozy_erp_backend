import { AuditAction, Prisma, UserStatus } from "../generated/panel/client";
import { panel } from "../lib/globalprimsaclient";
import type { AuthenticatedRequest, TokenPayload } from "../middleware/authMiddleware";
import { companyPermissionWhere } from "./access.dal";

// Administration (Roles & Users) ke helpers — sab active company ke andar

export const COMPANY_ADMIN = "COMPANY_ADMIN";

// ============================================================
// PERMISSIONS
// ============================================================

// Role screen ke liye: module → menu → actions (sirf is company me chalne wali)
export async function permissionCatalog(companyId: number) {
  const rows = await panel.permission.findMany({
    where: companyPermissionWhere(companyId),
    orderBy: [{ menu: { module: { display_order: "asc" } } }, { menu: { display_order: "asc" } }, { id: "asc" }],
    select: {
      id: true, code: true, name: true, action: true,
      menu: { select: { code: true, name: true, module: { select: { code: true, name: true } } } },
    },
  });

  type MenuGroup = { code: string; name: string; permissions: { id: number; code: string; name: string; action: string }[] };
  const modules = new Map<string, { code: string; name: string; menus: Map<string, MenuGroup> }>();
  for (const p of rows) {
    const mod = modules.get(p.menu.module.code) ?? { ...p.menu.module, menus: new Map<string, MenuGroup>() };
    modules.set(mod.code, mod);
    const menu = mod.menus.get(p.menu.code) ?? { code: p.menu.code, name: p.menu.name, permissions: [] };
    mod.menus.set(menu.code, menu);
    menu.permissions.push({ id: p.id, code: p.code, name: p.name, action: p.action });
  }
  return [...modules.values()].map((m) => ({ code: m.code, name: m.name, menus: [...m.menus.values()] }));
}

// Ye permission ids di ja sakti hain? Galat ho to error message, sahi ho to null
// mustOwn = true → admin sirf wahi de sakta hai jo uske paas khud hai (super admin ko chhod kar)
export async function checkPermissionIds(user: TokenPayload, companyId: number, ids: number[], mustOwn: boolean) {
  const unique = [...new Set(ids)];
  if (!unique.length) return null;

  const rows = await panel.permission.findMany({
    where: { id: { in: unique }, ...companyPermissionWhere(companyId) },
    select: { code: true },
  });
  if (rows.length !== unique.length) return "Some permissions are not available for this company";

  if (mustOwn && !user.isSuperAdmin) {
    const notOwned = rows.find((p) => !user.permissions.includes(p.code));
    if (notOwned) return `You cannot give "${notOwned.code}" because you do not have it yourself`;
  }
  return null;
}

// ============================================================
// ROLES
// ============================================================

// "Site Supervisor" → "SITE_SUPERVISOR"
export const roleCodeFromName = (name: string) =>
  name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50) || "ROLE";

export const findRole = (companyId: number, id: number) =>
  panel.role.findFirst({
    where: { id, company_id: companyId, deleted_at: null },
    include: { permissions: { select: { permission_id: true } }, _count: { select: { members: true } } },
  });

// Assign hone wale roles isi company ke aur active hain? Galat ho to error message
export async function checkRoleIds(companyId: number, ids: number[]) {
  const unique = [...new Set(ids)];
  const count = await panel.role.count({ where: { id: { in: unique }, company_id: companyId, is_active: true, deleted_at: null } });
  return count === unique.length ? null : "Some roles are not available in this company";
}

// Admin ye roles de sakta hai / in roles wale user ko manage kar sakta hai?
// Role ki har permission admin ke paas khud honi chahiye — warna koi bhi khud se bada admin bana deta
export async function checkRoleAccess(user: TokenPayload, roleIds: number[], message: string) {
  if (user.isSuperAdmin || !roleIds.length) return null;
  const rows = await panel.rolePermission.findMany({
    where: { role_id: { in: [...new Set(roleIds)] } },
    select: { permission: { select: { code: true } } },
  });
  return rows.every((r) => user.permissions.includes(r.permission.code)) ? null : message;
}

export const CANNOT_ASSIGN_ROLE = "You cannot assign a role that has more access than you";
export const CANNOT_MANAGE_USER = "You cannot manage a user who has more access than you";

// ============================================================
// USERS (CompanyUser = user ki is company me membership)
// ============================================================

export const findMember = (companyId: number, id: number) =>
  panel.companyUser.findFirst({
    where: { id, company_id: companyId, user: { deleted_at: null } },
    include: {
      user: true,
      roles: { select: { role_id: true, role: { select: { code: true } } } },
    },
  });

export const hasAdminRole = (roles: { role: { code: string } }[]) => roles.some((r) => r.role.code === COMPANY_ADMIN);

// Company me COMPANY_ADMIN wale active members (except ek) — last admin hatne na paye
export const otherActiveAdmins = (companyId: number, exceptMemberId: number) =>
  panel.companyUserRole.count({
    where: {
      company_id: companyId,
      role: { code: COMPANY_ADMIN, is_active: true, deleted_at: null },
      company_user: { id: { not: exceptMemberId }, is_active: true, user: { status: UserStatus.ACTIVE, deleted_at: null } },
    },
  });

// Manager isi company ka active member hai?
export async function isActiveMember(companyId: number, memberId: number) {
  return (await panel.companyUser.count({ where: { id: memberId, company_id: companyId, is_active: true } })) > 0;
}

// Login username — diya nahi to email / phone se, already liya ho to number laga do (rahul, rahul1, rahul2 ...)
export async function uniqueUsername(base: string) {
  const clean = base.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 25) || "user";
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? clean : `${clean}${i}`;
    if (!(await panel.user.findUnique({ where: { username: candidate }, select: { id: true } }))) return candidate;
  }
  return `${clean}${Date.now().toString(36)}`;
}

// ============================================================
// AUDIT LOG — fail ho to bhi asli kaam na ruke
// ============================================================
export function audit(
  req: AuthenticatedRequest,
  data: {
    action: AuditAction;
    entityType: "role" | "user";
    entityId: number;
    description: string;
    oldValues?: Prisma.InputJsonValue;
    newValues?: Prisma.InputJsonValue;
  },
) {
  return panel.auditLog
    .create({
      data: {
        action: data.action,
        module_code: "ADMIN",
        entity_type: data.entityType,
        entity_id: String(data.entityId),
        description: data.description,
        old_values: data.oldValues,
        new_values: data.newValues,
        user_id: req.user!.userId,
        company_id: req.user!.company?.id ?? null,
        ip_address: (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() || req.socket.remoteAddress || null,
        user_agent: req.headers["user-agent"] || null,
      },
    })
    .catch((err) => console.error("[Audit]", err));
}
