import { LeadStatus, Prisma } from "../generated/lead/client";
import { lead as db } from "../lib/globalprimsaclient";
import { nextCode } from "../utility/codeGenerator";
import type { Scope } from "./scope.dal";

// Ye status "khule" hain — inka follow-up nikal jaye to overdue
export const OPEN_STATUSES: LeadStatus[] = [LeadStatus.NEW, LeadStatus.FOLLOW_UP, LeadStatus.QUALIFIED];

// Scope ke andar wale leads (SELF / TEAM: jo assign hain ya khud banaye)
export const leadWhere = (scope: Scope, extra: Prisma.LeadWhereInput = {}): Prisma.LeadWhereInput => ({
  companyId: { in: scope.companyIds },
  deletedAt: null,
  ...(scope.userIds && { OR: [{ assignedTo: { in: scope.userIds } }, { createdBy: { in: scope.userIds } }] }),
  ...extra,
});

export const findLead = (scope: Scope, id: number) => db.lead.findFirst({ where: leadWhere(scope, { id }) });

// Naya lead — number LD000001 (do request ek saath aayein to unique error par dobara try)
export async function createLead(data: Omit<Prisma.LeadUncheckedCreateInput, "leadNo">) {
  for (let attempt = 0; ; attempt++) {
    const last = await db.lead.findFirst({ where: { companyId: data.companyId }, orderBy: { id: "desc" }, select: { leadNo: true } });
    try {
      return await db.lead.create({ data: { ...data, leadNo: nextCode("LD", last?.leadNo) } });
    } catch (err) {
      const duplicateCode = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (!duplicateCode || attempt >= 2) throw err;
    }
  }
}
