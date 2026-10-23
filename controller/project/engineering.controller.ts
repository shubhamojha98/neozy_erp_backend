import { Response } from "express";
import { EngineeringStatus, ProjectActivityType, ProjectStage, ProjectStatus } from "../../generated/project/client";
import { project as db } from "../../lib/globalprimsaclient";
import genrateResponse from "../../lib/generateResponse";
import HttpStatus from "../../lib/httpStatus";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { getScope, NO_COMPANY } from "../../dal/scope.dal";
import { findProject, moveStage } from "../../dal/project.dal";
import { EngineeringInput } from "../../validations/project.validation";
import { hasDocument } from "../../dal/document.dal";

// Engineering: design save (draft, baar baar) → approve (capacity final, stage QUOTATION)
// URL: /api/project/:id/engineering ...

// panel × watt → kW, 2 decimal tak (11 × 545 W = 5995 W → 6 kW)
const systemKw = (input: EngineeringInput) => Math.round((input.panelCount * input.panelWattage) / 10) / 100;

// ============================================================
// SAVE — naya ya update (approve ke baad nahi)
// ============================================================
export const saveEngineering = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const project = await findProject(scope, Number(req.params.id));
    if (!project) return genrateResponse(res, HttpStatus.NotFound, "Project not found");
    if (project.status !== ProjectStatus.ACTIVE) return genrateResponse(res, HttpStatus.BadRequest, "Project is not active");
    if (project.stage !== ProjectStage.ENGINEERING) {
      return genrateResponse(res, HttpStatus.BadRequest, project.stage === ProjectStage.SURVEY ? "Complete the survey first" : "Design is already approved");
    }

    const input = req.body as EngineeringInput;
    const data = { ...input, systemKw: systemKw(input) };
    const existing = await db.engineeringDesign.findUnique({ where: { projectId: project.id } });

    const design = existing
      ? await db.engineeringDesign.update({ where: { id: existing.id }, data })
      : await db.engineeringDesign.create({ data: { ...data, companyId: project.companyId, projectId: project.id, createdBy: req.user!.userId } });

    await db.projectActivity.create({
      data: {
        projectId: project.id,
        type: ProjectActivityType.ENGINEERING,
        message: `Design ${existing ? "updated" : "created"} · ${input.panelCount} × ${input.panelWattage} W = ${data.systemKw} kW`,
        createdBy: req.user!.userId,
      },
    });
    return genrateResponse(res, existing ? HttpStatus.OK : HttpStatus.Created, "Design saved", design);
  } catch (err) {
    console.error("[SaveEngineering]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to save design");
  }
};

// ============================================================
// APPROVE — project capacity = design kW, stage QUOTATION
// ============================================================
export const approveEngineering = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const project = await findProject(scope, Number(req.params.id));
    if (!project) return genrateResponse(res, HttpStatus.NotFound, "Project not found");
    if (project.status !== ProjectStatus.ACTIVE) return genrateResponse(res, HttpStatus.BadRequest, "Project is not active");
    if (project.stage !== ProjectStage.ENGINEERING) return genrateResponse(res, HttpStatus.BadRequest, "Project is not in Engineering stage");

    const design = await db.engineeringDesign.findUnique({ where: { projectId: project.id } });
    if (!design) return genrateResponse(res, HttpStatus.BadRequest, "Save the design first");
    if (!(await hasDocument({ projectId: project.id }, "Single Line Diagram"))) return genrateResponse(res, HttpStatus.BadRequest, "Upload the single line diagram first");

    await db.$transaction([
      db.engineeringDesign.update({
        where: { id: design.id },
        data: { status: EngineeringStatus.APPROVED, approvedBy: req.user!.userId, approvedAt: new Date() },
      }),
      db.project.update({ where: { id: project.id }, data: { capacityKw: design.systemKw } }),
      db.projectActivity.create({
        data: { projectId: project.id, type: ProjectActivityType.ENGINEERING, message: `Design approved · ${design.systemKw} kW`, createdBy: req.user!.userId },
      }),
      ...moveStage(project.id, ProjectStage.QUOTATION, "Moved to Quotation", req.user!.userId),
    ]);
    return genrateResponse(res, HttpStatus.OK, "Design approved — moved to Quotation");
  } catch (err) {
    console.error("[ApproveEngineering]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to approve design");
  }
};
