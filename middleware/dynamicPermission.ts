import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "./authMiddleware";

// ================================================================
// GATEWAY — "kya user is module ka hai?"
// /api/lead/... → user ke paas "leads." se shuru hone wali koi bhi permission honi chahiye.
// Action level check (create / edit / approve) route par requirePermission(...) se hota hai.
// ================================================================

// URL ka pehla hissa → module (permission code ka pehla hissa)
const MODULE_BY_PATH: Record<string, string> = {
  panel: "admin",
  dashboard: "dashboard",
  inventory: "inventory",
  project: "projects",
  lead: "leads",
  customer: "sales",
};

// Login ke baad sabke liye khule (ye sirf user ka apna data dete hain)
const OPEN_PATHS = ["/api/panel/master/notifications"];

export const dynamicCheckPermission =
  () => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (user.isSuperAdmin) return next();

    const path = req.originalUrl.split("?")[0];
    if (OPEN_PATHS.some((open) => path === open || path.startsWith(`${open}/`))) return next();

    const module = MODULE_BY_PATH[path.replace(/^\/api\//, "").split("/")[0]];
    if (!module) return next(); // is URL ka koi module nahi (route khud check karega)

    if (user.permissions.some((code) => code.startsWith(`${module}.`))) return next();
    return res.status(403).json({ success: false, message: "You do not have access to this module" });
  };
