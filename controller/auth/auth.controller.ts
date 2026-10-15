import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { UserStatus } from "../../generated/panel/client";
import { panel } from "../../lib/globalprimsaclient";
import genrateResponse from "../../lib/generateResponse";
import HttpStatus from "../../lib/httpStatus";
import { decryptData, extractPayload } from "../../lib/apiCryptography";
import { ACCESS_TOKEN_TTL, AuthenticatedRequest, signToken, TokenPayload } from "../../middleware/authMiddleware";
import {
  AccessUser,
  accessUserInclude,
  canAccessCompany,
  getAccessContext,
  isSuperAdmin,
  listAccessibleCompanies,
  resolveDefaultCompanyId,
} from "../../dal/access.dal";

const MAX_WRONG_PASSWORD = Number(process.env.MAX_WRONG_PASSWORD ?? 5);
const LOCK_MINUTES = Number(process.env.LOCK_MINUTES ?? 30);

const getIp = (req: Request) =>
  (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() || req.socket.remoteAddress || null;

function logLoginAttempt(req: Request, identifier: string, userId: number | null, success: boolean, reason?: string) {
  return panel.loginAttempt.create({
    data: { identifier, user_id: userId, success, reason, ip_address: getIp(req), user_agent: req.headers["user-agent"] || null },
  });
}

// ============================================================
// SESSION — token + user details for one company (login aur switch dono me same)
// ============================================================
async function buildSession(user: AccessUser, companyId: number | null) {
  // Is company me roles + permissions + menus, aur user ki saari companies
  const [access, companies] = await Promise.all([getAccessContext(user.id, companyId), listAccessibleCompanies(user)]);
  const activeCompany = companies.find((c) => c.id === companyId);

  const payload: TokenPayload = {
    userId: user.id,
    tokenVersion: user.token_version,
    username: user.username,
    name: [user.first_name, user.last_name].filter(Boolean).join(" "),
    isSuperAdmin: access.isSuperAdmin,
    company: activeCompany ? { id: activeCompany.id, code: activeCompany.code, name: activeCompany.name } : null,
    companyUserId: access.companyUserId,
    roles: access.roles,
    dataScope: access.dataScope,
    permissions: access.isSuperAdmin ? [] : access.permissions, // super admin ko sab allowed, list ki zarurat nahi
  };

  return {
    token: signToken(payload),
    expiresIn: ACCESS_TOKEN_TTL,
    user: {
      ...payload,
      email: user.email,
      phone: user.phone,
      mustChangePassword: user.must_change_password,
      permissions: access.permissions, // frontend buttons dikhane/chhupane ke liye
      companies, // company switcher ke liye
      menus: access.menus, // sidebar ke liye
    },
  };
}

// ============================================================
// LOGIN  (email / username / phone + password)
// ============================================================
export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = decryptData(req.body) ?? {};
    if (!email || !password) return genrateResponse(res, HttpStatus.BadRequest, "Email and password are required");

    const identifier = String(email).trim();

    // 1. User dhundo
    const user = await panel.user.findFirst({
      where: {
        deleted_at: null,
        OR: [{ email: identifier.toLowerCase() }, { username: identifier.toLowerCase() }, { phone: identifier }],
      },
      include: accessUserInclude,
    });
    if (!user) {
      await logLoginAttempt(req, identifier, null, false, "USER_NOT_FOUND");
      return genrateResponse(res, HttpStatus.Unauthorized, "Invalid credentials");
    }

    // 2. Account active hai?
    if (user.status !== UserStatus.ACTIVE) {
      return genrateResponse(res, HttpStatus.Forbidden, "Account is not active. Please contact your administrator.");
    }
    if (user.locked_until && user.locked_until > new Date()) {
      const till = user.locked_until.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" });
      return genrateResponse(res, HttpStatus.Forbidden, `Account locked till ${till}. Please try again later.`);
    }

    // 3. Password check
    const passwordOk = await bcrypt.compare(String(password), user.password_hash);
    if (!passwordOk) {
      await logLoginAttempt(req, identifier, user.id, false, "WRONG_PASSWORD");
      const failed = user.failed_login_count + 1;

      if (failed >= MAX_WRONG_PASSWORD) {
        await panel.user.update({
          where: { id: user.id },
          data: { failed_login_count: 0, locked_until: new Date(Date.now() + LOCK_MINUTES * 60 * 1000) },
        });
        return genrateResponse(res, HttpStatus.Forbidden, `Too many wrong attempts. Account locked for ${LOCK_MINUTES} minutes.`);
      }

      await panel.user.update({ where: { id: user.id }, data: { failed_login_count: failed } });
      const remainingAttempts = MAX_WRONG_PASSWORD - failed;
      return genrateResponse(res, HttpStatus.Unauthorized, `Invalid password. ${remainingAttempts} attempt(s) left.`, {
        remainingAttempts,
      });
    }

    // 4. Kaunsi company khulegi (super admin = koi company nahi, platform console)
    const companyId = await resolveDefaultCompanyId(user);
    if (!isSuperAdmin(user) && !companyId) {
      await logLoginAttempt(req, identifier, user.id, false, "NO_COMPANY_ACCESS");
      return genrateResponse(res, HttpStatus.Forbidden, "No active company assigned. Please contact your administrator.");
    }

    // 5. Login successful
    await panel.user.update({
      where: { id: user.id },
      data: { failed_login_count: 0, locked_until: null, last_login_at: new Date() },
    });
    await logLoginAttempt(req, identifier, user.id, true);

    return genrateResponse(res, HttpStatus.OK, "Login successful", await buildSession(user, companyId));
  } catch (err) {
    console.error("[Login]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Login failed");
  }
};
// ============================================================
// SWITCH COMPANY  (company_id: null → super admin platform console)
// ============================================================
export const switchCompany = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = extractPayload(req.body) ?? {};
    const companyId = data.company_id == null ? null : Number(data.company_id);

    const user = await panel.user.findFirst({
      where: { id: req.user!.userId, deleted_at: null, status: UserStatus.ACTIVE },
      include: accessUserInclude,
    });
    if (!user) return genrateResponse(res, HttpStatus.Unauthorized, "Session expired. Please login again.");

    if (companyId == null) {
      if (!isSuperAdmin(user)) return genrateResponse(res, HttpStatus.BadRequest, "Valid company_id is required");
    } else if (!companyId || !(await canAccessCompany(user, companyId))) {
      return genrateResponse(res, HttpStatus.Forbidden, "You do not have access to this company");
    }

    const session = await buildSession(user, companyId);
    return genrateResponse(res, HttpStatus.OK, `Switched to ${session.user.company?.name ?? "Platform Console"}`, session);
  } catch (err) {
    console.error("[SwitchCompany]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to switch company");
  }
};
