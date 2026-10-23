import { Response } from "express";
import { NetMeteringStatus, ProjectActivityType, ProjectStage, ProjectStatus, SubsidyStatus } from "../../generated/project/client";
import { project as db } from "../../lib/globalprimsaclient";
import genrateResponse from "../../lib/generateResponse";
import HttpStatus from "../../lib/httpStatus";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { getScope, NO_COMPANY } from "../../dal/scope.dal";
import { moveStage, paidTotal, projectAtStage } from "../../dal/project.dal";
import { inr, round2 } from "../../utility/format";
import { NetMeteringInput, SubsidyInput } from "../../validations/project.validation";

// Commissioning → Net Metering (aage 100% payment par) → Subsidy → Handover (project COMPLETED)
// URL: /api/project/:id/commissioning | /net-metering | /subsidy | /handover

const log = (projectId: number, type: ProjectActivityType, message: string, userId: number) =>
  db.projectActivity.create({ data: { projectId, type, message, createdBy: userId } });

// Har stage ka same check — project mila + active + sahi stage
async function atStage(req: AuthenticatedRequest, res: Response, stage: ProjectStage) {
  const scope = await getScope(req.user!);
  if (!scope) return void genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
  const check = await projectAtStage(scope, Number(req.params.id), stage);
  if (check.notFound) return void genrateResponse(res, HttpStatus.NotFound, "Project not found");
  if (check.error) return void genrateResponse(res, HttpStatus.BadRequest, check.error);
  return check.project!;
}

// ============================================================
// COMMISSIONING — generation test + warranty, stage Net Metering
// ============================================================
export const saveCommissioning = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const project = await atStage(req, res, ProjectStage.COMMISSIONING);
    if (!project) return;

    const input = req.body as { commissionedOn: string; generationKwh: number; warrantyStart: string; warrantyMonths: number; notes: string | null };
    await db.$transaction([
      db.commissioning.create({
        data: {
          ...input,
          commissionedOn: new Date(input.commissionedOn),
          warrantyStart: new Date(input.warrantyStart),
          companyId: project.companyId,
          projectId: project.id,
          createdBy: req.user!.userId,
        },
      }),
      log(project.id, ProjectActivityType.COMMISSIONING, `System commissioned · generation test ${input.generationKwh} kWh · warranty ${input.warrantyMonths} months`, req.user!.userId),
      ...moveStage(project.id, ProjectStage.NET_METERING, "Moved to Net Metering", req.user!.userId),
    ]);
    return genrateResponse(res, HttpStatus.Created, "Commissioned — moved to Net Metering");
  } catch (err) {
    console.error("[SaveCommissioning]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to save commissioning");
  }
};

// ============================================================
// NET METERING — submit / resubmit → reject | meter installed → complete (100% payment)
// ============================================================
export const saveNetMetering = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const project = await atStage(req, res, ProjectStage.NET_METERING);
    if (!project) return;

    const input = req.body as NetMeteringInput;
    const existing = await db.netMetering.findUnique({ where: { projectId: project.id } });
    if (existing?.status === NetMeteringStatus.METER_INSTALLED) return genrateResponse(res, HttpStatus.BadRequest, "Meter is already installed");
    const data = { ...input, submittedOn: new Date(input.submittedOn), status: NetMeteringStatus.SUBMITTED, rejectReason: null };

    await db.$transaction([
      existing
        ? db.netMetering.update({ where: { id: existing.id }, data })
        : db.netMetering.create({ data: { ...data, companyId: project.companyId, projectId: project.id, createdBy: req.user!.userId } }),
      log(project.id, ProjectActivityType.NET_METERING, `Net metering ${existing ? "re-submitted" : "applied"} · ${input.discom} · ${input.applicationNo}`, req.user!.userId),
    ]);
    return genrateResponse(res, existing ? HttpStatus.OK : HttpStatus.Created, "Net metering application saved");
  } catch (err) {
    console.error("[SaveNetMetering]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to save net metering");
  }
};

export const rejectNetMetering = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const project = await atStage(req, res, ProjectStage.NET_METERING);
    if (!project) return;
    const nm = await db.netMetering.findUnique({ where: { projectId: project.id } });
    if (!nm || nm.status !== NetMeteringStatus.SUBMITTED) return genrateResponse(res, HttpStatus.BadRequest, "No submitted application");

    const { reason } = req.body as { reason: string };
    await db.$transaction([
      db.netMetering.update({ where: { id: nm.id }, data: { status: NetMeteringStatus.REJECTED, rejectReason: reason } }),
      log(project.id, ProjectActivityType.NET_METERING, `Net metering rejected · ${reason}`, req.user!.userId),
    ]);
    return genrateResponse(res, HttpStatus.OK, "Net metering marked as rejected");
  } catch (err) {
    console.error("[RejectNetMetering]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to update net metering");
  }
};

export const meterInstalled = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const project = await atStage(req, res, ProjectStage.NET_METERING);
    if (!project) return;
    const nm = await db.netMetering.findUnique({ where: { projectId: project.id } });
    if (!nm || nm.status !== NetMeteringStatus.SUBMITTED) return genrateResponse(res, HttpStatus.BadRequest, "Submit the net metering application first");

    const { meterNo, installedOn } = req.body as { meterNo: string; installedOn: string };
    await db.$transaction([
      db.netMetering.update({ where: { id: nm.id }, data: { status: NetMeteringStatus.METER_INSTALLED, meterNo, installedOn: new Date(installedOn) } }),
      log(project.id, ProjectActivityType.NET_METERING, `Net meter installed · ${meterNo}`, req.user!.userId),
    ]);
    return genrateResponse(res, HttpStatus.OK, "Net meter installed — collect the balance payment to continue");
  } catch (err) {
    console.error("[MeterInstalled]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to update net metering");
  }
};

// Meter lag gaya + 100% payment → Subsidy
export const completeNetMetering = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const project = await atStage(req, res, ProjectStage.NET_METERING);
    if (!project) return;
    const nm = await db.netMetering.findUnique({ where: { projectId: project.id } });
    if (nm?.status !== NetMeteringStatus.METER_INSTALLED) return genrateResponse(res, HttpStatus.BadRequest, "Net meter is not installed yet");

    const balance = round2(Number(project.contractValue ?? 0) - (await paidTotal(project.id)));
    if (balance > 0) return genrateResponse(res, HttpStatus.BadRequest, `Collect the balance payment first (${inr(balance)} pending)`);

    await db.$transaction(moveStage(project.id, ProjectStage.SUBSIDY, "Full payment received — moved to Subsidy", req.user!.userId));
    return genrateResponse(res, HttpStatus.OK, "Moved to Subsidy");
  } catch (err) {
    console.error("[CompleteNetMetering]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to move to subsidy");
  }
};

// ============================================================
// SUBSIDY — apply / re-apply → disbursed (Handover) | rejected | not applicable (Handover)
// ============================================================
export const saveSubsidy = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const project = await atStage(req, res, ProjectStage.SUBSIDY);
    if (!project) return;

    const input = req.body as SubsidyInput;
    const data = { ...input, appliedOn: new Date(input.appliedOn), status: SubsidyStatus.SUBMITTED, rejectReason: null };
    const existing = await db.subsidy.findUnique({ where: { projectId: project.id } });

    await db.$transaction([
      existing
        ? db.subsidy.update({ where: { id: existing.id }, data })
        : db.subsidy.create({ data: { ...data, companyId: project.companyId, projectId: project.id, createdBy: req.user!.userId } }),
      log(project.id, ProjectActivityType.SUBSIDY, `Subsidy ${existing ? "re-applied" : "applied"} · ${input.scheme} · ${inr(input.amount)}`, req.user!.userId),
    ]);
    return genrateResponse(res, existing ? HttpStatus.OK : HttpStatus.Created, "Subsidy application saved");
  } catch (err) {
    console.error("[SaveSubsidy]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to save subsidy");
  }
};

export const subsidyDisbursed = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const project = await atStage(req, res, ProjectStage.SUBSIDY);
    if (!project) return;
    const subsidy = await db.subsidy.findUnique({ where: { projectId: project.id } });
    if (!subsidy || subsidy.status !== SubsidyStatus.SUBMITTED) return genrateResponse(res, HttpStatus.BadRequest, "Apply for the subsidy first");

    const { disbursedAmount, disbursedOn } = req.body as { disbursedAmount: number; disbursedOn: string };
    await db.$transaction([
      db.subsidy.update({ where: { id: subsidy.id }, data: { status: SubsidyStatus.DISBURSED, disbursedAmount, disbursedOn: new Date(disbursedOn) } }),
      log(project.id, ProjectActivityType.SUBSIDY, `Subsidy disbursed · ${inr(disbursedAmount)}`, req.user!.userId),
      ...moveStage(project.id, ProjectStage.HANDOVER, "Moved to Handover", req.user!.userId),
    ]);
    return genrateResponse(res, HttpStatus.OK, "Subsidy disbursed — moved to Handover");
  } catch (err) {
    console.error("[SubsidyDisbursed]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to update subsidy");
  }
};

export const rejectSubsidy = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const project = await atStage(req, res, ProjectStage.SUBSIDY);
    if (!project) return;
    const subsidy = await db.subsidy.findUnique({ where: { projectId: project.id } });
    if (!subsidy || subsidy.status !== SubsidyStatus.SUBMITTED) return genrateResponse(res, HttpStatus.BadRequest, "No submitted application");

    const { reason } = req.body as { reason: string };
    await db.$transaction([
      db.subsidy.update({ where: { id: subsidy.id }, data: { status: SubsidyStatus.REJECTED, rejectReason: reason } }),
      log(project.id, ProjectActivityType.SUBSIDY, `Subsidy rejected · ${reason}`, req.user!.userId),
    ]);
    return genrateResponse(res, HttpStatus.OK, "Subsidy marked as rejected");
  } catch (err) {
    console.error("[RejectSubsidy]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to update subsidy");
  }
};

// Subsidy nahi milegi / nahi chahiye → seedha Handover
export const skipSubsidy = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const project = await atStage(req, res, ProjectStage.SUBSIDY);
    if (!project) return;
    const { reason } = req.body as { reason: string };
    const existing = await db.subsidy.findUnique({ where: { projectId: project.id } });
    if (existing?.status === SubsidyStatus.SUBMITTED) return genrateResponse(res, HttpStatus.BadRequest, "Application is pending — mark it disbursed or rejected first");

    const data = { status: SubsidyStatus.NOT_APPLICABLE, rejectReason: reason };
    await db.$transaction([
      existing
        ? db.subsidy.update({ where: { id: existing.id }, data })
        : db.subsidy.create({ data: { ...data, scheme: "None", companyId: project.companyId, projectId: project.id, createdBy: req.user!.userId } }),
      log(project.id, ProjectActivityType.SUBSIDY, `Subsidy not applicable · ${reason}`, req.user!.userId),
      ...moveStage(project.id, ProjectStage.HANDOVER, "Moved to Handover", req.user!.userId),
    ]);
    return genrateResponse(res, HttpStatus.OK, "Subsidy skipped — moved to Handover");
  } catch (err) {
    console.error("[SkipSubsidy]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to skip subsidy");
  }
};

// ============================================================
// HANDOVER — project COMPLETED
// ============================================================
export const saveHandover = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const project = await atStage(req, res, ProjectStage.HANDOVER);
    if (!project) return;
    if (await db.handover.findUnique({ where: { projectId: project.id } })) return genrateResponse(res, HttpStatus.Conflict, "Already handed over");

    const { handoverDate, receivedBy, notes } = req.body as { handoverDate: string; receivedBy: string; notes: string | null };
    await db.$transaction([
      db.handover.create({
        data: { handoverDate: new Date(handoverDate), receivedBy, notes, companyId: project.companyId, projectId: project.id, createdBy: req.user!.userId },
      }),
      db.project.update({ where: { id: project.id }, data: { status: ProjectStatus.COMPLETED } }),
      log(project.id, ProjectActivityType.HANDOVER, `Handed over to ${receivedBy} — project completed`, req.user!.userId),
    ]);
    return genrateResponse(res, HttpStatus.OK, "Project handed over and completed 🎉");
  } catch (err) {
    console.error("[SaveHandover]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to save handover");
  }
};
