import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { DataScope, UserStatus } from "../generated/panel/client";
import { panel } from "../lib/globalprimsaclient";
import "dotenv/config";

const JWT_SECRET = process.env.JWT_SECRET ?? "";
if (JWT_SECRET.length < 32)
  throw new Error("JWT_SECRET missing or shorter than 32 characters");

export const ACCESS_TOKEN_TTL = (process.env.JWT_EXPIRES_IN ??
  "8h") as `${number}h`;

// Ye sab JWT ke andar jaata hai
export type TokenPayload = {
  userId: number;
  tokenVersion: number; // users.token_version — badalte hi purana token band
  username: string;
  name: string;
  isSuperAdmin: boolean;
  company: { id: number; code: string; name: string } | null; // active company
  companyUserId: number | null;
  roles: string[]; // ["SALES_MANAGER"]
  dataScope: DataScope | null; // SELF / TEAM / COMPANY / COMPANY_TREE
  permissions: string[]; // ["sales.quotations.view", "sales.quotations.approve", ...]
};

export interface AuthenticatedRequest extends Request {
  user?: TokenPayload;
}

// Permissions JWT me chhote format me jaati hain (cookie 4KB limit):
// ["sales.quotations.view", "sales.quotations.edit"] → ["sales.quotations:VE"]
const ACTION_LETTER: Record<string, string> = {
  view: "V", create: "C", edit: "E", delete: "D", approve: "A",
  assign: "S", export: "X", import: "I", print: "P",
};
const LETTER_ACTION = Object.fromEntries(Object.entries(ACTION_LETTER).map(([action, letter]) => [letter, action]));

const packPermissions = (codes: string[]) => {
  const byMenu = new Map<string, string>();
  for (const code of codes) {
    const dot = code.lastIndexOf(".");
    const menu = code.slice(0, dot);
    byMenu.set(menu, (byMenu.get(menu) ?? "") + ACTION_LETTER[code.slice(dot + 1)]);
  }
  return [...byMenu].map(([menu, letters]) => `${menu}:${letters}`);
};

const unpackPermissions = (packed: string[]) =>
  packed.flatMap((entry) => {
    const [menu, letters] = entry.split(":");
    return [...letters].map((letter) => `${menu}.${LETTER_ACTION[letter]}`);
  });

export const signToken = (payload: TokenPayload) =>
  jwt.sign({ ...payload, permissions: packPermissions(payload.permissions) }, JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL,
    algorithm: "HS256",
  });

const deny = (res: Response, status: number, message: string) => {
  res.status(status).json({ success: false, message });
};

// Token check karo aur req.user me user ki saari details daal do
export const authMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return deny(res, 401, "Authorization token missing");

  let user: TokenPayload;
  try {
    const { iat, exp, ...payload } = jwt.verify(token, JWT_SECRET, {
      algorithms: ["HS256"],
    }) as TokenPayload & { iat: number; exp: number };
    user = payload;
  } catch (err) {
    return deny(
      res,
      401,
      err instanceof jwt.TokenExpiredError ? "Token has expired" : "Invalid token",
    );
  }

  // Har request par DB check: user active hai, token purana to nahi, company access abhi bhi hai
  try {
    const current = await panel.user.findUnique({
      where: { id: user.userId },
      select: {
        status: true,
        deleted_at: true,
        token_version: true,
        memberships: { where: { id: user.companyUserId ?? -1, is_active: true }, select: { id: true } },
      },
    });
    const sessionValid =
      current &&
      current.status === UserStatus.ACTIVE &&
      !current.deleted_at &&
      current.token_version === user.tokenVersion &&
      (!user.companyUserId || current.memberships.length > 0);
    if (!sessionValid) return deny(res, 401, "Session expired. Please login again.");
  } catch (err) {
    console.error("[authMiddleware]", err);
    return deny(res, 500, "Could not verify session");
  }

  req.user = { ...user, permissions: unpackPermissions(user.permissions) };
  next();
};

// Route par permission check: requirePermission("sales.quotations.approve")
export const requirePermission =
  (...codes: string[]) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const user = req.user;
    if (
      user &&
      (user.isSuperAdmin ||
        codes.every((code) => user.permissions.includes(code)))
    )
      return next();
    return deny(res, 403, "You do not have permission for this action");
  };

// Sirf super admin ke liye
export const requireSuperAdmin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  if (req.user?.isSuperAdmin) return next();
  return deny(res, 403, "Super admin only");
};
