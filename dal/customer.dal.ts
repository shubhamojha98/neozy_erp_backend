import { Prisma } from "../generated/project/client";
import { project } from "../lib/globalprimsaclient";
import { nextCode } from "../utility/codeGenerator";
import type { CustomerInput } from "../validations/customer.validation";
import type { Scope } from "./scope.dal";

// Scope ke andar wale customers (SELF / TEAM: jo assign hain ya khud banaye)
export const customerWhere = (scope: Scope, extra: Prisma.CustomerWhereInput = {}): Prisma.CustomerWhereInput => ({
  companyId: { in: scope.companyIds },
  deletedAt: null,
  ...(scope.userIds && { OR: [{ assignedTo: { in: scope.userIds } }, { createdBy: { in: scope.userIds } }] }),
  ...extra,
});

export const findCustomer = (scope: Scope, id: number) => project.customer.findFirst({ where: customerWhere(scope, { id }) });

// Validated form → customer table ke columns (type / assignedTo / status alag se set hote hain)
export function customerColumns(input: CustomerInput) {
  const { type, assignedTo, status, ...columns } = input;
  return columns;
}

// Same company me isi phone ka customer pehle se hai?
export const findCustomerByPhone = (companyId: number, phone: string) =>
  project.customer.findFirst({ where: { companyId, phone, deletedAt: null }, select: { id: true, customerCode: true, name: true } });

// Naya customer — code CUS000001 (do request ek saath aayein to unique error par dobara try)
export async function createCustomer(data: {
  companyId: number;
  input: CustomerInput;
  assignedTo: number | null;
  source: string;
  sourceLeadId?: number;
  createdBy: number;
}) {
  for (let attempt = 0; ; attempt++) {
    const last = await project.customer.findFirst({
      where: { companyId: data.companyId },
      orderBy: { id: "desc" },
      select: { customerCode: true },
    });
    try {
      return await project.customer.create({
        data: {
          ...customerColumns(data.input),
          companyId: data.companyId,
          customerCode: nextCode("CUS", last?.customerCode),
          type: data.input.type,
          assignedTo: data.assignedTo,
          source: data.source,
          sourceLeadId: data.sourceLeadId ?? null,
          createdBy: data.createdBy,
        },
      });
    } catch (err) {
      const duplicateCode = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (!duplicateCode || attempt >= 2) throw err;
    }
  }
}
