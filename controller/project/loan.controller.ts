import { Response } from "express";
import { LoanStatus, PaymentMode, ProjectActivityType, ProjectStage } from "../../generated/project/client";
import { project as db } from "../../lib/globalprimsaclient";
import genrateResponse from "../../lib/generateResponse";
import HttpStatus from "../../lib/httpStatus";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { getScope, NO_COMPANY } from "../../dal/scope.dal";
import { moveStage, projectAtStage } from "../../dal/project.dal";
import { inr } from "../../utility/format";
import { LoanInput } from "../../validations/project.validation";

// Bank Loan (sirf LOAN project): apply / re-apply → sanction (stage Registration) | reject → re-apply ya Cash
// Disbursement Payments me "Loan" method se record hota hai
// URL: /api/project/:id/loan ...

const log = (projectId: number, message: string, userId: number) =>
  db.projectActivity.create({ data: { projectId, type: ProjectActivityType.LOAN, message, createdBy: userId } });

// ============================================================
// APPLY — naya ya update (rejected ke baad dobara apply bhi)
// ============================================================
export const saveLoan = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const check = await projectAtStage(scope, Number(req.params.id), ProjectStage.LOAN);
    if (check.notFound) return genrateResponse(res, HttpStatus.NotFound, "Project not found");
    if (check.error) return genrateResponse(res, HttpStatus.BadRequest, check.error);
    const project = check.project!;

    const input = req.body as LoanInput;
    const existing = await db.loanApplication.findUnique({ where: { projectId: project.id } });
    const data = { ...input, status: LoanStatus.APPLIED, rejectReason: null };

    await db.$transaction([
      existing
        ? db.loanApplication.update({ where: { id: existing.id }, data })
        : db.loanApplication.create({ data: { ...data, companyId: project.companyId, projectId: project.id, createdBy: req.user!.userId } }),
      log(project.id, `Loan ${existing ? (existing.status === LoanStatus.REJECTED ? "re-applied" : "updated") : "applied"} · ${input.bankName} · ${inr(input.loanAmount)}`, req.user!.userId),
    ]);
    return genrateResponse(res, existing ? HttpStatus.OK : HttpStatus.Created, "Loan application saved");
  } catch (err) {
    console.error("[SaveLoan]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to save loan application");
  }
};

// ============================================================
// SANCTION — stage Registration
// ============================================================
export const sanctionLoan = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const check = await projectAtStage(scope, Number(req.params.id), ProjectStage.LOAN);
    if (check.notFound) return genrateResponse(res, HttpStatus.NotFound, "Project not found");
    if (check.error) return genrateResponse(res, HttpStatus.BadRequest, check.error);
    const project = check.project!;

    const loan = await db.loanApplication.findUnique({ where: { projectId: project.id } });
    if (!loan || loan.status !== LoanStatus.APPLIED) return genrateResponse(res, HttpStatus.BadRequest, "Apply for the loan first");

    const { sanctionedAmount, sanctionDate } = req.body as { sanctionedAmount: number; sanctionDate: string };
    await db.$transaction([
      db.loanApplication.update({ where: { id: loan.id }, data: { status: LoanStatus.SANCTIONED, sanctionedAmount, sanctionDate: new Date(sanctionDate) } }),
      log(project.id, `Loan sanctioned · ${loan.bankName} · ${inr(sanctionedAmount)}`, req.user!.userId),
      ...moveStage(project.id, ProjectStage.REGISTRATION, "Moved to Registration", req.user!.userId),
    ]);
    return genrateResponse(res, HttpStatus.OK, "Loan sanctioned — moved to Registration");
  } catch (err) {
    console.error("[SanctionLoan]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to sanction loan");
  }
};

// ============================================================
// REJECT — bank ne mana kiya
// ============================================================
export const rejectLoan = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const check = await projectAtStage(scope, Number(req.params.id), ProjectStage.LOAN);
    if (check.notFound) return genrateResponse(res, HttpStatus.NotFound, "Project not found");
    if (check.error) return genrateResponse(res, HttpStatus.BadRequest, check.error);
    const project = check.project!;

    const loan = await db.loanApplication.findUnique({ where: { projectId: project.id } });
    if (!loan || loan.status !== LoanStatus.APPLIED) return genrateResponse(res, HttpStatus.BadRequest, "No pending loan application");

    const { reason } = req.body as { reason: string };
    await db.$transaction([
      db.loanApplication.update({ where: { id: loan.id }, data: { status: LoanStatus.REJECTED, rejectReason: reason } }),
      log(project.id, `Loan rejected by ${loan.bankName} · ${reason}`, req.user!.userId),
    ]);
    return genrateResponse(res, HttpStatus.OK, "Loan marked as rejected");
  } catch (err) {
    console.error("[RejectLoan]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to update loan");
  }
};

// ============================================================
// SWITCH TO CASH — loan nahi mila / customer khud dega. Stage Registration
// ============================================================
export const switchToCash = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const check = await projectAtStage(scope, Number(req.params.id), ProjectStage.LOAN);
    if (check.notFound) return genrateResponse(res, HttpStatus.NotFound, "Project not found");
    if (check.error) return genrateResponse(res, HttpStatus.BadRequest, check.error);
    const project = check.project!;

    await db.$transaction([
      db.project.update({ where: { id: project.id }, data: { paymentMode: PaymentMode.CASH } }),
      log(project.id, "Payment mode changed to Cash", req.user!.userId),
      ...moveStage(project.id, ProjectStage.REGISTRATION, "Moved to Registration", req.user!.userId),
    ]);
    return genrateResponse(res, HttpStatus.OK, "Switched to Cash — moved to Registration");
  } catch (err) {
    console.error("[SwitchToCash]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to switch to cash");
  }
};
