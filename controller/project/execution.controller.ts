import { Response } from "express";
import { DispatchStatus, InstallationStatus, ProjectActivityType, ProjectStage, ProjectStatus, QcStatus, SerialType } from "../../generated/project/client";
import { project as db } from "../../lib/globalprimsaclient";
import genrateResponse from "../../lib/generateResponse";
import HttpStatus from "../../lib/httpStatus";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { getScope, isCompanyUser, NO_COMPANY, userNames } from "../../dal/scope.dal";
import { createWithCode, findProject, moveStage, projectAtStage } from "../../dal/project.dal";
import { DispatchInput } from "../../validations/project.validation";

// Dispatch → Installation → QC. Panel / inverter serial Dispatch par, warna Installation / QC par.
// URL: /api/project/:id/dispatch | /serials | /installation | /qc

const log = (projectId: number, type: ProjectActivityType, message: string, userId: number) =>
  db.projectActivity.create({ data: { projectId, type, message, createdBy: userId } });

// Serial in stages me jud / hat sakte hain
const SERIAL_STAGES: ProjectStage[] = [ProjectStage.DISPATCH, ProjectStage.INSTALLATION, ProjectStage.QC];

// ============================================================
// DISPATCH — vehicle / driver. Ek project ka ek dispatch (edit ho sakta hai jab tak deliver nahi)
// ============================================================
export const saveDispatch = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const check = await projectAtStage(scope, Number(req.params.id), ProjectStage.DISPATCH);
    if (check.notFound) return genrateResponse(res, HttpStatus.NotFound, "Project not found");
    if (check.error) return genrateResponse(res, HttpStatus.BadRequest, check.error);
    const project = check.project!;

    const input = req.body as DispatchInput;
    const data = { ...input, dispatchDate: new Date(input.dispatchDate) };
    const existing = await db.dispatch.findUnique({ where: { projectId: project.id } });

    if (existing) {
      await db.$transaction([
        db.dispatch.update({ where: { id: existing.id }, data }),
        log(project.id, ProjectActivityType.DISPATCH, `Dispatch ${existing.dispatchNo} updated · ${input.vehicleNo}`, req.user!.userId),
      ]);
      return genrateResponse(res, HttpStatus.OK, "Dispatch updated");
    }

    const dispatch = (await createWithCode("DSP", project.companyId, (dispatchNo) =>
      db.dispatch.create({ data: { ...data, dispatchNo, companyId: project.companyId, projectId: project.id, createdBy: req.user!.userId } }),
    )) as { dispatchNo: string };
    await log(project.id, ProjectActivityType.DISPATCH, `Material dispatched · ${dispatch.dispatchNo} · ${input.vehicleNo}`, req.user!.userId);
    return genrateResponse(res, HttpStatus.Created, "Dispatch saved", dispatch);
  } catch (err) {
    console.error("[SaveDispatch]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to save dispatch");
  }
};

// DELIVERED — site par pahunch gaya, stage Installation
export const deliverDispatch = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const check = await projectAtStage(scope, Number(req.params.id), ProjectStage.DISPATCH);
    if (check.notFound) return genrateResponse(res, HttpStatus.NotFound, "Project not found");
    if (check.error) return genrateResponse(res, HttpStatus.BadRequest, check.error);
    const project = check.project!;

    const dispatch = await db.dispatch.findUnique({ where: { projectId: project.id } });
    if (!dispatch) return genrateResponse(res, HttpStatus.BadRequest, "Save the dispatch details first");

    const { receivedBy } = req.body as { receivedBy: string };
    await db.$transaction([
      db.dispatch.update({ where: { id: dispatch.id }, data: { status: DispatchStatus.DELIVERED, deliveredAt: new Date(), receivedBy } }),
      log(project.id, ProjectActivityType.DISPATCH, `Material delivered at site · received by ${receivedBy}`, req.user!.userId),
      ...moveStage(project.id, ProjectStage.INSTALLATION, "Moved to Installation", req.user!.userId),
    ]);
    return genrateResponse(res, HttpStatus.OK, "Delivered — moved to Installation");
  } catch (err) {
    console.error("[DeliverDispatch]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to mark delivered");
  }
};

// ============================================================
// SERIALS — add (bulk) / remove. Panel count design se zyada nahi. Ek serial do jagah nahi.
// ============================================================
export const addSerials = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const project = await findProject(scope, Number(req.params.id));
    if (!project) return genrateResponse(res, HttpStatus.NotFound, "Project not found");
    if (project.status !== ProjectStatus.ACTIVE) return genrateResponse(res, HttpStatus.BadRequest, "Project is not active");
    if (!SERIAL_STAGES.includes(project.stage)) return genrateResponse(res, HttpStatus.BadRequest, "Serials can be added during Dispatch, Installation or QC");

    const { type, serials } = req.body as { type: SerialType; serials: string[] };

    // Pehle se kahin use hua?
    const used = await db.equipmentSerial.findMany({
      where: { companyId: project.companyId, serialNo: { in: serials } },
      select: { serialNo: true, project: { select: { projectCode: true } } },
    });
    if (used.length) {
      const list = used.slice(0, 5).map((u) => `${u.serialNo} (${u.project.projectCode})`).join(", ");
      return genrateResponse(res, HttpStatus.Conflict, `Already recorded: ${list}`);
    }

    if (type === SerialType.PANEL) {
      const design = await db.engineeringDesign.findUnique({ where: { projectId: project.id }, select: { panelCount: true } });
      const have = await db.equipmentSerial.count({ where: { projectId: project.id, type: SerialType.PANEL } });
      if (design && have + serials.length > design.panelCount) {
        return genrateResponse(res, HttpStatus.BadRequest, `Design has ${design.panelCount} panels — ${have} already recorded, ${design.panelCount - have} left`);
      }
    }

    await db.$transaction([
      db.equipmentSerial.createMany({
        data: serials.map((serialNo) => ({ companyId: project.companyId, projectId: project.id, type, serialNo, stage: project.stage, createdBy: req.user!.userId })),
      }),
      log(project.id, ProjectActivityType.DISPATCH, `${serials.length} ${type === SerialType.PANEL ? "panel" : "inverter"} serial(s) recorded`, req.user!.userId),
    ]);
    return genrateResponse(res, HttpStatus.Created, `${serials.length} serial(s) added`);
  } catch (err) {
    console.error("[AddSerials]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to add serials");
  }
};

export const removeSerial = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const project = await findProject(scope, Number(req.params.id));
    if (!project) return genrateResponse(res, HttpStatus.NotFound, "Project not found");
    if (!SERIAL_STAGES.includes(project.stage)) return genrateResponse(res, HttpStatus.BadRequest, "Serials are locked after QC");

    const serial = await db.equipmentSerial.findFirst({ where: { id: Number(req.params.serialId), projectId: project.id } });
    if (!serial) return genrateResponse(res, HttpStatus.NotFound, "Serial not found");

    await db.$transaction([
      db.equipmentSerial.delete({ where: { id: serial.id } }),
      log(project.id, ProjectActivityType.DISPATCH, `Serial removed · ${serial.serialNo}`, req.user!.userId),
    ]);
    return genrateResponse(res, HttpStatus.OK, "Serial removed");
  } catch (err) {
    console.error("[RemoveSerial]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to remove serial");
  }
};

// ============================================================
// INSTALLATION — installer + date (schedule / reschedule) → complete (stage QC)
// ============================================================
export const scheduleInstallation = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const check = await projectAtStage(scope, Number(req.params.id), ProjectStage.INSTALLATION);
    if (check.notFound) return genrateResponse(res, HttpStatus.NotFound, "Project not found");
    if (check.error) return genrateResponse(res, HttpStatus.BadRequest, check.error);
    const project = check.project!;

    const { installerId, scheduledDate, notes } = req.body as { installerId: number; scheduledDate: string; notes: string | null };
    if (!(await isCompanyUser(project.companyId, installerId))) return genrateResponse(res, HttpStatus.BadRequest, "Select a valid installer");

    const data = { installerId, scheduledDate: new Date(scheduledDate), notes };
    const existing = await db.installation.findUnique({ where: { projectId: project.id } });
    const installer = (await userNames([installerId])).get(installerId);

    await db.$transaction([
      existing
        ? db.installation.update({ where: { id: existing.id }, data })
        : db.installation.create({ data: { ...data, companyId: project.companyId, projectId: project.id, createdBy: req.user!.userId } }),
      db.project.update({ where: { id: project.id }, data: { installerId } }),
      log(project.id, ProjectActivityType.INSTALLATION, `Installation ${existing ? "rescheduled" : "scheduled"} for ${new Date(scheduledDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} · ${installer}`, req.user!.userId),
    ]);
    return genrateResponse(res, existing ? HttpStatus.OK : HttpStatus.Created, "Installation scheduled");
  } catch (err) {
    console.error("[ScheduleInstallation]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to schedule installation");
  }
};

export const completeInstallation = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const check = await projectAtStage(scope, Number(req.params.id), ProjectStage.INSTALLATION);
    if (check.notFound) return genrateResponse(res, HttpStatus.NotFound, "Project not found");
    if (check.error) return genrateResponse(res, HttpStatus.BadRequest, check.error);
    const project = check.project!;

    const installation = await db.installation.findUnique({ where: { projectId: project.id } });
    if (!installation) return genrateResponse(res, HttpStatus.BadRequest, "Schedule the installation first");

    await db.$transaction([
      db.installation.update({ where: { id: installation.id }, data: { status: InstallationStatus.COMPLETED, completedAt: new Date() } }),
      log(project.id, ProjectActivityType.INSTALLATION, "Installation completed", req.user!.userId),
      ...moveStage(project.id, ProjectStage.QC, "Moved to QC", req.user!.userId),
    ]);
    return genrateResponse(res, HttpStatus.OK, "Installation completed — moved to QC");
  } catch (err) {
    console.error("[CompleteInstallation]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to complete installation");
  }
};

// ============================================================
// QC — checklist. Sab OK + saare panel serial + inverter serial → PASSED (stage Commissioning). Warna FAILED record.
// ============================================================
export const submitQc = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const check = await projectAtStage(scope, Number(req.params.id), ProjectStage.QC);
    if (check.notFound) return genrateResponse(res, HttpStatus.NotFound, "Project not found");
    if (check.error) return genrateResponse(res, HttpStatus.BadRequest, check.error);
    const project = check.project!;

    const { items, remarks } = req.body as { items: { item: string; passed: boolean }[]; remarks: string | null };
    const allOk = items.every((i) => i.passed);

    // Serial pure hone chahiye (haath wala note: dispatch par nahi hua to yahan tak ho jaye)
    if (allOk) {
      const [design, panels, inverters] = await Promise.all([
        db.engineeringDesign.findUnique({ where: { projectId: project.id }, select: { panelCount: true } }),
        db.equipmentSerial.count({ where: { projectId: project.id, type: SerialType.PANEL } }),
        db.equipmentSerial.count({ where: { projectId: project.id, type: SerialType.INVERTER } }),
      ]);
      if (design && panels < design.panelCount) {
        return genrateResponse(res, HttpStatus.BadRequest, `Record all panel serials before passing QC (${panels} of ${design.panelCount})`);
      }
      if (!inverters) return genrateResponse(res, HttpStatus.BadRequest, "Record the inverter serial before passing QC");
    }

    const passedCount = items.filter((i) => i.passed).length;
    await db.$transaction([
      db.qualityCheck.create({
        data: { companyId: project.companyId, projectId: project.id, items, status: allOk ? QcStatus.PASSED : QcStatus.FAILED, remarks, checkedBy: req.user!.userId },
      }),
      log(project.id, ProjectActivityType.QC, `QC ${allOk ? "passed" : "failed"} · ${passedCount}/${items.length} OK${remarks ? ` · ${remarks}` : ""}`, req.user!.userId),
      ...(allOk ? moveStage(project.id, ProjectStage.COMMISSIONING, "Moved to Commissioning", req.user!.userId) : []),
    ]);
    return genrateResponse(res, HttpStatus.OK, allOk ? "QC passed — moved to Commissioning" : "QC failed — fix the issues and check again");
  } catch (err) {
    console.error("[SubmitQc]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to save QC");
  }
};
