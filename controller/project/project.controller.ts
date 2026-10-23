import { Response } from "express";
import { CustomerStatus, CustomerType, Prisma, ProjectActivityType, ProjectStage, ProjectStatus } from "../../generated/project/client";
import { project as db } from "../../lib/globalprimsaclient";
import genrateResponse from "../../lib/generateResponse";
import HttpStatus from "../../lib/httpStatus";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { companyUsers, getScope, isCompanyUser, NO_COMPANY, userIdsByName, userNames } from "../../dal/scope.dal";
import { panel } from "../../lib/globalprimsaclient";
import { customerWhere } from "../../dal/customer.dal";
import { activity, createProjectRecord, findProject, projectCardFilter, projectWhere, STAGE_ORDER } from "../../dal/project.dal";
import { GST_RATES, INDIAN_STATES, ORDER_MIN_PERCENT, METER_PHASES, PROJECT_TYPES, QC_CHECKLIST, REGISTRATION_PORTALS, ROOF_TYPES, STRUCTURE_TYPES, SUBSIDY_SCHEMES } from "../../constants/options";
import { dateRangeIST } from "../../utility/istDate";
import { CreateProjectInput, ProjectInput, projectListQuery } from "../../validations/project.validation";

// Body route par validate() se check hokar aati hai (validations/project.validation.ts)

// ============================================================
// META — form ke dropdowns
// ============================================================
export const getProjectMeta = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);

    return genrateResponse(res, HttpStatus.OK, "Project meta", {
      projectTypes: PROJECT_TYPES,
      states: INDIAN_STATES,
      roofTypes: ROOF_TYPES,
      meterPhases: METER_PHASES,
      structureTypes: STRUCTURE_TYPES,
      stages: STAGE_ORDER,
      registrationPortals: REGISTRATION_PORTALS,
      gstRates: GST_RATES,
      orderMinPercent: ORDER_MIN_PERCENT,
      qcChecklist: QC_CHECKLIST,
      subsidySchemes: SUBSIDY_SCHEMES,
      users: await companyUsers(scope.companyId),
    });
  } catch (err) {
    console.error("[ProjectMeta]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to load form data");
  }
};

// ============================================================
// LIST — card, search (code / customer / salesperson), date, pagination + KPI counts
// ============================================================
export const listProjects = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);

    const { page, perPage, search, from, to, card, customerId } = projectListQuery.parse(req.query);

    const assignedIds = search ? await userIdsByName(scope.companyIds, search) : [];
    const searchFilter: Prisma.ProjectWhereInput = search
      ? {
          OR: [
            { projectCode: { contains: search, mode: "insensitive" } },
            { city: { contains: search, mode: "insensitive" } },
            { customer: { name: { contains: search, mode: "insensitive" } } },
            { customer: { phone: { contains: search } } },
            ...(assignedIds.length ? [{ assignedTo: { in: assignedIds } }] : []),
          ],
        }
      : {};

    // base = search + date (cards ke number isi par), where = base + chuna hua card
    const base = projectWhere(scope, { createdAt: dateRangeIST(from, to), customerId, AND: [searchFilter] });
    const where: Prisma.ProjectWhereInput = card ? { AND: [base, projectCardFilter(card)] } : base;
    const cardCount = (c: Parameters<typeof projectCardFilter>[0]) => db.project.count({ where: { AND: [base, projectCardFilter(c)] } });

    const [rows, total, all, surveyDesign, sales, execution, postInstall, completed] = await Promise.all([
      db.project.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true, projectCode: true, capacityKw: true, projectType: true, stage: true, status: true, paymentMode: true,
          city: true, assignedTo: true, createdAt: true, updatedAt: true,
          customer: { select: { id: true, name: true, phone: true, customerCode: true } },
        },
      }),
      db.project.count({ where }),
      db.project.count({ where: base }),
      cardCount("SURVEY_DESIGN"),
      cardCount("SALES"),
      cardCount("EXECUTION"),
      cardCount("POST_INSTALL"),
      cardCount("COMPLETED"),
    ]);

    const names = await userNames(rows.map((r) => r.assignedTo));
    return genrateResponse(res, HttpStatus.OK, "Project list", {
      rows: rows.map((r) => ({ ...r, assignedToName: r.assignedTo ? names.get(r.assignedTo) ?? null : null })),
      total,
      page,
      perPage,
      stats: { total: all, surveyDesign, sales, execution, postInstall, completed },
    });
  } catch (err) {
    console.error("[ListProjects]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to load projects");
  }
};

// ============================================================
// DETAIL — project + customer + survey + engineering + timeline + pichla / agla
// ============================================================
export const getProject = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);

    const row = await db.project.findFirst({
      where: projectWhere(scope, { id: Number(req.params.id) }),
      include: {
        customer: { select: { id: true, customerCode: true, name: true, phone: true, email: true, sanctionLoadKw: true, consumerNumber: true, monthlyBill: true } },
        surveys: { orderBy: { createdAt: "desc" } },
        engineering: true,
        quotations: { orderBy: { createdAt: "desc" }, include: { items: { orderBy: { sortOrder: "asc" } } } },
        loan: true,
        registration: true,
        invoice: true,
        payments: { where: { deletedAt: null }, orderBy: { paidOn: "desc" } },
        order: true,
        dispatch: true,
        serials: { orderBy: { createdAt: "asc" } },
        installation: true,
        qualityChecks: { orderBy: { checkedAt: "desc" } },
        commissioning: true,
        netMetering: true,
        subsidy: true,
        handover: true,
        activities: { orderBy: { createdAt: "desc" }, take: 100 },
      },
    });
    if (!row) return genrateResponse(res, HttpStatus.NotFound, "Project not found");

    const [names, prev, next, company] = await Promise.all([
      userNames([
        row.assignedTo, row.surveyorId, row.installerId, row.createdBy, row.engineering?.approvedBy,
        ...row.surveys.flatMap((s) => [s.surveyorId, s.completedBy]),
        ...row.activities.map((a) => a.createdBy),
        ...row.payments.map((p) => p.createdBy),
        row.installation?.installerId,
        ...row.qualityChecks.map((q) => q.checkedBy),
      ]),
      db.project.findFirst({ where: projectWhere(scope, { createdAt: { gt: row.createdAt } }), orderBy: { createdAt: "asc" }, select: { id: true } }),
      db.project.findFirst({ where: projectWhere(scope, { createdAt: { lt: row.createdAt } }), orderBy: { createdAt: "desc" }, select: { id: true } }),
      // Quotation / Invoice PDF ke header ke liye
      panel.company.findUnique({
        where: { id: row.companyId },
        select: { name: true, legal_name: true, address: true, city: true, state: true, pincode: true, gstin: true, phone: true, email: true },
      }),
    ]);
    const name = (id: number | null | undefined) => (id ? names.get(id) ?? null : null);

    return genrateResponse(res, HttpStatus.OK, "Project", {
      ...row,
      assignedToName: name(row.assignedTo),
      surveyorName: name(row.surveyorId),
      installerName: name(row.installerId),
      createdByName: name(row.createdBy),
      surveys: row.surveys.map((s) => ({ ...s, surveyorName: name(s.surveyorId), completedByName: name(s.completedBy) })),
      engineering: row.engineering && { ...row.engineering, approvedByName: name(row.engineering.approvedBy) },
      activities: row.activities.map((a) => ({ ...a, createdByName: name(a.createdBy) })),
      payments: row.payments.map((p) => ({ ...p, createdByName: name(p.createdBy) })),
      paid: row.payments.reduce((sum, p) => sum + Number(p.amount), 0),
      installation: row.installation && { ...row.installation, installerName: name(row.installation.installerId) },
      qualityChecks: row.qualityChecks.map((q) => ({ ...q, checkedByName: name(q.checkedBy) })),
      company,
      prevId: prev?.id ?? null,
      nextId: next?.id ?? null,
    });
  } catch (err) {
    console.error("[GetProject]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to load project");
  }
};

// ============================================================
// CREATE — sirf active B2C customer ka. Stage SURVEY se shuru.
// ============================================================
export const createProject = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);

    const { customerId, ...input } = req.body as CreateProjectInput;
    const customer = await db.customer.findFirst({ where: customerWhere(scope, { id: customerId }) });
    if (!customer) return genrateResponse(res, HttpStatus.NotFound, "Customer not found");
    if (customer.type !== CustomerType.B2C) return genrateResponse(res, HttpStatus.BadRequest, "Projects are only for B2C customers");
    if (customer.status !== CustomerStatus.ACTIVE) return genrateResponse(res, HttpStatus.BadRequest, "Customer is inactive");

    if (input.assignedTo && !(await isCompanyUser(customer.companyId, input.assignedTo))) {
      return genrateResponse(res, HttpStatus.BadRequest, "Select a valid user to assign");
    }

    const project = await createProjectRecord({
      ...input,
      companyId: customer.companyId,
      customerId: customer.id,
      assignedTo: input.assignedTo ?? customer.assignedTo,
      createdBy: req.user!.userId,
    });
    await activity(project.id, ProjectActivityType.CREATED, `Project created · ${input.capacityKw} kW ${input.projectType}`, req.user!.userId);

    return genrateResponse(res, HttpStatus.Created, "Project created", project);
  } catch (err) {
    console.error("[CreateProject]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to create project");
  }
};

// ============================================================
// UPDATE — capacity, type, owner, site address, notes
// ============================================================
export const updateProject = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const existing = await findProject(scope, Number(req.params.id));
    if (!existing) return genrateResponse(res, HttpStatus.NotFound, "Project not found");

    const input = req.body as ProjectInput;
    if (input.assignedTo && !(await isCompanyUser(existing.companyId, input.assignedTo))) {
      return genrateResponse(res, HttpStatus.BadRequest, "Select a valid user to assign");
    }

    const updated = await db.project.update({ where: { id: existing.id }, data: input });
    await activity(existing.id, ProjectActivityType.UPDATED, "Project details updated", req.user!.userId);
    return genrateResponse(res, HttpStatus.OK, "Project updated", updated);
  } catch (err) {
    console.error("[UpdateProject]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to update project");
  }
};

// ============================================================
// STATUS — Hold / Resume / Cancel (Completed sirf Handover se hoga)
// ============================================================
const STATUS_TEXT: Record<string, string> = { ACTIVE: "Project resumed", ON_HOLD: "Project put on hold", CANCELLED: "Project cancelled" };

export const setProjectStatus = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const existing = await findProject(scope, Number(req.params.id));
    if (!existing) return genrateResponse(res, HttpStatus.NotFound, "Project not found");

    const { status, reason } = req.body as { status: ProjectStatus; reason: string | null };
    if (existing.status === ProjectStatus.COMPLETED || existing.status === ProjectStatus.CANCELLED) {
      return genrateResponse(res, HttpStatus.BadRequest, "This project is already closed");
    }
    if (status === existing.status) return genrateResponse(res, HttpStatus.BadRequest, "Project already has this status");
    if (status !== ProjectStatus.ACTIVE && !reason) return genrateResponse(res, HttpStatus.BadRequest, "Reason is required");

    await db.$transaction([
      db.project.update({ where: { id: existing.id }, data: { status } }),
      db.projectActivity.create({
        data: { projectId: existing.id, type: ProjectActivityType.UPDATED, message: reason ? `${STATUS_TEXT[status]} · ${reason}` : STATUS_TEXT[status], createdBy: req.user!.userId },
      }),
    ]);
    return genrateResponse(res, HttpStatus.OK, STATUS_TEXT[status]);
  } catch (err) {
    console.error("[ProjectStatus]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to update status");
  }
};

// ============================================================
// NOTE — timeline me
// ============================================================
export const addProjectNote = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const existing = await findProject(scope, Number(req.params.id));
    if (!existing) return genrateResponse(res, HttpStatus.NotFound, "Project not found");

    const note = await activity(existing.id, ProjectActivityType.NOTE, req.body.message, req.user!.userId);
    return genrateResponse(res, HttpStatus.Created, "Note added", note);
  } catch (err) {
    console.error("[ProjectNote]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to add note");
  }
};

// ============================================================
// DELETE (soft) — sirf Survey stage par, survey complete hone se pehle
// ============================================================
export const deleteProject = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const existing = await findProject(scope, Number(req.params.id));
    if (!existing) return genrateResponse(res, HttpStatus.NotFound, "Project not found");
    if (existing.stage !== ProjectStage.SURVEY) {
      return genrateResponse(res, HttpStatus.BadRequest, "Only projects in Survey stage can be deleted — cancel it instead");
    }

    await db.project.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
    return genrateResponse(res, HttpStatus.OK, "Project deleted");
  } catch (err) {
    console.error("[DeleteProject]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to delete project");
  }
};
