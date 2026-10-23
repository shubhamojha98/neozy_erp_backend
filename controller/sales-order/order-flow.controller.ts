import { Response } from "express";
import { DispatchStatus, PaymentMethod, ProjectActivityType, QuotationStatus, SalesOrderStage, SalesOrderStatus } from "../../generated/project/client";
import { project as db } from "../../lib/globalprimsaclient";
import genrateResponse from "../../lib/generateResponse";
import HttpStatus from "../../lib/httpStatus";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { getScope, NO_COMPANY } from "../../dal/scope.dal";
import { createWithCode } from "../../dal/project.dal";
import { quotationHeader, quotationItemRows, quotationTotals } from "../../dal/quotation.dal";
import { findSalesOrder, moveOrderStage, orderActivity, orderAtStage, orderPaidTotal } from "../../dal/sales-order.dal";
import { inr, round2 } from "../../utility/format";
import { DispatchInput, PaymentInput, QuotationInput } from "../../validations/project.validation";

// B2B order ke stage: Quotation → (Accept) → Invoice → 100% Payment → Confirm Order → Dispatch → Delivered (Close)
// Repeat order: seedha Invoice (items daalo, quotation ACCEPTED + invoice ek saath)
// URL: /api/sales-order/:id/...

const METHOD_TEXT: Record<PaymentMethod, string> = { CASH: "Cash", UPI: "UPI", CHEQUE: "Cheque", BANK_TRANSFER: "Bank Transfer", LOAN: "Loan Disbursement" };

// Har stage ka same check
async function atStage(req: AuthenticatedRequest, res: Response, stage: SalesOrderStage) {
  const scope = await getScope(req.user!);
  if (!scope) return void genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
  const check = await orderAtStage(scope, Number(req.params.id), stage);
  if (check.notFound) return void genrateResponse(res, HttpStatus.NotFound, "Sales order not found");
  if (check.error) return void genrateResponse(res, HttpStatus.BadRequest, check.error);
  return check.order!;
}

const quotationOf = (salesOrderId: number, quotationId: number) => db.quotation.findFirst({ where: { id: quotationId, salesOrderId } });

// ============================================================
// QUOTATION — create / update (Draft, Sent) / sent / reject / accept
// ============================================================
export const createOrderQuotation = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const order = await atStage(req, res, SalesOrderStage.QUOTATION);
    if (!order) return;
    const input = req.body as QuotationInput;
    const sums = quotationTotals(input);
    if (sums.total < 0) return genrateResponse(res, HttpStatus.BadRequest, "Discount is more than the quotation amount");

    const quotation = (await createWithCode("QT", order.companyId, (quotationNo) =>
      db.quotation.create({
        data: { ...quotationHeader(input), ...sums, companyId: order.companyId, salesOrderId: order.id, quotationNo, createdBy: req.user!.userId, items: { create: quotationItemRows(input) } },
      }),
    )) as { id: number; quotationNo: string };
    await orderActivity(order.id, ProjectActivityType.QUOTATION, `Quotation ${quotation.quotationNo} created · ${inr(sums.total)}`, req.user!.userId);
    return genrateResponse(res, HttpStatus.Created, "Quotation created", quotation);
  } catch (err) {
    console.error("[CreateOrderQuotation]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to create quotation");
  }
};

export const updateOrderQuotation = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const order = await atStage(req, res, SalesOrderStage.QUOTATION);
    if (!order) return;
    const quotation = await quotationOf(order.id, Number(req.params.quotationId));
    if (!quotation) return genrateResponse(res, HttpStatus.NotFound, "Quotation not found");
    if (quotation.status === QuotationStatus.ACCEPTED || quotation.status === QuotationStatus.REJECTED) {
      return genrateResponse(res, HttpStatus.BadRequest, "Accepted or rejected quotation cannot be edited");
    }
    const input = req.body as QuotationInput;
    const sums = quotationTotals(input);
    if (sums.total < 0) return genrateResponse(res, HttpStatus.BadRequest, "Discount is more than the quotation amount");

    await db.$transaction([
      db.quotationItem.deleteMany({ where: { quotationId: quotation.id } }),
      db.quotation.update({ where: { id: quotation.id }, data: { ...quotationHeader(input), ...sums, items: { create: quotationItemRows(input) } } }),
      db.projectActivity.create({ data: { salesOrderId: order.id, type: ProjectActivityType.QUOTATION, message: `Quotation ${quotation.quotationNo} updated · ${inr(sums.total)}`, createdBy: req.user!.userId } }),
    ]);
    return genrateResponse(res, HttpStatus.OK, "Quotation updated");
  } catch (err) {
    console.error("[UpdateOrderQuotation]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to update quotation");
  }
};

const STATUS_TEXT = { SENT: "marked as sent", REJECTED: "rejected" };

export const setOrderQuotationStatus = (status: "SENT" | "REJECTED") => async (req: AuthenticatedRequest, res: Response) => {
  try {
    const order = await atStage(req, res, SalesOrderStage.QUOTATION);
    if (!order) return;
    const quotation = await quotationOf(order.id, Number(req.params.quotationId));
    if (!quotation) return genrateResponse(res, HttpStatus.NotFound, "Quotation not found");
    const allowed = status === "SENT" ? quotation.status === QuotationStatus.DRAFT : quotation.status === QuotationStatus.DRAFT || quotation.status === QuotationStatus.SENT;
    if (!allowed) return genrateResponse(res, HttpStatus.BadRequest, `Quotation cannot be ${STATUS_TEXT[status]} now`);

    const reason = status === "REJECTED" ? (req.body?.reason as string | undefined) : undefined;
    await db.$transaction([
      db.quotation.update({ where: { id: quotation.id }, data: { status } }),
      db.projectActivity.create({
        data: { salesOrderId: order.id, type: ProjectActivityType.QUOTATION, message: `Quotation ${quotation.quotationNo} ${STATUS_TEXT[status]}${reason ? ` · ${reason}` : ""}`, createdBy: req.user!.userId },
      }),
    ]);
    return genrateResponse(res, HttpStatus.OK, `Quotation ${STATUS_TEXT[status]}`);
  } catch (err) {
    console.error("[OrderQuotationStatus]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to update quotation");
  }
};

// Accept → contract value = total, stage Invoice
export const acceptOrderQuotation = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const order = await atStage(req, res, SalesOrderStage.QUOTATION);
    if (!order) return;
    const quotation = await quotationOf(order.id, Number(req.params.quotationId));
    if (!quotation) return genrateResponse(res, HttpStatus.NotFound, "Quotation not found");
    if (quotation.status === QuotationStatus.ACCEPTED || quotation.status === QuotationStatus.REJECTED) return genrateResponse(res, HttpStatus.BadRequest, "Quotation is already closed");

    await db.$transaction([
      db.quotation.update({ where: { id: quotation.id }, data: { status: QuotationStatus.ACCEPTED } }),
      db.quotation.updateMany({
        where: { salesOrderId: order.id, id: { not: quotation.id }, status: { in: [QuotationStatus.DRAFT, QuotationStatus.SENT] } },
        data: { status: QuotationStatus.REJECTED },
      }),
      db.salesOrder.update({ where: { id: order.id }, data: { contractValue: quotation.total } }),
      db.projectActivity.create({ data: { salesOrderId: order.id, type: ProjectActivityType.QUOTATION, message: `Quotation ${quotation.quotationNo} accepted · ${inr(quotation.total)}`, createdBy: req.user!.userId } }),
      ...moveOrderStage(order.id, SalesOrderStage.INVOICE, "Moved to Invoice", req.user!.userId),
    ]);
    return genrateResponse(res, HttpStatus.OK, "Quotation accepted — moved to Invoice");
  } catch (err) {
    console.error("[AcceptOrderQuotation]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to accept quotation");
  }
};

// ============================================================
// INVOICE — accepted quotation se, ya repeat order me seedha items se. Stage Order.
// ============================================================
async function issueInvoice(orderId: number, companyId: number, quotationId: number, total: unknown, userId: number) {
  const invoice = (await createWithCode("INV", companyId, (invoiceNo) =>
    db.invoice.create({ data: { companyId, salesOrderId: orderId, quotationId, invoiceNo, date: new Date(), total: total as number, createdBy: userId } }),
  )) as { invoiceNo: string };
  await db.$transaction([
    db.salesOrder.update({ where: { id: orderId }, data: { contractValue: total as number } }),
    db.projectActivity.create({ data: { salesOrderId: orderId, type: ProjectActivityType.INVOICE, message: `Invoice ${invoice.invoiceNo} generated · ${inr(total)}`, createdBy: userId } }),
    ...moveOrderStage(orderId, SalesOrderStage.ORDER, "Moved to Order — collect 100% advance", userId),
  ]);
  return invoice;
}

// direct = repeat order (body me items, validated). Warna accepted quotation se.
export const createOrderInvoice = (direct: boolean) => async (req: AuthenticatedRequest, res: Response) => {
  try {
    const order = await atStage(req, res, SalesOrderStage.INVOICE);
    if (!order) return;
    if (await db.invoice.findUnique({ where: { salesOrderId: order.id } })) return genrateResponse(res, HttpStatus.Conflict, "Invoice already exists");

    // Repeat order: body me items aaye → pehle accepted quotation (record ke liye), phir invoice
    let quotation = await db.quotation.findFirst({ where: { salesOrderId: order.id, status: QuotationStatus.ACCEPTED } });
    if (!quotation && !direct) return genrateResponse(res, HttpStatus.BadRequest, "Accept a quotation first");
    if (!quotation) {
      const input = req.body as QuotationInput;
      const sums = quotationTotals(input);
      if (sums.total < 0) return genrateResponse(res, HttpStatus.BadRequest, "Discount is more than the invoice amount");
      quotation = (await createWithCode("QT", order.companyId, (quotationNo) =>
        db.quotation.create({
          data: {
            ...quotationHeader(input),
            ...sums,
            status: QuotationStatus.ACCEPTED,
            companyId: order.companyId,
            salesOrderId: order.id,
            quotationNo,
            createdBy: req.user!.userId,
            items: { create: quotationItemRows(input) },
          },
        }),
      )) as NonNullable<typeof quotation>;
    }

    const invoice = await issueInvoice(order.id, order.companyId, quotation.id, quotation.total, req.user!.userId);
    return genrateResponse(res, HttpStatus.Created, "Invoice generated — moved to Order", invoice);
  } catch (err) {
    console.error("[CreateOrderInvoice]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to generate invoice");
  }
};

// ============================================================
// PAYMENT — invoice ke baad. Total se zyada nahi. Order confirm ke baad delete nahi.
// ============================================================
export const addOrderPayment = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const order = await findSalesOrder(scope, Number(req.params.id));
    if (!order) return genrateResponse(res, HttpStatus.NotFound, "Sales order not found");
    if (order.status === SalesOrderStatus.CANCELLED) return genrateResponse(res, HttpStatus.BadRequest, "Order is cancelled");
    if (!order.contractValue) return genrateResponse(res, HttpStatus.BadRequest, "Generate the invoice before recording payments");

    const input = req.body as PaymentInput;
    const balance = round2(Number(order.contractValue) - (await orderPaidTotal(order.id)));
    if (input.amount > balance) return genrateResponse(res, HttpStatus.BadRequest, `Amount is more than the balance (${inr(balance)})`);

    await db.$transaction([
      db.payment.create({ data: { ...input, paidOn: new Date(input.paidOn), companyId: order.companyId, salesOrderId: order.id, createdBy: req.user!.userId } }),
      db.projectActivity.create({
        data: { salesOrderId: order.id, type: ProjectActivityType.PAYMENT, message: `Payment received · ${inr(input.amount)} · ${METHOD_TEXT[input.method]}${input.reference ? ` · ${input.reference}` : ""}`, createdBy: req.user!.userId },
      }),
    ]);
    return genrateResponse(res, HttpStatus.Created, "Payment recorded");
  } catch (err) {
    console.error("[AddOrderPayment]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to record payment");
  }
};

export const deleteOrderPayment = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const order = await findSalesOrder(scope, Number(req.params.id));
    if (!order) return genrateResponse(res, HttpStatus.NotFound, "Sales order not found");
    if (order.confirmedAt) return genrateResponse(res, HttpStatus.BadRequest, "Payments cannot be deleted after the order is confirmed");

    const payment = await db.payment.findFirst({ where: { id: Number(req.params.paymentId), salesOrderId: order.id, deletedAt: null } });
    if (!payment) return genrateResponse(res, HttpStatus.NotFound, "Payment not found");
    await db.$transaction([
      db.payment.update({ where: { id: payment.id }, data: { deletedAt: new Date() } }),
      db.projectActivity.create({ data: { salesOrderId: order.id, type: ProjectActivityType.PAYMENT, message: `Payment entry deleted · ${inr(payment.amount)}`, createdBy: req.user!.userId } }),
    ]);
    return genrateResponse(res, HttpStatus.OK, "Payment deleted");
  } catch (err) {
    console.error("[DeleteOrderPayment]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to delete payment");
  }
};

// ============================================================
// CONFIRM ORDER — 100% advance zaroori. Stage Dispatch.
// ============================================================
export const confirmSalesOrder = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const order = await atStage(req, res, SalesOrderStage.ORDER);
    if (!order) return;
    const balance = round2(Number(order.contractValue ?? 0) - (await orderPaidTotal(order.id)));
    if (balance > 0) return genrateResponse(res, HttpStatus.BadRequest, `Order needs 100% advance — ${inr(balance)} pending`);

    await db.$transaction([
      db.salesOrder.update({ where: { id: order.id }, data: { confirmedAt: new Date() } }),
      db.projectActivity.create({ data: { salesOrderId: order.id, type: ProjectActivityType.ORDER, message: "Order confirmed · 100% advance received", createdBy: req.user!.userId } }),
      ...moveOrderStage(order.id, SalesOrderStage.DISPATCH, "Moved to Dispatch", req.user!.userId),
    ]);
    return genrateResponse(res, HttpStatus.OK, "Order confirmed — moved to Dispatch");
  } catch (err) {
    console.error("[ConfirmSalesOrder]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to confirm order");
  }
};

// ============================================================
// DISPATCH (challan) → Delivered = order CLOSED
// ============================================================
export const saveOrderDispatch = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const order = await atStage(req, res, SalesOrderStage.DISPATCH);
    if (!order) return;
    const input = req.body as DispatchInput;
    const data = { ...input, dispatchDate: new Date(input.dispatchDate) };
    const existing = await db.dispatch.findUnique({ where: { salesOrderId: order.id } });

    if (existing) {
      await db.$transaction([
        db.dispatch.update({ where: { id: existing.id }, data }),
        db.projectActivity.create({ data: { salesOrderId: order.id, type: ProjectActivityType.DISPATCH, message: `Dispatch ${existing.dispatchNo} updated · ${input.vehicleNo}`, createdBy: req.user!.userId } }),
      ]);
      return genrateResponse(res, HttpStatus.OK, "Dispatch updated");
    }
    const dispatch = (await createWithCode("DSP", order.companyId, (dispatchNo) =>
      db.dispatch.create({ data: { ...data, dispatchNo, companyId: order.companyId, salesOrderId: order.id, createdBy: req.user!.userId } }),
    )) as { dispatchNo: string };
    await orderActivity(order.id, ProjectActivityType.DISPATCH, `Material dispatched · ${dispatch.dispatchNo} · ${input.vehicleNo}`, req.user!.userId);
    return genrateResponse(res, HttpStatus.Created, "Dispatch saved", dispatch);
  } catch (err) {
    console.error("[SaveOrderDispatch]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to save dispatch");
  }
};

export const deliverSalesOrder = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const order = await atStage(req, res, SalesOrderStage.DISPATCH);
    if (!order) return;
    const dispatch = await db.dispatch.findUnique({ where: { salesOrderId: order.id } });
    if (!dispatch) return genrateResponse(res, HttpStatus.BadRequest, "Save the dispatch details first");

    const { receivedBy } = req.body as { receivedBy: string };
    await db.$transaction([
      db.dispatch.update({ where: { id: dispatch.id }, data: { status: DispatchStatus.DELIVERED, deliveredAt: new Date(), receivedBy } }),
      db.salesOrder.update({ where: { id: order.id }, data: { status: SalesOrderStatus.CLOSED, closedAt: new Date() } }),
      db.projectActivity.create({ data: { salesOrderId: order.id, type: ProjectActivityType.DISPATCH, message: `Delivered · received by ${receivedBy} — order closed`, createdBy: req.user!.userId } }),
    ]);
    return genrateResponse(res, HttpStatus.OK, "Delivered — order completed 🎉");
  } catch (err) {
    console.error("[DeliverSalesOrder]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to mark delivered");
  }
};
