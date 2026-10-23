import { Response } from "express";
import { PaymentMethod, ProjectActivityType, ProjectStage, ProjectStatus, QuotationStatus } from "../../generated/project/client";
import { project as db } from "../../lib/globalprimsaclient";
import genrateResponse from "../../lib/generateResponse";
import HttpStatus from "../../lib/httpStatus";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { getScope, NO_COMPANY } from "../../dal/scope.dal";
import { createWithCode, findProject, moveStage, paidTotal, projectAtStage } from "../../dal/project.dal";
import { inr, round2 } from "../../utility/format";
import { ORDER_MIN_PERCENT } from "../../constants/options";
import { PaymentInput } from "../../validations/project.validation";

// Invoice (accepted quotation se) → Payments → Order (90% paid hone par, stage Dispatch)
// URL: /api/project/:id/invoice | /payments | /order


const METHOD_TEXT: Record<PaymentMethod, string> = { CASH: "Cash", UPI: "UPI", CHEQUE: "Cheque", BANK_TRANSFER: "Bank Transfer", LOAN: "Loan Disbursement" };

// ============================================================
// INVOICE — accepted quotation se, stage Order
// ============================================================
export const createInvoice = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const check = await projectAtStage(scope, Number(req.params.id), ProjectStage.INVOICE);
    if (check.notFound) return genrateResponse(res, HttpStatus.NotFound, "Project not found");
    if (check.error) return genrateResponse(res, HttpStatus.BadRequest, check.error);
    const project = check.project!;

    const quotation = await db.quotation.findFirst({ where: { projectId: project.id, status: QuotationStatus.ACCEPTED } });
    if (!quotation) return genrateResponse(res, HttpStatus.BadRequest, "No accepted quotation found");
    if (await db.invoice.findUnique({ where: { projectId: project.id } })) return genrateResponse(res, HttpStatus.Conflict, "Invoice already exists");

    const invoice = (await createWithCode("INV", project.companyId, (invoiceNo) =>
      db.invoice.create({
        data: { companyId: project.companyId, projectId: project.id, quotationId: quotation.id, invoiceNo, date: new Date(), total: quotation.total, createdBy: req.user!.userId },
      }),
    )) as { invoiceNo: string };

    await db.$transaction([
      db.projectActivity.create({
        data: { projectId: project.id, type: ProjectActivityType.INVOICE, message: `Invoice ${invoice.invoiceNo} generated · ${inr(quotation.total)}`, createdBy: req.user!.userId },
      }),
      ...moveStage(project.id, ProjectStage.ORDER, "Moved to Order", req.user!.userId),
    ]);
    return genrateResponse(res, HttpStatus.Created, "Invoice generated — moved to Order", invoice);
  } catch (err) {
    console.error("[CreateInvoice]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to generate invoice");
  }
};

// ============================================================
// PAYMENT — quotation accept hone ke baad kabhi bhi. Contract value se zyada nahi.
// ============================================================
export const addPayment = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const project = await findProject(scope, Number(req.params.id));
    if (!project) return genrateResponse(res, HttpStatus.NotFound, "Project not found");
    if (project.status === ProjectStatus.CANCELLED) return genrateResponse(res, HttpStatus.BadRequest, "Project is cancelled");
    if (!project.contractValue) return genrateResponse(res, HttpStatus.BadRequest, "Accept a quotation before recording payments");

    const input = req.body as PaymentInput;
    const balance = round2(Number(project.contractValue) - (await paidTotal(project.id)));
    if (input.amount > balance) return genrateResponse(res, HttpStatus.BadRequest, `Amount is more than the balance (${inr(balance)})`);

    await db.$transaction([
      db.payment.create({ data: { ...input, paidOn: new Date(input.paidOn), companyId: project.companyId, projectId: project.id, createdBy: req.user!.userId } }),
      db.projectActivity.create({
        data: {
          projectId: project.id,
          type: ProjectActivityType.PAYMENT,
          message: `Payment received · ${inr(input.amount)} · ${METHOD_TEXT[input.method]}${input.reference ? ` · ${input.reference}` : ""}`,
          createdBy: req.user!.userId,
        },
      }),
    ]);
    return genrateResponse(res, HttpStatus.Created, "Payment recorded");
  } catch (err) {
    console.error("[AddPayment]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to record payment");
  }
};

// Galat entry hatao — order banne ke baad nahi (hisaab pakka rahe)
export const deletePayment = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const project = await findProject(scope, Number(req.params.id));
    if (!project) return genrateResponse(res, HttpStatus.NotFound, "Project not found");

    const payment = await db.payment.findFirst({ where: { id: Number(req.params.paymentId), projectId: project.id, deletedAt: null } });
    if (!payment) return genrateResponse(res, HttpStatus.NotFound, "Payment not found");
    if (await db.projectOrder.findUnique({ where: { projectId: project.id } })) {
      return genrateResponse(res, HttpStatus.BadRequest, "Payments cannot be deleted after the order is created");
    }

    await db.$transaction([
      db.payment.update({ where: { id: payment.id }, data: { deletedAt: new Date() } }),
      db.projectActivity.create({
        data: { projectId: project.id, type: ProjectActivityType.PAYMENT, message: `Payment entry deleted · ${inr(payment.amount)} · ${METHOD_TEXT[payment.method]}`, createdBy: req.user!.userId },
      }),
    ]);
    return genrateResponse(res, HttpStatus.OK, "Payment deleted");
  } catch (err) {
    console.error("[DeletePayment]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to delete payment");
  }
};

// ============================================================
// ORDER — 90% paid hona zaroori. Stage Dispatch.
// ============================================================
export const createOrder = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const check = await projectAtStage(scope, Number(req.params.id), ProjectStage.ORDER);
    if (check.notFound) return genrateResponse(res, HttpStatus.NotFound, "Project not found");
    if (check.error) return genrateResponse(res, HttpStatus.BadRequest, check.error);
    const project = check.project!;

    const contract = Number(project.contractValue ?? 0);
    const percent = contract ? round2(((await paidTotal(project.id)) / contract) * 100) : 0;
    if (percent < ORDER_MIN_PERCENT) {
      return genrateResponse(res, HttpStatus.BadRequest, `Order needs at least ${ORDER_MIN_PERCENT}% payment — received ${percent}%`);
    }

    const order = (await createWithCode("ORD", project.companyId, (orderNo) =>
      db.projectOrder.create({ data: { companyId: project.companyId, projectId: project.id, orderNo, date: new Date(), paidPercent: percent, createdBy: req.user!.userId } }),
    )) as { orderNo: string };

    await db.$transaction([
      db.projectActivity.create({
        data: { projectId: project.id, type: ProjectActivityType.ORDER, message: `Order ${order.orderNo} created · ${percent}% paid`, createdBy: req.user!.userId },
      }),
      ...moveStage(project.id, ProjectStage.DISPATCH, "Moved to Dispatch", req.user!.userId),
    ]);
    return genrateResponse(res, HttpStatus.Created, "Order created — moved to Dispatch", order);
  } catch (err) {
    console.error("[CreateOrder]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to create order");
  }
};
