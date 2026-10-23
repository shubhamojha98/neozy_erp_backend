import { Response } from "express";
import { Prisma } from "../../generated/project/client";
import { lead, project as db } from "../../lib/globalprimsaclient";
import genrateResponse from "../../lib/generateResponse";
import HttpStatus from "../../lib/httpStatus";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { companyUsers, getScope, isCompanyUser, NO_COMPANY, userIdsByName, userNames } from "../../dal/scope.dal";
import { createCustomer, customerCardFilter, customerColumns, customerWhere, findCustomer, findCustomerByPhone } from "../../dal/customer.dal";
import { INDIAN_STATES, INDUSTRY_TYPES, LEAD_SOURCES, PROJECT_TYPES, ROOF_TYPES } from "../../constants/options";
import { dateRangeIST } from "../../utility/istDate";
import { CustomerInput, customerListQuery } from "../../validations/customer.validation";

// Body route par validate() se check hokar aati hai (validations/customer.validation.ts)

// ============================================================
// META — form ke dropdowns
// ============================================================
export const getCustomerMeta = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);

    return genrateResponse(res, HttpStatus.OK, "Customer meta", {
      states: INDIAN_STATES,
      industryTypes: INDUSTRY_TYPES,
      projectTypes: PROJECT_TYPES,
      roofTypes: ROOF_TYPES,
      sources: ["Direct", ...LEAD_SOURCES],
      users: await companyUsers(scope.companyId),
    });
  } catch (err) {
    console.error("[CustomerMeta]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to load form data");
  }
};

// ============================================================
// LIST — search, type, status, assigned, date range, sort, pagination + KPI counts
// ============================================================
export const listCustomers = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);

    const { page, perPage, search, from, to, card, sort, dir } = customerListQuery.parse(req.query);

    // Search: naam, phone, email, company, code ya salesperson ka naam
    const assignedIds = search ? await userIdsByName(scope.companyIds, search) : [];
    const searchFilter: Prisma.CustomerWhereInput = search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { phone: { contains: search } },
            { email: { contains: search, mode: "insensitive" } },
            { companyName: { contains: search, mode: "insensitive" } },
            { customerCode: { contains: search, mode: "insensitive" } },
            ...(assignedIds.length ? [{ assignedTo: { in: assignedIds } }] : []),
          ],
        }
      : {};

    // base = search + date (cards ke number isi par), where = base + chuna hua card
    const base = customerWhere(scope, { createdAt: dateRangeIST(from, to), AND: [searchFilter] });
    const where: Prisma.CustomerWhereInput = card ? { AND: [base, customerCardFilter(card)] } : base;
    const cardCount = (c: Parameters<typeof customerCardFilter>[0]) => db.customer.count({ where: { AND: [base, customerCardFilter(c)] } });

    const [rows, total, all, b2b, b2c, unassigned, noProject, inactive] = await Promise.all([
      db.customer.findMany({
        where,
        orderBy: { [sort]: dir },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true, customerCode: true, type: true, status: true, name: true, companyName: true,
          phone: true, email: true, city: true, source: true, assignedTo: true, createdAt: true, updatedAt: true,
        },
      }),
      db.customer.count({ where }),
      db.customer.count({ where: base }),
      cardCount("B2B"),
      cardCount("B2C"),
      cardCount("UNASSIGNED"),
      cardCount("NO_PROJECT"),
      cardCount("INACTIVE"),
    ]);

    const names = await userNames(rows.map((r) => r.assignedTo));
    return genrateResponse(res, HttpStatus.OK, "Customer list", {
      rows: rows.map((r) => ({ ...r, assignedToName: r.assignedTo ? names.get(r.assignedTo) ?? null : null })),
      total,
      page,
      perPage,
      stats: { total: all, b2b, b2c, unassigned, noProject, inactive },
    });
  } catch (err) {
    console.error("[ListCustomers]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to load customers");
  }
};

// ============================================================
// DETAIL — customer + projects (B2C) / sales orders (B2B) + source lead + pichla / agla
// ============================================================
export const getCustomer = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);

    const row = await db.customer.findFirst({
      where: customerWhere(scope, { id: Number(req.params.id) }),
      include: {
        projects: {
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
          select: { id: true, projectCode: true, stage: true, status: true, capacityKw: true, createdAt: true },
        },
        salesOrders: {
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
          select: { id: true, orderNo: true, stage: true, status: true, contractValue: true, createdAt: true },
        },
      },
    });
    if (!row) return genrateResponse(res, HttpStatus.NotFound, "Customer not found");

    const [names, sourceLead, prev, next] = await Promise.all([
      userNames([row.assignedTo, row.createdBy]),
      row.sourceLeadId ? lead.lead.findUnique({ where: { id: row.sourceLeadId }, select: { id: true, leadNo: true } }) : null,
      db.customer.findFirst({ where: customerWhere(scope, { createdAt: { gt: row.createdAt } }), orderBy: { createdAt: "asc" }, select: { id: true } }),
      db.customer.findFirst({ where: customerWhere(scope, { createdAt: { lt: row.createdAt } }), orderBy: { createdAt: "desc" }, select: { id: true } }),
    ]);

    return genrateResponse(res, HttpStatus.OK, "Customer", {
      ...row,
      assignedToName: row.assignedTo ? names.get(row.assignedTo) ?? null : null,
      createdByName: names.get(row.createdBy) ?? null,
      sourceLead,
      prevId: prev?.id ?? null,
      nextId: next?.id ?? null,
    });
  } catch (err) {
    console.error("[GetCustomer]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to load customer");
  }
};

// ============================================================
// CREATE — body: { type: "B2B" | "B2C", ...fields, assignedTo }
// ============================================================
export const addCustomer = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);

    const input = req.body as CustomerInput;
    if (input.assignedTo && !(await isCompanyUser(scope.companyId, input.assignedTo))) {
      return genrateResponse(res, HttpStatus.BadRequest, "Select a valid user to assign");
    }

    const duplicate = await findCustomerByPhone(scope.companyId, input.phone);
    if (duplicate) {
      return genrateResponse(res, HttpStatus.Conflict, `Customer with this phone already exists (${duplicate.customerCode} - ${duplicate.name})`);
    }

    const customer = await createCustomer({
      companyId: scope.companyId,
      input,
      assignedTo: input.assignedTo,
      source: "Direct",
      createdBy: req.user!.userId,
    });
    return genrateResponse(res, HttpStatus.Created, `${input.type} customer added`, customer);
  } catch (err) {
    console.error("[AddCustomer]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to add customer");
  }
};

// ============================================================
// UPDATE — type nahi badalta; status (Active / Inactive) yahin se
// ============================================================
export const updateCustomer = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const existing = await findCustomer(scope, Number(req.params.id));
    if (!existing) return genrateResponse(res, HttpStatus.NotFound, "Customer not found");

    const input = req.body as CustomerInput;
    if (input.type !== existing.type) return genrateResponse(res, HttpStatus.BadRequest, "Customer type cannot be changed");

    if (input.phone !== existing.phone) {
      const duplicate = await findCustomerByPhone(existing.companyId, input.phone);
      if (duplicate) return genrateResponse(res, HttpStatus.Conflict, `Customer with this phone already exists (${duplicate.customerCode})`);
    }

    const updated = await db.customer.update({
      where: { id: existing.id },
      data: { ...customerColumns(input), status: input.status ?? existing.status },
    });
    return genrateResponse(res, HttpStatus.OK, "Customer updated", updated);
  } catch (err) {
    console.error("[UpdateCustomer]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to update customer");
  }
};

// ============================================================
// ASSIGN — salesperson badlo (null = unassigned)
// ============================================================
export const assignCustomer = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const existing = await findCustomer(scope, Number(req.params.id));
    if (!existing) return genrateResponse(res, HttpStatus.NotFound, "Customer not found");

    const { assignedTo } = req.body as { assignedTo: number | null };
    if (assignedTo && !(await isCompanyUser(existing.companyId, assignedTo))) {
      return genrateResponse(res, HttpStatus.BadRequest, "Select a valid user to assign");
    }

    const updated = await db.customer.update({ where: { id: existing.id }, data: { assignedTo } });
    return genrateResponse(res, HttpStatus.OK, "Customer assigned", updated);
  } catch (err) {
    console.error("[AssignCustomer]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to assign customer");
  }
};

// ============================================================
// DELETE (soft) — /:id ya bulk { ids }. Jinke project / order hain wo skip.
// ============================================================
export const deleteCustomers = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);

    const ids: number[] = req.params.id ? [Number(req.params.id)] : req.body.ids;
    const customers = await db.customer.findMany({
      where: customerWhere(scope, { id: { in: ids } }),
      select: { id: true, _count: { select: { projects: { where: { deletedAt: null } }, salesOrders: { where: { deletedAt: null } } } } },
    });
    const deletable = customers.filter((c) => c._count.projects === 0 && c._count.salesOrders === 0).map((c) => c.id);
    const skipped = customers.length - deletable.length;
    if (!deletable.length) {
      return genrateResponse(res, HttpStatus.BadRequest, skipped ? "Customers with projects or orders cannot be deleted" : "Customer not found");
    }

    await db.customer.updateMany({ where: { id: { in: deletable } }, data: { deletedAt: new Date() } });
    const message = skipped ? `${deletable.length} deleted, ${skipped} skipped (have projects or orders)` : `${deletable.length} customer(s) deleted`;
    return genrateResponse(res, HttpStatus.OK, message, { deleted: deletable.length, skipped });
  } catch (err) {
    console.error("[DeleteCustomers]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to delete customers");
  }
};
