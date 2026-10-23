import { Response } from "express";
import { AuditAction, DataScope, Prisma, RoleScope } from "../../generated/panel/client";
import { panel } from "../../lib/globalprimsaclient";
import genrateResponse from "../../lib/generateResponse";
import HttpStatus from "../../lib/httpStatus";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { companyPermissionWhere, revokeRoleSessions } from "../../dal/access.dal";
import { audit, checkPermissionIds, checkRoleAccess, findRole, permissionCatalog, roleCodeFromName } from "../../dal/admin.dal";
import { NO_COMPANY } from "../../dal/scope.dal";
import { RoleInput } from "../../validations/admin.validation";

// Body route par validate() se check hokar aati hai (validations/admin.validation.ts)
// Role ki permission / scope / status badle → us role wale sab users ka token band, refresh par nayi permissions

const NOT_FOUND = "Role not found";
const SYSTEM_LOCKED = "This is a system role. Its permissions and data scope cannot be changed.";
const ROLE_TOO_POWERFUL = "You cannot change a role that has more access than you";

// ============================================================
// META — permission catalog + data scopes + templates
// ============================================================
export const getRoleMeta = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.user!.company?.id;
    if (!companyId) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);

    const [catalog, templates] = await Promise.all([
      permissionCatalog(companyId),
      panel.roleMaster.findMany({
        where: { scope: RoleScope.COMPANY, is_active: true },
        orderBy: { display_order: "asc" },
        select: {
          id: true, code: true, name: true, description: true, default_data_scope: true,
          // Template ki sirf wahi permissions jo is company me chalti hain
          permissions: { where: { permission: companyPermissionWhere(companyId) }, select: { permission_id: true } },
        },
      }),
    ]);

    return genrateResponse(res, HttpStatus.OK, "Role meta", {
      catalog,
      dataScopes: Object.values(DataScope),
      templates: templates.map(({ permissions, default_data_scope, ...t }) => ({
        ...t,
        dataScope: default_data_scope,
        permissionIds: permissions.map((p) => p.permission_id),
      })),
    });
  } catch (err) {
    console.error("[RoleMeta]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to load role data");
  }
};

// ============================================================
// LIST
// ============================================================
export const listRoles = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.user!.company?.id;
    if (!companyId) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);

    const roles = await panel.role.findMany({
      where: { company_id: companyId, deleted_at: null },
      orderBy: [{ is_system: "desc" }, { name: "asc" }],
      select: {
        id: true, code: true, name: true, description: true, data_scope: true, is_system: true, is_active: true, updated_at: true,
        _count: { select: { members: true, permissions: true } },
      },
    });

    return genrateResponse(
      res,
      HttpStatus.OK,
      "Roles",
      roles.map(({ _count, data_scope, is_system, is_active, updated_at, ...r }) => ({
        ...r,
        dataScope: data_scope,
        isSystem: is_system,
        isActive: is_active,
        updatedAt: updated_at,
        members: _count.members,
        permissions: _count.permissions,
      })),
    );
  } catch (err) {
    console.error("[ListRoles]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to load roles");
  }
};

// ============================================================
// DETAIL
// ============================================================
export const getRole = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.user!.company?.id;
    if (!companyId) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);

    const role = await findRole(companyId, Number(req.params.id));
    if (!role) return genrateResponse(res, HttpStatus.NotFound, NOT_FOUND);

    return genrateResponse(res, HttpStatus.OK, "Role", {
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description,
      dataScope: role.data_scope,
      isSystem: role.is_system,
      isActive: role.is_active,
      templateId: role.role_master_id,
      members: role._count.members,
      permissionIds: role.permissions.map((p) => p.permission_id),
    });
  } catch (err) {
    console.error("[GetRole]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to load role");
  }
};

// ============================================================
// CREATE
// ============================================================
export const createRole = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.user!.company?.id;
    if (!companyId) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const body = req.body as RoleInput;

    const permissionError = await checkPermissionIds(req.user!, companyId, body.permissionIds, true);
    if (permissionError) return genrateResponse(res, HttpStatus.Forbidden, permissionError);

    const permissionIds = [...new Set(body.permissionIds)];
    const role = await panel.role.create({
      data: {
        company_id: companyId,
        role_master_id: body.templateId ?? null,
        code: body.code ?? roleCodeFromName(body.name),
        name: body.name,
        description: body.description,
        data_scope: body.dataScope,
        permissions: { create: permissionIds.map((permission_id) => ({ permission_id })) },
      },
    });

    await audit(req, {
      action: AuditAction.CREATE,
      entityType: "role",
      entityId: role.id,
      description: `Role "${role.name}" created`,
      newValues: { code: role.code, dataScope: role.data_scope, permissionIds },
    });
    return genrateResponse(res, HttpStatus.Created, "Role created", { id: role.id });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return genrateResponse(res, HttpStatus.Conflict, "A role with this code already exists");
    }
    console.error("[CreateRole]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to create role");
  }
};

// ============================================================
// UPDATE — naam, description, data scope, permissions (code nahi badalta)
// ============================================================
export const updateRole = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.user!.company?.id;
    if (!companyId) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const body = req.body as RoleInput;

    const role = await findRole(companyId, Number(req.params.id));
    if (!role) return genrateResponse(res, HttpStatus.NotFound, NOT_FOUND);
    const tooPowerful = await checkRoleAccess(req.user!, [role.id], ROLE_TOO_POWERFUL);
    if (tooPowerful) return genrateResponse(res, HttpStatus.Forbidden, tooPowerful);

    const current = role.permissions.map((p) => p.permission_id);
    const next = [...new Set(body.permissionIds)];
    const added = next.filter((id) => !current.includes(id));
    const removed = current.filter((id) => !next.includes(id));
    const accessChanged = added.length > 0 || removed.length > 0 || body.dataScope !== role.data_scope;

    if (role.is_system && accessChanged) return genrateResponse(res, HttpStatus.BadRequest, SYSTEM_LOCKED);

    // Nayi di gayi permissions admin ke paas khud honi chahiye (hatana kabhi bhi allowed)
    const permissionError = await checkPermissionIds(req.user!, companyId, added, true);
    if (permissionError) return genrateResponse(res, HttpStatus.Forbidden, permissionError);

    await panel.$transaction([
      panel.role.update({
        where: { id: role.id },
        data: { name: body.name, description: body.description, data_scope: body.dataScope },
      }),
      panel.rolePermission.deleteMany({ where: { role_id: role.id, permission_id: { in: removed } } }),
      panel.rolePermission.createMany({ data: added.map((permission_id) => ({ role_id: role.id, permission_id })), skipDuplicates: true }),
    ]);

    if (accessChanged) await revokeRoleSessions(role.id);

    await audit(req, {
      action: AuditAction.UPDATE,
      entityType: "role",
      entityId: role.id,
      description: `Role "${body.name}" updated`,
      oldValues: { name: role.name, dataScope: role.data_scope, permissionIds: current },
      newValues: { name: body.name, dataScope: body.dataScope, added, removed },
    });
    return genrateResponse(res, HttpStatus.OK, "Role updated");
  } catch (err) {
    console.error("[UpdateRole]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to update role");
  }
};

// ============================================================
// TOGGLE — active / inactive
// ============================================================
export const toggleRole = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.user!.company?.id;
    if (!companyId) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);

    const role = await findRole(companyId, Number(req.params.id));
    if (!role) return genrateResponse(res, HttpStatus.NotFound, NOT_FOUND);
    const tooPowerful = await checkRoleAccess(req.user!, [role.id], ROLE_TOO_POWERFUL);
    if (tooPowerful) return genrateResponse(res, HttpStatus.Forbidden, tooPowerful);
    if (role.is_system) return genrateResponse(res, HttpStatus.BadRequest, "A system role cannot be deactivated");

    await panel.role.update({ where: { id: role.id }, data: { is_active: !role.is_active } });
    await revokeRoleSessions(role.id);

    await audit(req, {
      action: AuditAction.UPDATE,
      entityType: "role",
      entityId: role.id,
      description: `Role "${role.name}" ${role.is_active ? "deactivated" : "activated"}`,
    });
    return genrateResponse(res, HttpStatus.OK, role.is_active ? "Role deactivated" : "Role activated");
  } catch (err) {
    console.error("[ToggleRole]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to change role status");
  }
};

// ============================================================
// DELETE — soft delete, sirf jab koi member na ho
// ============================================================
export const deleteRole = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.user!.company?.id;
    if (!companyId) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);

    const role = await findRole(companyId, Number(req.params.id));
    if (!role) return genrateResponse(res, HttpStatus.NotFound, NOT_FOUND);
    const tooPowerful = await checkRoleAccess(req.user!, [role.id], ROLE_TOO_POWERFUL);
    if (tooPowerful) return genrateResponse(res, HttpStatus.Forbidden, tooPowerful);
    if (role.is_system) return genrateResponse(res, HttpStatus.BadRequest, "A system role cannot be deleted");
    if (role._count.members > 0) {
      return genrateResponse(
        res,
        HttpStatus.Conflict,
        `${role._count.members} user(s) still have this role. Remove them first or deactivate the role.`,
      );
    }

    // Code badal do taaki same code ka naya role ban sake (company + code unique hai)
    await panel.role.update({
      where: { id: role.id },
      data: { deleted_at: new Date(), is_active: false, code: `${role.code}__DEL_${role.id}` },
    });

    await audit(req, { action: AuditAction.DELETE, entityType: "role", entityId: role.id, description: `Role "${role.name}" deleted` });
    return genrateResponse(res, HttpStatus.OK, "Role deleted");
  } catch (err) {
    console.error("[DeleteRole]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to delete role");
  }
};
