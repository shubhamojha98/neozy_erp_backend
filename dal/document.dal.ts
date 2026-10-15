import { Prisma } from "../generated/project/client";
import { project as db } from "../lib/globalprimsaclient";
import { findLead } from "./lead.dal";
import { findCustomer } from "./customer.dal";
import type { Scope } from "./scope.dal";

export type DocumentEntity = "lead" | "customer";

// Document kiska hai — lead / customer scope me ho tabhi (dusre ka record → null)
// Lead convert ho chuka ho to customerId bhi, customer lead se bana ho to leadId bhi — dono jagah wahi file
export async function documentOwner(scope: Scope, entity: DocumentEntity, id: number) {
  if (entity === "lead") {
    const lead = await findLead(scope, id);
    return lead && { companyId: lead.companyId, leadId: lead.id, customerId: lead.convertedCustomerId };
  }
  const customer = await findCustomer(scope, id);
  return customer && { companyId: customer.companyId, leadId: customer.sourceLeadId, customerId: customer.id };
}

// Is lead / customer ke documents ka filter
export const documentWhere = (entity: DocumentEntity, owner: { companyId: number; leadId: number | null; customerId: number | null }, extra: Prisma.DocumentWhereInput = {}): Prisma.DocumentWhereInput => ({
  companyId: owner.companyId,
  deletedAt: null,
  ...(entity === "lead" ? { leadId: owner.leadId } : { customerId: owner.customerId }),
  ...extra,
});

export const listDocumentsOf = (where: Prisma.DocumentWhereInput) =>
  db.document.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: { id: true, category: true, fileName: true, mimeType: true, size: true, uploadedBy: true, createdAt: true },
  });
