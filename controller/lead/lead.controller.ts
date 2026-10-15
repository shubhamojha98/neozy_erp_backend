import { Response } from "express";
import { LeadActivityType, LeadStatus, Prisma } from "../../generated/lead/client";
import { lead as db, project } from "../../lib/globalprimsaclient";
import genrateResponse from "../../lib/generateResponse";
import HttpStatus from "../../lib/httpStatus";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { companyUsers, getScope, isCompanyUser, NO_COMPANY, userIdsByName, userNames } from "../../dal/scope.dal";
import { createLead as createLeadRecord, findLead, leadWhere, OPEN_STATUSES } from "../../dal/lead.dal";
import { createCustomer, findCustomerByPhone } from "../../dal/customer.dal";
import { CONNECTED_OUTCOMES, INDIAN_STATES, LEAD_SOURCES, NOT_CONNECTED_REASONS } from "../../constants/crm";
import { dateRangeIST, startOfTodayIST } from "../../utility/istDate";
import { CallInput, LeadInput, leadListQuery } from "../../validations/lead.validation";
import { CustomerInput } from "../../validations/customer.validation";

// Body route par validate() se check hokar aati hai (validations/lead.validation.ts)

// ============================================================
// META — form ke dropdowns (sources, states, users)
// ============================================================
export const getLeadMeta = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);

    return genrateResponse(res, HttpStatus.OK, "Lead meta", {
      sources: LEAD_SOURCES,
      states: INDIAN_STATES,
      connectedOutcomes: Object.keys(CONNECTED_OUTCOMES),
      notConnectedReasons: NOT_CONNECTED_REASONS,
      users: await companyUsers(scope.companyId),
    });
  } catch (err) {
    console.error("[LeadMeta]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to load form data");
  }
};

// ============================================================
// LIST — card (status), search, date range, pagination + KPI counts
// ============================================================
export const listLeads = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);

    const { page, perPage, search, from, to, card } = leadListQuery.parse(req.query);
    const today = startOfTodayIST();

    // Search: naam, phone, city, email, lead no ya salesperson ka naam
    const assignedIds = search ? await userIdsByName(scope.companyIds, search) : [];
    const searchFilter: Prisma.LeadWhereInput = search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { phone: { contains: search } },
            { city: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { leadNo: { contains: search, mode: "insensitive" } },
            ...(assignedIds.length ? [{ assignedTo: { in: assignedIds } }] : []),
          ],
        }
      : {};

    // base = search + date (cards ke number isi par), where = base + chuna hua card
    const base = leadWhere(scope, { createdAt: dateRangeIST(from, to), AND: [searchFilter] });
    const where: Prisma.LeadWhereInput = card ? { AND: [base, { status: card }] } : base;

    const [rows, total, byStatus] = await Promise.all([
      db.lead.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true, leadNo: true, name: true, phone: true, city: true, source: true,
          status: true, assignedTo: true, nextFollowupDate: true, createdAt: true,
        },
      }),
      db.lead.count({ where }),
      db.lead.groupBy({ by: ["status"], where: base, _count: true }),
    ]);

    const names = await userNames(rows.map((r) => r.assignedTo));
    const count = (s: LeadStatus) => byStatus.find((b) => b.status === s)?._count ?? 0;

    return genrateResponse(res, HttpStatus.OK, "Lead list", {
      rows: rows.map((r) => ({
        ...r,
        assignedToName: r.assignedTo ? names.get(r.assignedTo) ?? null : null,
        overdue: !!r.nextFollowupDate && r.nextFollowupDate < today && OPEN_STATUSES.includes(r.status),
      })),
      total,
      page,
      perPage,
      stats: {
        total: byStatus.reduce((sum, b) => sum + b._count, 0),
        new: count(LeadStatus.NEW),
        followUp: count(LeadStatus.FOLLOW_UP),
        converted: count(LeadStatus.CONVERTED),
        lost: count(LeadStatus.LOST),
      },
    });
  } catch (err) {
    console.error("[ListLeads]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to load leads");
  }
};

// ============================================================
// DETAIL — lead + timeline + pichla / agla lead (workspace footer)
// ============================================================
export const getLead = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);

    const row = await db.lead.findFirst({
      where: leadWhere(scope, { id: Number(req.params.id) }),
      include: { activities: { orderBy: { createdAt: "desc" }, take: 100 } },
    });
    if (!row) return genrateResponse(res, HttpStatus.NotFound, "Lead not found");

    const [prev, next, names] = await Promise.all([
      db.lead.findFirst({ where: leadWhere(scope, { createdAt: { gt: row.createdAt } }), orderBy: { createdAt: "asc" }, select: { id: true } }),
      db.lead.findFirst({ where: leadWhere(scope, { createdAt: { lt: row.createdAt } }), orderBy: { createdAt: "desc" }, select: { id: true } }),
      userNames([row.assignedTo, row.createdBy, ...row.activities.map((a) => a.createdBy)]),
    ]);

    return genrateResponse(res, HttpStatus.OK, "Lead", {
      ...row,
      assignedToName: row.assignedTo ? names.get(row.assignedTo) ?? null : null,
      createdByName: names.get(row.createdBy) ?? null,
      activities: row.activities.map((a) => ({ ...a, createdByName: names.get(a.createdBy) ?? null })),
      prevId: prev?.id ?? null,
      nextId: next?.id ?? null,
    });
  } catch (err) {
    console.error("[GetLead]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to load lead");
  }
};

// ============================================================
// CREATE
// ============================================================
export const createLead = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);

    const { assignedTo, ...data } = req.body as LeadInput;
    if (assignedTo && !(await isCompanyUser(scope.companyId, assignedTo))) {
      return genrateResponse(res, HttpStatus.BadRequest, "Select a valid user to assign");
    }

    const duplicate = await db.lead.findFirst({ where: { companyId: scope.companyId, phone: data.phone, deletedAt: null }, select: { leadNo: true } });
    if (duplicate) return genrateResponse(res, HttpStatus.Conflict, `A lead with this phone already exists (${duplicate.leadNo})`);

    const created = await createLeadRecord({
      ...data,
      companyId: scope.companyId,
      status: data.nextFollowupDate ? LeadStatus.FOLLOW_UP : LeadStatus.NEW,
      assignedTo,
      createdBy: req.user!.userId,
    });
    return genrateResponse(res, HttpStatus.Created, "Lead added", created);
  } catch (err) {
    console.error("[CreateLead]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to add lead");
  }
};

// ============================================================
// UPDATE — lead information (status aur assign yahan se nahi badalte)
// ============================================================
export const updateLead = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const existing = await findLead(scope, Number(req.params.id));
    if (!existing) return genrateResponse(res, HttpStatus.NotFound, "Lead not found");

    const { assignedTo, ...data } = req.body as LeadInput;
    const updated = await db.lead.update({ where: { id: existing.id }, data });
    return genrateResponse(res, HttpStatus.OK, "Lead updated", updated);
  } catch (err) {
    console.error("[UpdateLead]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to update lead");
  }
};

// ============================================================
// DELETE (soft) — converted lead delete nahi hota
// ============================================================
export const deleteLead = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const existing = await findLead(scope, Number(req.params.id));
    if (!existing) return genrateResponse(res, HttpStatus.NotFound, "Lead not found");
    if (existing.status === LeadStatus.CONVERTED) return genrateResponse(res, HttpStatus.BadRequest, "Converted leads cannot be deleted");

    await db.lead.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
    return genrateResponse(res, HttpStatus.OK, "Lead deleted");
  } catch (err) {
    console.error("[DeleteLead]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to delete lead");
  }
};

// ============================================================
// CALL LOG — outcome se status apne aap badalta hai (constants/crm.ts)
// ============================================================
export const logCall = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const existing = await findLead(scope, Number(req.params.id));
    if (!existing) return genrateResponse(res, HttpStatus.NotFound, "Lead not found");
    if (existing.status === LeadStatus.CONVERTED) return genrateResponse(res, HttpStatus.BadRequest, "Lead is already converted");

    const { connected, outcome, remarks, nextFollowupDate } = req.body as CallInput;

    // Naya status: connected → outcome ke hisaab se; not connected → retry date ho to Follow-up, "Invalid Number" → Lost
    let status = existing.status;
    if (connected) status = CONNECTED_OUTCOMES[outcome];
    else if (outcome === "Invalid Number") status = LeadStatus.LOST;
    else if (nextFollowupDate) status = LeadStatus.FOLLOW_UP;

    const lost = status === LeadStatus.LOST;
    const [updated] = await db.$transaction([
      db.lead.update({
        where: { id: existing.id },
        data: {
          status,
          lostReason: lost ? outcome : null,
          lastContactedAt: new Date(),
          nextFollowupDate: lost ? null : nextFollowupDate ?? existing.nextFollowupDate,
        },
      }),
      db.leadActivity.create({
        data: { leadId: existing.id, type: LeadActivityType.CALL, connected, outcome, remarks, nextFollowupDate, createdBy: req.user!.userId },
      }),
    ]);
    return genrateResponse(res, HttpStatus.OK, "Call logged", updated);
  } catch (err) {
    console.error("[LogCall]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to log call");
  }
};

// ============================================================
// NOTE
// ============================================================
export const addNote = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const existing = await findLead(scope, Number(req.params.id));
    if (!existing) return genrateResponse(res, HttpStatus.NotFound, "Lead not found");

    const note = await db.leadActivity.create({
      data: { leadId: existing.id, type: LeadActivityType.NOTE, remarks: req.body.remarks, createdBy: req.user!.userId },
    });
    return genrateResponse(res, HttpStatus.Created, "Note added", note);
  } catch (err) {
    console.error("[AddNote]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to add note");
  }
};

// ============================================================
// TRANSFER — dusre user ko assign
// ============================================================
export const assignLead = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const existing = await findLead(scope, Number(req.params.id));
    if (!existing) return genrateResponse(res, HttpStatus.NotFound, "Lead not found");

    const { assignedTo, remarks } = req.body as { assignedTo: number; remarks: string | null };
    if (!(await isCompanyUser(existing.companyId, assignedTo))) {
      return genrateResponse(res, HttpStatus.BadRequest, "Select a valid user to assign");
    }

    const names = await userNames([assignedTo]);
    const [updated] = await db.$transaction([
      db.lead.update({ where: { id: existing.id }, data: { assignedTo } }),
      db.leadActivity.create({
        data: { leadId: existing.id, type: LeadActivityType.ASSIGN, outcome: names.get(assignedTo) ?? null, remarks, createdBy: req.user!.userId },
      }),
    ]);
    return genrateResponse(res, HttpStatus.OK, "Lead transferred", updated);
  } catch (err) {
    console.error("[AssignLead]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to transfer lead");
  }
};

// ============================================================
// MARK LOST
// ============================================================
export const markLost = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const existing = await findLead(scope, Number(req.params.id));
    if (!existing) return genrateResponse(res, HttpStatus.NotFound, "Lead not found");
    if (existing.status === LeadStatus.CONVERTED) return genrateResponse(res, HttpStatus.BadRequest, "Lead is already converted");

    const { reason } = req.body as { reason: string };
    const [updated] = await db.$transaction([
      db.lead.update({ where: { id: existing.id }, data: { status: LeadStatus.LOST, lostReason: reason, nextFollowupDate: null } }),
      db.leadActivity.create({
        data: { leadId: existing.id, type: LeadActivityType.STATUS, outcome: "Lost", remarks: reason, createdBy: req.user!.userId },
      }),
    ]);
    return genrateResponse(res, HttpStatus.OK, "Lead marked as lost", updated);
  } catch (err) {
    console.error("[MarkLost]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to update lead");
  }
};

// ============================================================
// CONVERT — lead se B2B / B2C customer (body = customer form)
// ============================================================
export const convertLead = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const existing = await findLead(scope, Number(req.params.id));
    if (!existing) return genrateResponse(res, HttpStatus.NotFound, "Lead not found");
    if (existing.status === LeadStatus.CONVERTED) return genrateResponse(res, HttpStatus.BadRequest, "Lead is already converted");

    const input = req.body as CustomerInput;
    const assignedTo = input.assignedTo ?? existing.assignedTo;
    if (assignedTo && !(await isCompanyUser(existing.companyId, assignedTo))) {
      return genrateResponse(res, HttpStatus.BadRequest, "Select a valid user to assign");
    }

    const duplicate = await findCustomerByPhone(existing.companyId, input.phone);
    if (duplicate) {
      return genrateResponse(res, HttpStatus.Conflict, `Customer with this phone already exists (${duplicate.customerCode} - ${duplicate.name})`);
    }

    const customer = await createCustomer({
      companyId: existing.companyId,
      input,
      assignedTo,
      source: existing.source,
      sourceLeadId: existing.id,
      createdBy: req.user!.userId,
    });

    // Lead DB alag hai — lead update fail ho to bana hua customer wapas hata do
    try {
      await db.$transaction([
        db.lead.update({
          where: { id: existing.id },
          data: { status: LeadStatus.CONVERTED, convertedCustomerId: customer.id, convertedAt: new Date(), nextFollowupDate: null },
        }),
        db.leadActivity.create({
          data: { leadId: existing.id, type: LeadActivityType.CONVERT, outcome: `${input.type} · ${customer.customerCode}`, createdBy: req.user!.userId },
        }),
      ]);
    } catch (err) {
      await project.customer.delete({ where: { id: customer.id } });
      throw err;
    }

    // Lead ke documents ab customer ke bhi (wahi record, copy nahi)
    await project.document.updateMany({ where: { companyId: existing.companyId, leadId: existing.id }, data: { customerId: customer.id } });

    return genrateResponse(res, HttpStatus.Created, `Converted to ${input.type} customer`, {
      customerId: customer.id,
      customerCode: customer.customerCode,
    });
  } catch (err) {
    console.error("[ConvertLead]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to convert lead");
  }
};
