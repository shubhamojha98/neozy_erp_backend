import { Response } from "express";
import bcrypt from "bcrypt";
import { AuditAction, Prisma, UserStatus } from "../../generated/panel/client";
import { panel } from "../../lib/globalprimsaclient";
import genrateResponse from "../../lib/generateResponse";
import HttpStatus from "../../lib/httpStatus";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { logoutUserEverywhere, revokeUserSessions } from "../../dal/access.dal";
import {
  audit,
  CANNOT_ASSIGN_ROLE,
  CANNOT_MANAGE_USER,
  checkPermissionIds,
  checkRoleAccess,
  checkRoleIds,
  COMPANY_ADMIN,
  findMember,
  hasAdminRole,
  isActiveMember,
  otherActiveAdmins,
  permissionCatalog,
  uniqueUsername,
} from "../../dal/admin.dal";
import { fullName, NO_COMPANY } from "../../dal/scope.dal";
import { password } from "../../validations/common.validation";
import {
  AttachUserInput,
  CreateUserInput,
  UpdateUserInput,
  USER_CARDS,
  UserPermissionsInput,
  userListQuery,
} from "../../validations/admin.validation";

// Body route par validate() se check hokar aati hai (validations/admin.validation.ts)
// :id = CompanyUser id (user ki is company wali membership)
// Role / permission / status badle → user ka token band, refresh par nayi permissions (ya logout)

const BCRYPT_ROUNDS = 12; // seed jaisa
const NOT_FOUND = "User not found";
const DUPLICATE = "Employee code, email, phone or username is already in use";
const LAST_ADMIN = "This is the last active Company Admin. Make someone else admin first.";

// Upar wala KPI card → filter
type UserCard = (typeof USER_CARDS)[number];
const USER_CARD_FILTERS: Record<UserCard, Prisma.CompanyUserWhereInput> = {
  ACTIVE: { is_active: true },
  INACTIVE: { is_active: false },
  ADMINS: { roles: { some: { role: { code: COMPANY_ADMIN } } } },
  PENDING: { user: { must_change_password: true } }, // admin ka temporary password abhi tak nahi badla
};

const isDuplicate = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

// Company jisme kaam ho raha hai (tenant + tree path + user limit)
const getCompany = (companyId: number) =>
  panel.company.findUnique({ where: { id: companyId }, select: { tenant_id: true, hierarchy_path: true, max_users: true } });

// Create / attach dono me: roles, manager aur user limit check. Galat ho to [status, message]
async function checkNewMember(
  req: AuthenticatedRequest,
  company: { max_users: number | null },
  companyId: number,
  body: { roleIds: number[]; reportsToId?: number | null },
): Promise<[HttpStatus, string] | null> {
  const roleError = await checkRoleIds(companyId, body.roleIds);
  if (roleError) return [HttpStatus.BadRequest, roleError];
  const roleAccess = await checkRoleAccess(req.user!, body.roleIds, CANNOT_ASSIGN_ROLE);
  if (roleAccess) return [HttpStatus.Forbidden, roleAccess];
  if (body.reportsToId && !(await isActiveMember(companyId, body.reportsToId))) return [HttpStatus.BadRequest, "Select a valid manager"];

  if (company.max_users) {
    const active = await panel.companyUser.count({ where: { company_id: companyId, is_active: true } });
    if (active >= company.max_users) return [HttpStatus.Forbidden, `User limit reached (${company.max_users}). Contact your provider.`];
  }
  return null;
}

// ============================================================
// META — roles + managers dropdown
// ============================================================
export const getUserMeta = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.user!.company?.id;
    if (!companyId) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);

    const [roles, managers] = await Promise.all([
      panel.role.findMany({
        where: { company_id: companyId, is_active: true, deleted_at: null },
        orderBy: { name: "asc" },
        select: { id: true, code: true, name: true, data_scope: true },
      }),
      panel.companyUser.findMany({
        where: { company_id: companyId, is_active: true, user: { status: UserStatus.ACTIVE, deleted_at: null } },
        select: { id: true, designation: true, user: { select: { first_name: true, last_name: true, username: true } } },
      }),
    ]);

    // canAssign: role ki saari permissions admin ke paas hain? (form me baaki roles disabled dikhte hain)
    const rolePermissions = await panel.rolePermission.findMany({
      where: { role_id: { in: roles.map((r) => r.id) } },
      select: { role_id: true, permission: { select: { code: true } } },
    });
    const canAssign = (roleId: number) =>
      req.user!.isSuperAdmin ||
      rolePermissions.filter((rp) => rp.role_id === roleId).every((rp) => req.user!.permissions.includes(rp.permission.code));

    return genrateResponse(res, HttpStatus.OK, "User meta", {
      catalog: await permissionCatalog(companyId), // "Extra permissions" ke dropdown ke liye
      roles: roles.map(({ data_scope, ...r }) => ({ ...r, dataScope: data_scope, canAssign: canAssign(r.id) })),
      managers: managers
        .map((m) => ({ id: m.id, name: fullName(m.user), designation: m.designation }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (err) {
    console.error("[UserMeta]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to load form data");
  }
};

// ============================================================
// LIST — search, status, role, pagination
// ============================================================
export const listUsers = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.user!.company?.id;
    if (!companyId) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);

    const { page, perPage, search, card, roleId } = userListQuery.parse(req.query);

    // base = search + role (cards ke number isi par), where = base + chuna hua card
    const base: Prisma.CompanyUserWhereInput = {
      company_id: companyId,
      user: { deleted_at: null },
      ...(roleId && { roles: { some: { role_id: roleId } } }),
      ...(search && {
        OR: [
          { employee_code: { contains: search, mode: "insensitive" } },
          { user: { first_name: { contains: search, mode: "insensitive" } } },
          { user: { last_name: { contains: search, mode: "insensitive" } } },
          { user: { username: { contains: search, mode: "insensitive" } } },
          { user: { email: { contains: search, mode: "insensitive" } } },
          { user: { phone: { contains: search } } },
        ],
      }),
    };
    const where: Prisma.CompanyUserWhereInput = card ? { AND: [base, USER_CARD_FILTERS[card]] } : base;
    const cardCount = (c: UserCard) => panel.companyUser.count({ where: { AND: [base, USER_CARD_FILTERS[c]] } });

    const [rows, total, all, active, inactive, admins, pending] = await Promise.all([
      panel.companyUser.findMany({
        where,
        orderBy: { joined_at: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true, employee_code: true, designation: true, department: true, is_active: true, joined_at: true,
          reports_to: { select: { user: { select: { first_name: true, last_name: true, username: true } } } },
          user: {
            select: {
              id: true, username: true, first_name: true, last_name: true, email: true, phone: true,
              status: true, last_login_at: true, must_change_password: true,
            },
          },
          roles: { select: { role: { select: { id: true, code: true, name: true } } } },
          _count: { select: { permission_overrides: true } },
        },
      }),
      panel.companyUser.count({ where }),
      panel.companyUser.count({ where: base }),
      cardCount("ACTIVE"),
      cardCount("INACTIVE"),
      cardCount("ADMINS"),
      cardCount("PENDING"),
    ]);

    return genrateResponse(res, HttpStatus.OK, "Users", {
      rows: rows.map((m) => ({
        id: m.id,
        userId: m.user.id,
        name: fullName(m.user),
        username: m.user.username,
        email: m.user.email,
        phone: m.user.phone,
        employeeCode: m.employee_code,
        designation: m.designation,
        department: m.department,
        reportsTo: m.reports_to ? fullName(m.reports_to.user) : null,
        roles: m.roles.map((r) => r.role),
        isActive: m.is_active,
        accountStatus: m.user.status,
        mustChangePassword: m.user.must_change_password, // "Pending setup" badge
        extraPermissions: m._count.permission_overrides, // "+1 extra" badge
        lastLoginAt: m.user.last_login_at,
        joinedAt: m.joined_at,
      })),
      total,
      stats: { total: all, active, inactive, admins, pending },
    });
  } catch (err) {
    console.error("[ListUsers]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to load users");
  }
};

// ============================================================
// DETAIL — profile + membership + roles + permission overrides
// ============================================================
export const getUser = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.user!.company?.id;
    if (!companyId) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);

    const member = await findMember(companyId, Number(req.params.id));
    if (!member) return genrateResponse(res, HttpStatus.NotFound, NOT_FOUND);

    const overrides = await panel.userPermissionOverride.findMany({
      where: { company_user_id: member.id },
      select: { permission_id: true, effect: true, reason: true, valid_until: true, permission: { select: { code: true, name: true } } },
    });

    const { user } = member;
    return genrateResponse(res, HttpStatus.OK, "User", {
      id: member.id,
      userId: user.id,
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      phone: user.phone,
      employeeCode: member.employee_code,
      designation: member.designation,
      department: member.department,
      reportsToId: member.reports_to_id,
      roleIds: member.roles.map((r) => r.role_id),
      isActive: member.is_active,
      accountStatus: user.status,
      mustChangePassword: user.must_change_password,
      isHomeCompany: user.home_company_id === companyId, // naam / email / password sirf home company se badlega
      lastLoginAt: user.last_login_at,
      joinedAt: member.joined_at,
      overrides: overrides.map((o) => ({
        permissionId: o.permission_id,
        code: o.permission.code,
        name: o.permission.name,
        effect: o.effect,
        reason: o.reason,
        validUntil: o.valid_until,
      })),
    });
  } catch (err) {
    console.error("[GetUser]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to load user");
  }
};

// ============================================================
// CREATE — naya login + is company ki membership + roles
// ============================================================
export const createUser = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.user!.company?.id;
    if (!companyId) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const body = req.body as CreateUserInput;

    const company = await getCompany(companyId);
    if (!company) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);

    // 1. Email / phone / username pehle se hai? (ye poore system me unique hain)
    const identity: Prisma.UserWhereInput[] = [];
    if (body.email) identity.push({ email: body.email });
    if (body.phone) identity.push({ phone: body.phone });
    if (body.username) identity.push({ username: body.username });
    const existing = await panel.user.findFirst({
      where: { OR: identity },
      select: {
        id: true, tenant_id: true, deleted_at: true, first_name: true, last_name: true, username: true,
        home_company: { select: { hierarchy_path: true } },
        memberships: { where: { company_id: companyId }, select: { id: true } },
      },
    });
    if (existing) {
      if (existing.memberships.length) return genrateResponse(res, HttpStatus.Conflict, "This user is already in this company");

      // Same organisation ka user, aur ye company uske home tree me hai → naya mat banao, attach karo
      const sameTree =
        !existing.deleted_at &&
        existing.tenant_id === company.tenant_id &&
        !!existing.home_company &&
        company.hierarchy_path.startsWith(existing.home_company.hierarchy_path);
      if (sameTree) {
        return genrateResponse(
          res,
          HttpStatus.Conflict,
          "This user already exists in another company of your organisation. Add them to this company instead.",
          { existingUserId: existing.id, name: fullName(existing) },
        );
      }
      // Dusre client ka user — uski koi detail nahi batani
      return genrateResponse(res, HttpStatus.Conflict, "Email, phone or username is already in use");
    }

    // 2. Roles, manager, user limit
    const problem = await checkNewMember(req, company, companyId, body);
    if (problem) return genrateResponse(res, problem[0], problem[1]);

    // 3. User + membership + roles ek saath
    const username = body.username ?? (await uniqueUsername(body.email?.split("@")[0] ?? body.phone ?? body.firstName));
    const password_hash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);
    const roleIds = [...new Set(body.roleIds)];

    const member = await panel.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username,
          email: body.email,
          phone: body.phone,
          first_name: body.firstName,
          last_name: body.lastName,
          password_hash,
          password_changed_at: new Date(),
          must_change_password: true, // admin ka diya password — pehle login par badalna hoga
          tenant_id: company.tenant_id,
          home_company_id: companyId,
        },
      });
      const created = await tx.companyUser.create({
        data: {
          tenant_id: company.tenant_id,
          company_id: companyId,
          user_id: user.id,
          employee_code: body.employeeCode,
          designation: body.designation,
          department: body.department,
          reports_to_id: body.reportsToId,
          is_default: true,
        },
      });
      await tx.companyUserRole.createMany({
        data: roleIds.map((role_id) => ({ company_id: companyId, company_user_id: created.id, role_id, assigned_by_id: req.user!.companyUserId })),
      });
      return created;
    });

    await audit(req, {
      action: AuditAction.CREATE,
      entityType: "user",
      entityId: member.user_id,
      description: `User "${username}" created`,
      newValues: { companyUserId: member.id, roleIds, employeeCode: body.employeeCode ?? null },
    });
    return genrateResponse(res, HttpStatus.Created, "User created", { id: member.id, userId: member.user_id, username });
  } catch (err) {
    if (isDuplicate(err)) return genrateResponse(res, HttpStatus.Conflict, DUPLICATE);
    console.error("[CreateUser]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to create user");
  }
};

// ============================================================
// ATTACH — same organisation ka existing user is company me bhi
// ============================================================
export const attachUser = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.user!.company?.id;
    if (!companyId) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const body = req.body as AttachUserInput;

    const company = await getCompany(companyId);
    if (!company) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);

    const user = await panel.user.findFirst({
      where: { id: body.userId, deleted_at: null },
      select: {
        id: true, tenant_id: true, username: true,
        home_company: { select: { hierarchy_path: true } },
        memberships: { where: { company_id: companyId }, select: { is_active: true } },
      },
    });
    // Rule: user sirf apni home company ya uski sub-companies me ja sakta hai
    const allowed =
      user && user.tenant_id === company.tenant_id && !!user.home_company && company.hierarchy_path.startsWith(user.home_company.hierarchy_path);
    if (!user || !allowed) return genrateResponse(res, HttpStatus.NotFound, NOT_FOUND);
    if (user.memberships.length) {
      return genrateResponse(
        res,
        HttpStatus.Conflict,
        user.memberships[0].is_active ? "This user is already in this company" : "This user is already in this company but inactive. Activate them instead.",
      );
    }

    const problem = await checkNewMember(req, company, companyId, body);
    if (problem) return genrateResponse(res, problem[0], problem[1]);

    const roleIds = [...new Set(body.roleIds)];
    const member = await panel.$transaction(async (tx) => {
      const created = await tx.companyUser.create({
        data: {
          tenant_id: company.tenant_id,
          company_id: companyId,
          user_id: user.id,
          employee_code: body.employeeCode,
          designation: body.designation,
          department: body.department,
          reports_to_id: body.reportsToId,
        },
      });
      await tx.companyUserRole.createMany({
        data: roleIds.map((role_id) => ({ company_id: companyId, company_user_id: created.id, role_id, assigned_by_id: req.user!.companyUserId })),
      });
      return created;
    });

    // Company switcher me nayi company refresh par dikh jaye
    await revokeUserSessions([user.id]);

    await audit(req, {
      action: AuditAction.CREATE,
      entityType: "user",
      entityId: user.id,
      description: `User "${user.username}" added to company`,
      newValues: { companyUserId: member.id, roleIds },
    });
    return genrateResponse(res, HttpStatus.Created, "User added to this company", { id: member.id, userId: user.id });
  } catch (err) {
    if (isDuplicate(err)) return genrateResponse(res, HttpStatus.Conflict, DUPLICATE);
    console.error("[AttachUser]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to add user");
  }
};

// ============================================================
// UPDATE — profile (sirf home company se) + membership + roles
// ============================================================
export const updateUser = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.user!.company?.id;
    if (!companyId) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const body = req.body as UpdateUserInput;

    const member = await findMember(companyId, Number(req.params.id));
    if (!member) return genrateResponse(res, HttpStatus.NotFound, NOT_FOUND);

    const isSelf = member.id === req.user!.companyUserId;
    const current = member.roles.map((r) => r.role_id);
    const next = [...new Set(body.roleIds)];
    const added = next.filter((id) => !current.includes(id));
    const removed = current.filter((id) => !next.includes(id));
    const rolesChanged = added.length > 0 || removed.length > 0;

    // 1. Kaun kisko badal sakta hai
    if (isSelf && rolesChanged) return genrateResponse(res, HttpStatus.BadRequest, "You cannot change your own roles");
    if (!isSelf) {
      const manage = await checkRoleAccess(req.user!, current, CANNOT_MANAGE_USER);
      if (manage) return genrateResponse(res, HttpStatus.Forbidden, manage);
    }

    // 2. Naye roles + manager
    if (added.length) {
      const roleError = await checkRoleIds(companyId, added);
      if (roleError) return genrateResponse(res, HttpStatus.BadRequest, roleError);
      const roleAccess = await checkRoleAccess(req.user!, added, CANNOT_ASSIGN_ROLE);
      if (roleAccess) return genrateResponse(res, HttpStatus.Forbidden, roleAccess);
    }
    if (body.reportsToId === member.id) return genrateResponse(res, HttpStatus.BadRequest, "A user cannot report to themselves");
    if (body.reportsToId && !(await isActiveMember(companyId, body.reportsToId))) {
      return genrateResponse(res, HttpStatus.BadRequest, "Select a valid manager");
    }

    // 3. Last admin ka admin role nahi hat sakta
    if (rolesChanged && member.is_active && hasAdminRole(member.roles)) {
      const adminRole = member.roles.find((r) => r.role.code === COMPANY_ADMIN)!;
      if (!next.includes(adminRole.role_id) && (await otherActiveAdmins(companyId, member.id)) === 0) {
        return genrateResponse(res, HttpStatus.BadRequest, LAST_ADMIN);
      }
    }

    // 4. Naam / email / phone user ka hai (sab companies me same) → sirf home company se
    const { user } = member;
    const isHome = user.home_company_id === companyId;
    const profileChanged =
      body.firstName !== user.first_name ||
      (body.lastName ?? null) !== user.last_name ||
      (body.email ?? null) !== user.email ||
      (body.phone ?? null) !== user.phone;
    if (profileChanged && !isHome) {
      return genrateResponse(res, HttpStatus.Forbidden, "Name, email and phone can be changed only from the user's home company");
    }

    await panel.$transaction(async (tx) => {
      if (profileChanged) {
        await tx.user.update({
          where: { id: user.id },
          data: { first_name: body.firstName, last_name: body.lastName, email: body.email, phone: body.phone },
        });
      }
      await tx.companyUser.update({
        where: { id: member.id },
        data: { employee_code: body.employeeCode, designation: body.designation, department: body.department, reports_to_id: body.reportsToId },
      });
      if (removed.length) await tx.companyUserRole.deleteMany({ where: { company_user_id: member.id, role_id: { in: removed } } });
      if (added.length) {
        await tx.companyUserRole.createMany({
          data: added.map((role_id) => ({ company_id: companyId, company_user_id: member.id, role_id, assigned_by_id: req.user!.companyUserId })),
          skipDuplicates: true,
        });
      }
    });

    if (rolesChanged) await revokeUserSessions([user.id]);

    await audit(req, {
      action: AuditAction.UPDATE,
      entityType: "user",
      entityId: user.id,
      description: `User "${user.username}" updated`,
      oldValues: { roleIds: current, employeeCode: member.employee_code, designation: member.designation, reportsToId: member.reports_to_id },
      newValues: { added, removed, employeeCode: body.employeeCode ?? null, designation: body.designation ?? null, reportsToId: body.reportsToId ?? null },
    });
    return genrateResponse(res, HttpStatus.OK, "User updated");
  } catch (err) {
    if (isDuplicate(err)) return genrateResponse(res, HttpStatus.Conflict, DUPLICATE);
    console.error("[UpdateUser]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to update user");
  }
};

// ============================================================
// PERMISSIONS — role ke upar extra GRANT / REVOKE (poori list replace)
// ============================================================
export const setUserPermissions = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.user!.company?.id;
    if (!companyId) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const { overrides } = req.body as UserPermissionsInput;

    const member = await findMember(companyId, Number(req.params.id));
    if (!member) return genrateResponse(res, HttpStatus.NotFound, NOT_FOUND);
    if (member.id === req.user!.companyUserId) return genrateResponse(res, HttpStatus.BadRequest, "You cannot change your own permissions");

    const manage = await checkRoleAccess(req.user!, member.roles.map((r) => r.role_id), CANNOT_MANAGE_USER);
    if (manage) return genrateResponse(res, HttpStatus.Forbidden, manage);

    // GRANT: admin ke paas khud ho. REVOKE: bas is company ki permission ho
    const grantIds = overrides.filter((o) => o.effect === "GRANT").map((o) => o.permissionId);
    const revokeIds = overrides.filter((o) => o.effect === "REVOKE").map((o) => o.permissionId);
    const grantError = await checkPermissionIds(req.user!, companyId, grantIds, true);
    if (grantError) return genrateResponse(res, HttpStatus.Forbidden, grantError);
    const revokeError = await checkPermissionIds(req.user!, companyId, revokeIds, false);
    if (revokeError) return genrateResponse(res, HttpStatus.BadRequest, revokeError);

    await panel.$transaction([
      panel.userPermissionOverride.deleteMany({ where: { company_user_id: member.id } }),
      panel.userPermissionOverride.createMany({
        data: overrides.map((o) => ({
          company_id: companyId,
          company_user_id: member.id,
          permission_id: o.permissionId,
          effect: o.effect,
          reason: o.reason,
          valid_until: o.validUntil,
          granted_by_id: req.user!.companyUserId,
        })),
      }),
    ]);

    await revokeUserSessions([member.user_id]);

    await audit(req, {
      action: AuditAction.UPDATE,
      entityType: "user",
      entityId: member.user_id,
      description: `Permission overrides updated for "${member.user.username}"`,
      newValues: { grant: grantIds, revoke: revokeIds },
    });
    return genrateResponse(res, HttpStatus.OK, "Permissions updated");
  } catch (err) {
    console.error("[SetUserPermissions]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to update permissions");
  }
};

// ============================================================
// STATUS — is company me active / inactive
// ============================================================
export const setUserStatus = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.user!.company?.id;
    if (!companyId) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const { active } = req.body as { active: boolean };

    const member = await findMember(companyId, Number(req.params.id));
    if (!member) return genrateResponse(res, HttpStatus.NotFound, NOT_FOUND);
    if (member.id === req.user!.companyUserId) return genrateResponse(res, HttpStatus.BadRequest, "You cannot change your own status");

    const manage = await checkRoleAccess(req.user!, member.roles.map((r) => r.role_id), CANNOT_MANAGE_USER);
    if (manage) return genrateResponse(res, HttpStatus.Forbidden, manage);

    if (!active && member.is_active && hasAdminRole(member.roles) && (await otherActiveAdmins(companyId, member.id)) === 0) {
      return genrateResponse(res, HttpStatus.BadRequest, LAST_ADMIN);
    }

    await panel.companyUser.update({ where: { id: member.id }, data: { is_active: active, left_at: active ? null : new Date() } });
    // Inactive → agli request par 401, refresh par dusri company (ho to) ya logout
    await revokeUserSessions([member.user_id]);

    await audit(req, {
      action: AuditAction.UPDATE,
      entityType: "user",
      entityId: member.user_id,
      description: `User "${member.user.username}" ${active ? "activated" : "deactivated"}`,
    });
    return genrateResponse(res, HttpStatus.OK, active ? "User activated" : "User deactivated");
  } catch (err) {
    console.error("[SetUserStatus]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to change user status");
  }
};

// ============================================================
// RESET PASSWORD — admin temporary password deta hai (OTP aane tak)
// ============================================================
export const resetUserPassword = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.user!.company?.id;
    if (!companyId) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);

    const member = await findMember(companyId, Number(req.params.id));
    if (!member) return genrateResponse(res, HttpStatus.NotFound, NOT_FOUND);
    if (member.id === req.user!.companyUserId) return genrateResponse(res, HttpStatus.BadRequest, "You cannot reset your own password here");
    if (member.user.home_company_id !== companyId) {
      return genrateResponse(res, HttpStatus.Forbidden, "Password can be reset only from the user's home company");
    }

    const manage = await checkRoleAccess(req.user!, member.roles.map((r) => r.role_id), CANNOT_MANAGE_USER);
    if (manage) return genrateResponse(res, HttpStatus.Forbidden, manage);

    // Policy validate() me chal chuki — yahan sirf "username na ho" (username DB se aata hai)
    const check = password(member.user.username).safeParse(req.body.password);
    if (!check.success) return genrateResponse(res, HttpStatus.BadRequest, check.error.issues[0]?.message ?? "Weak password");

    await panel.user.update({
      where: { id: member.user_id },
      data: {
        password_hash: await bcrypt.hash(check.data, BCRYPT_ROUNDS),
        password_changed_at: new Date(),
        must_change_password: true,
        failed_login_count: 0,
        locked_until: null,
      },
    });
    await logoutUserEverywhere([member.user_id]);

    await audit(req, {
      action: AuditAction.PASSWORD_CHANGE,
      entityType: "user",
      entityId: member.user_id,
      description: `Password reset by admin for "${member.user.username}"`,
    });
    return genrateResponse(res, HttpStatus.OK, "Password reset. The user has been logged out from all devices.");
  } catch (err) {
    console.error("[ResetUserPassword]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to reset password");
  }
};
