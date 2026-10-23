import { Response } from "express";
import { CustomerStatus, CustomerType, Prisma, ProjectActivityType, SalesOrderStage, SalesOrderStatus } from "../../generated/project/client";
import { panel, project as db } from "../../lib/globalprimsaclient";
import genrateResponse from "../../lib/generateResponse";
import HttpStatus from "../../lib/httpStatus";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { companyUsers, getScope, isCompanyUser, NO_COMPANY, userIdsByName, userNames } from "../../dal/scope.dal";
import { customerWhere } from "../../dal/customer.dal";
import { createWithCode } from "../../dal/project.dal";
import { findSalesOrder, orderActivity, salesOrderCardFilter, salesOrderWhere } from "../../dal/sales-order.dal";
import { GST_RATES } from "../../constants/options";
import { dateRangeIST } from "../../utility/istDate";
import { CreateSalesOrderInput, salesOrderListQuery } from "../../validations/sales-order.validation";

// B2B Sales Order: list, detail, create, note, cancel. Stage ke kaam order-flow.controller.ts me.

export const getSalesOrderMeta = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    return genrateResponse(res, HttpStatus.OK, "Sales order meta", { gstRates: GST_RATES, users: await companyUsers(scope.companyId) });
  } catch (err) {
    console.error("[SalesOrderMeta]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to load form data");
  }
};

// ============================================================
// LIST — card, search (order no / customer / company / salesperson), date + KPI counts
// ============================================================
export const listSalesOrders = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const { page, perPage, search, from, to, card } = salesOrderListQuery.parse(req.query);

    const assignedIds = search ? await userIdsByName(scope.companyIds, search) : [];
    const searchFilter: Prisma.SalesOrderWhereInput = search
      ? {
          OR: [
            { orderNo: { contains: search, mode: "insensitive" } },
            { customer: { name: { contains: search, mode: "insensitive" } } },
            { customer: { companyName: { contains: search, mode: "insensitive" } } },
            { customer: { phone: { contains: search } } },
            ...(assignedIds.length ? [{ assignedTo: { in: assignedIds } }] : []),
          ],
        }
      : {};

    const base = salesOrderWhere(scope, { createdAt: dateRangeIST(from, to), AND: [searchFilter] });
    const where: Prisma.SalesOrderWhereInput = card ? { AND: [base, salesOrderCardFilter(card)] } : base;
    const cardCount = (c: Parameters<typeof salesOrderCardFilter>[0]) => db.salesOrder.count({ where: { AND: [base, salesOrderCardFilter(c)] } });

    const [rows, total, all, quotation, invoice, order, dispatch, closed] = await Promise.all([
      db.salesOrder.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true, orderNo: true, stage: true, status: true, contractValue: true, assignedTo: true, createdAt: true,
          customer: { select: { id: true, name: true, companyName: true, phone: true, customerCode: true } },
          payments: { where: { deletedAt: null }, select: { amount: true } },
        },
      }),
      db.salesOrder.count({ where }),
      db.salesOrder.count({ where: base }),
      cardCount("QUOTATION"),
      cardCount("INVOICE"),
      cardCount("ORDER"),
      cardCount("DISPATCH"),
      cardCount("CLOSED"),
    ]);

    const names = await userNames(rows.map((r) => r.assignedTo));
    return genrateResponse(res, HttpStatus.OK, "Sales orders", {
      rows: rows.map(({ payments, ...r }) => ({
        ...r,
        paid: payments.reduce((sum, p) => sum + Number(p.amount), 0),
        assignedToName: r.assignedTo ? names.get(r.assignedTo) ?? null : null,
      })),
      total,
      page,
      perPage,
      stats: { total: all, quotation, invoice, order, dispatch, closed },
    });
  } catch (err) {
    console.error("[ListSalesOrders]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to load sales orders");
  }
};

// ============================================================
// DETAIL — order + customer + quotations + invoice + payments + dispatch + timeline
// ============================================================
export const getSalesOrder = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);

    const row = await db.salesOrder.findFirst({
      where: salesOrderWhere(scope, { id: Number(req.params.id) }),
      include: {
        customer: { select: { id: true, customerCode: true, name: true, companyName: true, phone: true, email: true, gstin: true, address: true, city: true, state: true, pincode: true } },
        quotations: { orderBy: { createdAt: "desc" }, include: { items: { orderBy: { sortOrder: "asc" } } } },
        invoice: true,
        payments: { where: { deletedAt: null }, orderBy: { paidOn: "desc" } },
        dispatch: true,
        activities: { orderBy: { createdAt: "desc" }, take: 100 },
      },
    });
    if (!row) return genrateResponse(res, HttpStatus.NotFound, "Sales order not found");

    const [names, prev, next, company] = await Promise.all([
      userNames([row.assignedTo, row.createdBy, ...row.activities.map((a) => a.createdBy), ...row.payments.map((p) => p.createdBy)]),
      db.salesOrder.findFirst({ where: salesOrderWhere(scope, { createdAt: { gt: row.createdAt } }), orderBy: { createdAt: "asc" }, select: { id: true } }),
      db.salesOrder.findFirst({ where: salesOrderWhere(scope, { createdAt: { lt: row.createdAt } }), orderBy: { createdAt: "desc" }, select: { id: true } }),
      panel.company.findUnique({
        where: { id: row.companyId },
        select: { name: true, legal_name: true, address: true, city: true, state: true, pincode: true, gstin: true, phone: true, email: true },
      }),
    ]);
    const name = (id: number | null | undefined) => (id ? names.get(id) ?? null : null);

    return genrateResponse(res, HttpStatus.OK, "Sales order", {
      ...row,
      assignedToName: name(row.assignedTo),
      createdByName: name(row.createdBy),
      paid: row.payments.reduce((sum, p) => sum + Number(p.amount), 0),
      payments: row.payments.map((p) => ({ ...p, createdByName: name(p.createdBy) })),
      activities: row.activities.map((a) => ({ ...a, createdByName: name(a.createdBy) })),
      company,
      prevId: prev?.id ?? null,
      nextId: next?.id ?? null,
    });
  } catch (err) {
    console.error("[GetSalesOrder]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to load sales order");
  }
};

// ============================================================
// CREATE — sirf active B2B customer. start: QUOTATION (naya) ya INVOICE (repeat order)
// ============================================================
export const createSalesOrder = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);

    const { customerId, start, assignedTo, notes } = req.body as CreateSalesOrderInput;
    const customer = await db.customer.findFirst({ where: customerWhere(scope, { id: customerId }) });
    if (!customer) return genrateResponse(res, HttpStatus.NotFound, "Customer not found");
    if (customer.type !== CustomerType.B2B) return genrateResponse(res, HttpStatus.BadRequest, "Sales orders are only for B2B customers");
    if (customer.status !== CustomerStatus.ACTIVE) return genrateResponse(res, HttpStatus.BadRequest, "Customer is inactive");
    if (assignedTo && !(await isCompanyUser(customer.companyId, assignedTo))) return genrateResponse(res, HttpStatus.BadRequest, "Select a valid user to assign");

    const order = (await createWithCode("SO", customer.companyId, (orderNo) =>
      db.salesOrder.create({
        data: {
          orderNo,
          companyId: customer.companyId,
          customerId: customer.id,
          stage: start === "INVOICE" ? SalesOrderStage.INVOICE : SalesOrderStage.QUOTATION,
          assignedTo: assignedTo ?? customer.assignedTo,
          notes,
          createdBy: req.user!.userId,
        },
      }),
    )) as { id: number; orderNo: string };

    await orderActivity(order.id, ProjectActivityType.CREATED, `Order created · ${start === "INVOICE" ? "direct invoice (repeat order)" : "starts with quotation"}`, req.user!.userId);
    return genrateResponse(res, HttpStatus.Created, "Sales order created", order);
  } catch (err) {
    console.error("[CreateSalesOrder]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to create sales order");
  }
};

export const addSalesOrderNote = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const order = await findSalesOrder(scope, Number(req.params.id));
    if (!order) return genrateResponse(res, HttpStatus.NotFound, "Sales order not found");
    await orderActivity(order.id, ProjectActivityType.NOTE, req.body.message, req.user!.userId);
    return genrateResponse(res, HttpStatus.Created, "Note added");
  } catch (err) {
    console.error("[SalesOrderNote]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to add note");
  }
};

// Cancel — dispatch se pehle tak
export const cancelSalesOrder = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const order = await findSalesOrder(scope, Number(req.params.id));
    if (!order) return genrateResponse(res, HttpStatus.NotFound, "Sales order not found");
    if (order.status !== SalesOrderStatus.OPEN) return genrateResponse(res, HttpStatus.BadRequest, "Order is already closed");
    if (order.stage === SalesOrderStage.DISPATCH) return genrateResponse(res, HttpStatus.BadRequest, "Order is confirmed — it cannot be cancelled now");

    const { reason } = req.body as { reason: string };
    await db.$transaction([
      db.salesOrder.update({ where: { id: order.id }, data: { status: SalesOrderStatus.CANCELLED } }),
      db.projectActivity.create({ data: { salesOrderId: order.id, type: ProjectActivityType.UPDATED, message: `Order cancelled · ${reason}`, createdBy: req.user!.userId } }),
    ]);
    return genrateResponse(res, HttpStatus.OK, "Order cancelled");
  } catch (err) {
    console.error("[CancelSalesOrder]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to cancel order");
  }
};
