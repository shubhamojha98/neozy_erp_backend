import { Response } from "express";
import { ProjectActivityType, ProjectStage, RegistrationStatus } from "../../generated/project/client";
import { project as db } from "../../lib/globalprimsaclient";
import genrateResponse from "../../lib/generateResponse";
import HttpStatus from "../../lib/httpStatus";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { getScope, NO_COMPANY } from "../../dal/scope.dal";
import { moveStage, projectAtStage } from "../../dal/project.dal";
import { RegistrationInput } from "../../validations/project.validation";

// Registration (PM Surya Ghar / DISCOM portal): submit (details) → approve (stage Invoice) | reject → edit karke dobara
// URL: /api/project/:id/registration ...

const log = (projectId: number, message: string, userId: number) =>
  db.projectActivity.create({ data: { projectId, type: ProjectActivityType.REGISTRATION, message, createdBy: userId } });

// ============================================================
// SUBMIT — naya ya update (status Submitted)
// ============================================================
export const saveRegistration = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const check = await projectAtStage(scope, Number(req.params.id), ProjectStage.REGISTRATION);
    if (check.notFound) return genrateResponse(res, HttpStatus.NotFound, "Project not found");
    if (check.error) return genrateResponse(res, HttpStatus.BadRequest, check.error);
    const project = check.project!;

    const input = req.body as RegistrationInput;
    const data = { ...input, registrationDate: new Date(input.registrationDate), status: RegistrationStatus.SUBMITTED, rejectReason: null };
    const existing = await db.registration.findUnique({ where: { projectId: project.id } });

    await db.$transaction([
      existing
        ? db.registration.update({ where: { id: existing.id }, data })
        : db.registration.create({ data: { ...data, companyId: project.companyId, projectId: project.id, createdBy: req.user!.userId } }),
      log(project.id, `Registration ${existing ? "updated" : "submitted"} · ${input.portal} · ${input.applicationNo}`, req.user!.userId),
    ]);
    return genrateResponse(res, existing ? HttpStatus.OK : HttpStatus.Created, "Registration saved");
  } catch (err) {
    console.error("[SaveRegistration]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to save registration");
  }
};

// ============================================================
// APPROVE / REJECT
// ============================================================
export const approveRegistration = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const check = await projectAtStage(scope, Number(req.params.id), ProjectStage.REGISTRATION);
    if (check.notFound) return genrateResponse(res, HttpStatus.NotFound, "Project not found");
    if (check.error) return genrateResponse(res, HttpStatus.BadRequest, check.error);
    const project = check.project!;

    const registration = await db.registration.findUnique({ where: { projectId: project.id } });
    if (!registration || registration.status !== RegistrationStatus.SUBMITTED) return genrateResponse(res, HttpStatus.BadRequest, "Submit the registration first");

    await db.$transaction([
      db.registration.update({ where: { id: registration.id }, data: { status: RegistrationStatus.APPROVED } }),
      log(project.id, `Registration approved · ${registration.applicationNo}`, req.user!.userId),
      ...moveStage(project.id, ProjectStage.INVOICE, "Moved to Invoice", req.user!.userId),
    ]);
    return genrateResponse(res, HttpStatus.OK, "Registration approved — moved to Invoice");
  } catch (err) {
    console.error("[ApproveRegistration]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to approve registration");
  }
};

export const rejectRegistration = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const check = await projectAtStage(scope, Number(req.params.id), ProjectStage.REGISTRATION);
    if (check.notFound) return genrateResponse(res, HttpStatus.NotFound, "Project not found");
    if (check.error) return genrateResponse(res, HttpStatus.BadRequest, check.error);
    const project = check.project!;

    const registration = await db.registration.findUnique({ where: { projectId: project.id } });
    if (!registration || registration.status !== RegistrationStatus.SUBMITTED) return genrateResponse(res, HttpStatus.BadRequest, "No submitted registration");

    const { reason } = req.body as { reason: string };
    await db.$transaction([
      db.registration.update({ where: { id: registration.id }, data: { status: RegistrationStatus.REJECTED, rejectReason: reason } }),
      log(project.id, `Registration rejected · ${reason}`, req.user!.userId),
    ]);
    return genrateResponse(res, HttpStatus.OK, "Registration marked as rejected");
  } catch (err) {
    console.error("[RejectRegistration]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to update registration");
  }
};
