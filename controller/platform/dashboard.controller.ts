import { Response } from "express";
import { panel } from "../../lib/globalprimsaclient";
import genrateResponse from "../../lib/generateResponse";
import HttpStatus from "../../lib/httpStatus";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

const MONTHS = 12;

// Super admin dashboard: companies, users, modules ka summary
export const getPlatformDashboard = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const [tenants, users, companies, modules] = await Promise.all([
      panel.tenant.count({ where: { deleted_at: null } }),
      panel.user.count({ where: { deleted_at: null, platform_role_id: null } }),
      panel.company.findMany({
        where: { deleted_at: null },
        select: {
          id: true, name: true, status: true, parent_company_id: true, created_at: true,
          _count: { select: { members: { where: { is_active: true } } } },
        },
      }),
      panel.module.findMany({
        where: { is_active: true, is_platform: false, is_core: false },
        orderBy: { display_order: "asc" },
        select: { name: true, _count: { select: { companies: { where: { is_active: true } } } } },
      }),
    ]);

    // Pichhle 12 mahine: har mahine kitni main aur sub companies bani
    const now = new Date();
    const monthly = Array.from({ length: MONTHS }, (_, i) => {
      const start = new Date(now.getFullYear(), now.getMonth() - (MONTHS - 1 - i), 1);
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      const inMonth = companies.filter((c) => c.created_at >= start && c.created_at < end);
      return {
        month: start.toLocaleString("en-IN", { month: "short", year: "2-digit" }),
        main: inMonth.filter((c) => c.parent_company_id == null).length,
        sub: inMonth.filter((c) => c.parent_company_id != null).length,
      };
    });

    const statusCounts = ["ACTIVE", "TRIAL", "SUSPENDED", "INACTIVE"].map((status) => ({
      status,
      count: companies.filter((c) => c.status === status).length,
    }));

    const topCompanies = companies
      .map((c) => ({ name: c.name, users: c._count.members }))
      .filter((c) => c.users > 0)
      .sort((a, b) => b.users - a.users)
      .slice(0, 8);

    return genrateResponse(res, HttpStatus.OK, "Platform dashboard", {
      totals: {
        tenants,
        companies: companies.filter((c) => c.parent_company_id == null).length,
        subCompanies: companies.filter((c) => c.parent_company_id != null).length,
        users,
      },
      monthly,
      statusCounts,
      topCompanies,
      moduleUsage: modules.map((m) => ({ module: m.name, companies: m._count.companies })),
    });
  } catch (err) {
    console.error("[PlatformDashboard]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to load dashboard");
  }
};
