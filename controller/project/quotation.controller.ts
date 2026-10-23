import { Response } from "express";
import { PaymentMode, ProjectActivityType, ProjectStage, QuotationStatus } from "../../generated/project/client";
import { inventory, project as db } from "../../lib/globalprimsaclient";
import genrateResponse from "../../lib/generateResponse";
import HttpStatus from "../../lib/httpStatus";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { getScope, NO_COMPANY } from "../../dal/scope.dal";
import { createWithCode, moveStage, projectAtStage } from "../../dal/project.dal";
import { inr } from "../../utility/format";
import { quotationHeader, quotationItemRows, quotationTotals } from "../../dal/quotation.dal";
import { QuotationInput } from "../../validations/project.validation";

// Quotation: banao / edit (Draft, Sent) → Sent → Accept (Cash / Bank Loan) ya Reject
// URL: /api/project/:id/quotations ...

const quotationOf = (projectId: number, quotationId: number) => db.quotation.findFirst({ where: { id: quotationId, projectId } });

// ============================================================
// PRODUCTS — item picker (inventory ke products)
// ============================================================
export const listQuotationProducts = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";

    const products = await inventory.product.findMany({
      where: {
        companyId: { in: scope.companyIds },
        recStatus: 1,
        isActive: true,
        ...(search && { OR: [{ productName: { contains: search, mode: "insensitive" } }, { sku: { contains: search, mode: "insensitive" } }] }),
      },
      orderBy: { productName: "asc" },
      take: 20,
      select: { id: true, productName: true, sku: true, unit: true, hsn: true, productPrice: true, gstRate: true, description: true },
    });
    return genrateResponse(
      res,
      HttpStatus.OK,
      "Products",
      products.map((p) => ({ ...p, id: Number(p.id), productPrice: Number(p.productPrice), gstRate: Number(p.gstRate) })),
    );
  } catch (err) {
    // Inventory module abhi set nahi (table nahi) — picker khaali, item haath se likh sakte hain
    if ((err as { code?: string }).code === "P2021") return genrateResponse(res, HttpStatus.OK, "Products", []);
    console.error("[QuotationProducts]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to load products");
  }
};

// ============================================================
// CREATE — pehle se accepted ho to nahi
// ============================================================
export const createQuotation = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const check = await projectAtStage(scope, Number(req.params.id), ProjectStage.QUOTATION);
    if (check.notFound) return genrateResponse(res, HttpStatus.NotFound, "Project not found");
    if (check.error) return genrateResponse(res, HttpStatus.BadRequest, check.error);
    const project = check.project!;

    const input = req.body as QuotationInput;
    const sums = quotationTotals(input);
    if (sums.total < 0) return genrateResponse(res, HttpStatus.BadRequest, "Discount is more than the quotation amount");

    const quotation = (await createWithCode("QT", project.companyId, (quotationNo) =>
      db.quotation.create({
        data: {
          ...quotationHeader(input),
          ...sums,
          companyId: project.companyId,
          projectId: project.id,
          quotationNo,
          createdBy: req.user!.userId,
          items: { create: quotationItemRows(input) },
        },
      }),
    )) as { id: number; quotationNo: string };

    await db.projectActivity.create({
      data: { projectId: project.id, type: ProjectActivityType.QUOTATION, message: `Quotation ${quotation.quotationNo} created · ${inr(sums.total)}`, createdBy: req.user!.userId },
    });
    return genrateResponse(res, HttpStatus.Created, "Quotation created", quotation);
  } catch (err) {
    console.error("[CreateQuotation]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to create quotation");
  }
};

// ============================================================
// UPDATE — sirf Draft / Sent. Items poore replace.
// ============================================================
export const updateQuotation = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const check = await projectAtStage(scope, Number(req.params.id), ProjectStage.QUOTATION);
    if (check.notFound) return genrateResponse(res, HttpStatus.NotFound, "Project not found");
    if (check.error) return genrateResponse(res, HttpStatus.BadRequest, check.error);

    const quotation = await quotationOf(check.project!.id, Number(req.params.quotationId));
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
      db.projectActivity.create({
        data: { projectId: quotation.projectId, type: ProjectActivityType.QUOTATION, message: `Quotation ${quotation.quotationNo} updated · ${inr(sums.total)}`, createdBy: req.user!.userId },
      }),
    ]);
    return genrateResponse(res, HttpStatus.OK, "Quotation updated");
  } catch (err) {
    console.error("[UpdateQuotation]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to update quotation");
  }
};

// ============================================================
// SENT / REJECT — status badlo
// ============================================================
const STATUS_TEXT = { SENT: "marked as sent", REJECTED: "rejected" };

export const setQuotationStatus = (status: "SENT" | "REJECTED") => async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const check = await projectAtStage(scope, Number(req.params.id), ProjectStage.QUOTATION);
    if (check.notFound) return genrateResponse(res, HttpStatus.NotFound, "Project not found");
    if (check.error) return genrateResponse(res, HttpStatus.BadRequest, check.error);

    const quotation = await quotationOf(check.project!.id, Number(req.params.quotationId));
    if (!quotation) return genrateResponse(res, HttpStatus.NotFound, "Quotation not found");
    const allowed = status === "SENT" ? quotation.status === QuotationStatus.DRAFT : quotation.status !== QuotationStatus.ACCEPTED && quotation.status !== QuotationStatus.REJECTED;
    if (!allowed) return genrateResponse(res, HttpStatus.BadRequest, `Quotation cannot be ${STATUS_TEXT[status]} now`);

    const reason = status === "REJECTED" ? (req.body?.reason as string | undefined) : undefined;
    await db.$transaction([
      db.quotation.update({ where: { id: quotation.id }, data: { status } }),
      db.projectActivity.create({
        data: {
          projectId: quotation.projectId,
          type: ProjectActivityType.QUOTATION,
          message: `Quotation ${quotation.quotationNo} ${STATUS_TEXT[status]}${reason ? ` · ${reason}` : ""}`,
          createdBy: req.user!.userId,
        },
      }),
    ]);
    return genrateResponse(res, HttpStatus.OK, `Quotation ${STATUS_TEXT[status]}`);
  } catch (err) {
    console.error("[QuotationStatus]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to update quotation");
  }
};

// ============================================================
// ACCEPT — Cash ya Bank Loan chuno. Contract value = total. Stage: Bank Loan ya Registration
// ============================================================
export const acceptQuotation = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const check = await projectAtStage(scope, Number(req.params.id), ProjectStage.QUOTATION);
    if (check.notFound) return genrateResponse(res, HttpStatus.NotFound, "Project not found");
    if (check.error) return genrateResponse(res, HttpStatus.BadRequest, check.error);
    const project = check.project!;

    const quotation = await quotationOf(project.id, Number(req.params.quotationId));
    if (!quotation) return genrateResponse(res, HttpStatus.NotFound, "Quotation not found");
    if (quotation.status === QuotationStatus.ACCEPTED || quotation.status === QuotationStatus.REJECTED) {
      return genrateResponse(res, HttpStatus.BadRequest, "Quotation is already closed");
    }

    const { paymentMode } = req.body as { paymentMode: PaymentMode };
    const next = paymentMode === PaymentMode.LOAN ? ProjectStage.LOAN : ProjectStage.REGISTRATION;
    await db.$transaction([
      db.quotation.update({ where: { id: quotation.id }, data: { status: QuotationStatus.ACCEPTED } }),
      // Baaki khuli quotations band
      db.quotation.updateMany({
        where: { projectId: project.id, id: { not: quotation.id }, status: { in: [QuotationStatus.DRAFT, QuotationStatus.SENT] } },
        data: { status: QuotationStatus.REJECTED },
      }),
      db.project.update({ where: { id: project.id }, data: { paymentMode, contractValue: quotation.total } }),
      db.projectActivity.create({
        data: {
          projectId: project.id,
          type: ProjectActivityType.QUOTATION,
          message: `Quotation ${quotation.quotationNo} accepted · ${inr(quotation.total)} · ${paymentMode === PaymentMode.LOAN ? "Bank Loan" : "Cash"}`,
          createdBy: req.user!.userId,
        },
      }),
      ...moveStage(project.id, next, next === ProjectStage.LOAN ? "Moved to Bank Loan" : "Moved to Registration", req.user!.userId),
    ]);
    return genrateResponse(res, HttpStatus.OK, `Quotation accepted — moved to ${next === ProjectStage.LOAN ? "Bank Loan" : "Registration"}`);
  } catch (err) {
    console.error("[AcceptQuotation]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to accept quotation");
  }
};
