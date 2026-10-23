import { Prisma } from "../generated/project/client";
import { project as db } from "../lib/globalprimsaclient";
import { findLead } from "./lead.dal";
import { findCustomer } from "./customer.dal";
import { findProject } from "./project.dal";
import type { Scope } from "./scope.dal";

export type DocumentEntity = "lead" | "customer" | "project";

// Document kiska hai — lead / customer scope me ho tabhi (dusre ka record → null)
// Lead convert ho chuka ho to customerId bhi, customer lead se bana ho to leadId bhi — dono jagah wahi file
export async function documentOwner(scope: Scope, entity: DocumentEntity, id: number) {
  if (entity === "lead") {
    const lead = await findLead(scope, id);
    return lead && { companyId: lead.companyId, leadId: lead.id, customerId: lead.convertedCustomerId };
  }
  if (entity === "project") {
    // Project ki file customer me bhi dikhti hai (customerId), lead me nahi
    const project = await findProject(scope, id);
    return project && { companyId: project.companyId, leadId: null, customerId: project.customerId, projectId: project.id };
  }
  const customer = await findCustomer(scope, id);
  return customer && { companyId: customer.companyId, leadId: customer.sourceLeadId, customerId: customer.id };
}

// Is lead / customer ke documents ka filter
type Owner = { companyId: number; leadId: number | null; customerId: number | null; projectId?: number };

const ENTITY_FILTER = {
  lead: (owner: Owner) => ({ leadId: owner.leadId }),
  customer: (owner: Owner) => ({ customerId: owner.customerId }),
  project: (owner: Owner) => ({ projectId: owner.projectId }),
};

export const documentWhere = (entity: DocumentEntity, owner: Owner, extra: Prisma.DocumentWhereInput = {}): Prisma.DocumentWhereInput => ({
  companyId: owner.companyId,
  deletedAt: null,
  ...ENTITY_FILTER[entity](owner),
  ...extra,
});

export const listDocumentsOf = (where: Prisma.DocumentWhereInput) =>
  db.document.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: { id: true, category: true, fileName: true, mimeType: true, size: true, uploadedBy: true, createdAt: true },
  });
