import { Request, Response } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { AuditAction, UserStatus } from "../../generated/panel/client";
import { panel } from "../../lib/globalprimsaclient";
import genrateResponse from "../../lib/generateResponse";
import HttpStatus from "../../lib/httpStatus";
import { decryptData, extractPayload } from "../../lib/apiCryptography";
import { ACCESS_TOKEN_TTL, AuthenticatedRequest, signToken, TokenPayload } from "../../middleware/authMiddleware";
import { audit } from "../../dal/admin.dal";
import { password as passwordPolicy } from "../../validations/common.validation";
import { ChangePasswordInput } from "../../validations/auth.validation";
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
const REFRESH_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 7);
// Do tab ek saath refresh karein to purana token thodi der tak "chori" nahi maana jayega
const REUSE_GRACE_MS = 60 * 1000;

const INVALID_LOGIN = "Invalid email or password";
// User na mile tab bhi bcrypt chale (seed jaisa cost 12) — warna fast response se pata chal jata ki user nahi hai
const DUMMY_HASH = bcrypt.hashSync("timing-equalizer-not-a-real-password", 12);

const getIp = (req: Request) =>
  (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() || req.socket.remoteAddress || null;

// Refresh token DB me sirf hash hokar jaata hai
const newRefreshToken = () => crypto.randomBytes(48).toString("base64url");
const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

const revokeSession = (id: number, reason: string) =>
  panel.userSession.updateMany({ where: { id, revoked_at: null }, data: { revoked_at: new Date(), revoke_reason: reason } });

function logLoginAttempt(req: Request, identifier: string, userId: number | null, success: boolean, reason?: string) {
  return panel.loginAttempt.create({
    data: { identifier, user_id: userId, success, reason, ip_address: getIp(req), user_agent: req.headers["user-agent"] || null },
  });
}

// ============================================================
// SESSION — token + user details for one company (login, refresh aur switch teeno me same)
// refreshToken sirf login / refresh par naya milta hai, switch par purana hi chalta hai
// ============================================================
async function buildSession(
  user: AccessUser,
  companyId: number | null,
  session: { public_id: string; expires_at: Date },
  refreshToken?: string,
) {
  // Is company me roles + permissions + menus, aur user ki saari companies
  const [access, companies] = await Promise.all([getAccessContext(user.id, companyId), listAccessibleCompanies(user)]);
  const activeCompany = companies.find((c) => c.id === companyId);

  const payload: TokenPayload = {
    sid: session.public_id,
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
    ...(refreshToken && { refreshToken, refreshExpiresAt: session.expires_at.toISOString() }),
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
    // Body encrypted nahi / kharab hai → 400 (500 nahi)
    let body: { email?: unknown; password?: unknown } | null = null;
    try {
      body = decryptData(req.body);
    } catch {
      return genrateResponse(res, HttpStatus.BadRequest, "Invalid request");
    }
    const { email, password } = body ?? {};
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
    // User nahi mila aur password galat — dono ka ek hi message, taaki koi pata na laga sake kaunsa account hai
    if (!user) {
      await bcrypt.compare(String(password), DUMMY_HASH); // response time bhi same rahe
      await logLoginAttempt(req, identifier, null, false, "USER_NOT_FOUND");
      return genrateResponse(res, HttpStatus.Unauthorized, INVALID_LOGIN);
    }

    // 2. Locked account par password check hi nahi (brute force band)
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
      return genrateResponse(res, HttpStatus.Unauthorized, INVALID_LOGIN);
    }

    // 4. Account active hai? (sahi password ke baad hi batate hain)
    if (user.status !== UserStatus.ACTIVE) {
      await logLoginAttempt(req, identifier, user.id, false, "NOT_ACTIVE");
      return genrateResponse(res, HttpStatus.Forbidden, "Account is not active. Please contact your administrator.");
    }

    // 5. Kaunsi company khulegi (super admin = koi company nahi, platform console)
    const companyId = await resolveDefaultCompanyId(user);
    if (!isSuperAdmin(user) && !companyId) {
      await logLoginAttempt(req, identifier, user.id, false, "NO_COMPANY_ACCESS");
      return genrateResponse(res, HttpStatus.Forbidden, "No active company assigned. Please contact your administrator.");
    }

    // 6. Login successful
    await panel.user.update({
      where: { id: user.id },
      data: { failed_login_count: 0, locked_until: null, last_login_at: new Date() },
    });
    await logLoginAttempt(req, identifier, user.id, true);

    // 7. Naya session (har device / browser ka alag)
    const refreshToken = newRefreshToken();
    const session = await panel.userSession.create({
      data: {
        user_id: user.id,
        active_company_id: companyId,
        refresh_token_hash: hashToken(refreshToken),
        expires_at: new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000),
        ip_address: getIp(req),
        user_agent: req.headers["user-agent"] || null,
      },
    });

    return genrateResponse(res, HttpStatus.OK, "Login successful", await buildSession(user, companyId, session, refreshToken));
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

    // Refresh hone par bhi yahi company khule
    const session = await panel.userSession.update({
      where: { public_id: req.user!.sid },
      data: { active_company_id: companyId },
      select: { public_id: true, expires_at: true },
    });

    const result = await buildSession(user, companyId, session);
    return genrateResponse(res, HttpStatus.OK, `Switched to ${result.user.company?.name ?? "Platform Console"}`, result);
  } catch (err) {
    console.error("[SwitchCompany]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to switch company");
  }
};

// ============================================================
// REFRESH  (refresh token → naya access token + naya refresh token)
// ============================================================
export const refreshAccessToken = async (req: Request, res: Response) => {
  const expired = () => genrateResponse(res, HttpStatus.Unauthorized, "Session expired. Please login again.");
  try {
    const { refreshToken } = extractPayload(req.body) ?? {};
    if (typeof refreshToken !== "string" || !refreshToken) {
      return genrateResponse(res, HttpStatus.BadRequest, "refreshToken is required");
    }

    const hash = hashToken(refreshToken);
    const session = await panel.userSession.findFirst({
      where: { OR: [{ refresh_token_hash: hash }, { previous_token_hash: hash }] },
    });
    if (!session || session.revoked_at || session.expires_at <= new Date()) return expired();

    // Purana (rotate ho chuka) token dobara aaya → token chori → poora session band
    if (session.previous_token_hash === hash) {
      if (Date.now() - session.last_used_at.getTime() > REUSE_GRACE_MS) {
        await revokeSession(session.id, "REFRESH_TOKEN_REUSE");
      }
      return expired();
    }

    const user = await panel.user.findFirst({
      where: { id: session.user_id, deleted_at: null, status: UserStatus.ACTIVE },
      include: accessUserInclude,
    });
    if (!user) {
      await revokeSession(session.id, "USER_INACTIVE");
      return expired();
    }

    // Session wali company abhi bhi allowed hai? nahi to default company
    let companyId = session.active_company_id;
    const companyLost = companyId != null ? !(await canAccessCompany(user, companyId)) : !isSuperAdmin(user);
    if (companyLost) companyId = await resolveDefaultCompanyId(user);
    if (!isSuperAdmin(user) && !companyId) {
      await revokeSession(session.id, "NO_COMPANY_ACCESS");
      return expired();
    }

    // Rotate — where me purana hash, taaki do request ek saath aayein to ek hi jeete
    const nextToken = newRefreshToken();
    const rotated = await panel.userSession.updateMany({
      where: { id: session.id, refresh_token_hash: hash, revoked_at: null },
      data: {
        previous_token_hash: hash,
        refresh_token_hash: hashToken(nextToken),
        last_used_at: new Date(),
        active_company_id: companyId,
        ip_address: getIp(req),
        user_agent: req.headers["user-agent"] || null,
      },
    });
    if (rotated.count === 0) return expired();

    return genrateResponse(res, HttpStatus.OK, "Token refreshed", await buildSession(user, companyId, session, nextToken));
  } catch (err) {
    console.error("[Refresh]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to refresh session");
  }
};

// ============================================================
// LOGOUT  (refresh token se session band — access token expire ho chuka ho tab bhi chalega)
// ============================================================
export const logout = async (req: Request, res: Response) => {
  try {
    const { refreshToken } = extractPayload(req.body) ?? {};
    if (typeof refreshToken === "string" && refreshToken) {
      const hash = hashToken(refreshToken);
      await panel.userSession.updateMany({
        where: { OR: [{ refresh_token_hash: hash }, { previous_token_hash: hash }], revoked_at: null },
        data: { revoked_at: new Date(), revoke_reason: "LOGOUT" },
      });
    }
    return genrateResponse(res, HttpStatus.OK, "Logged out");
  } catch (err) {
    console.error("[Logout]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Logout failed");
  }
};

// ============================================================
// CHANGE PASSWORD  (logged-in user — purana password hi pehchaan hai, OTP nahi)
// Ye device logged in rehta hai, baaki sab devices se logout
// ============================================================
export const changePassword = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body as ChangePasswordInput;

    const user = await panel.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, username: true, password_hash: true },
    });
    if (!user) return genrateResponse(res, HttpStatus.Unauthorized, "Session expired. Please login again.");

    if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
      return genrateResponse(res, HttpStatus.BadRequest, "Current password is incorrect");
    }
    if (currentPassword === newPassword) {
      return genrateResponse(res, HttpStatus.BadRequest, "New password must be different from the current password");
    }
    // Policy validate() me chal chuki — yahan sirf "username na ho"
    const check = passwordPolicy(user.username).safeParse(newPassword);
    if (!check.success) return genrateResponse(res, HttpStatus.BadRequest, check.error.issues[0]?.message ?? "Weak password");

    const password_hash = await bcrypt.hash(newPassword, 12);
    await panel.$transaction([
      panel.user.update({
        where: { id: user.id },
        data: { password_hash, password_changed_at: new Date(), must_change_password: false },
      }),
      panel.userSession.updateMany({
        where: { user_id: user.id, revoked_at: null, public_id: { not: req.user!.sid } },
        data: { revoked_at: new Date(), revoke_reason: "PASSWORD_CHANGED" },
      }),
    ]);

    await audit(req, { action: AuditAction.PASSWORD_CHANGE, entityType: "user", entityId: user.id, description: "Password changed by user" });
    return genrateResponse(res, HttpStatus.OK, "Password changed. You have been logged out from other devices.");
  } catch (err) {
    console.error("[ChangePassword]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to change password");
  }
};
