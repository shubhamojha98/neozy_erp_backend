import { Response } from "express";
import { ProjectActivityType, ProjectStage, ProjectStatus, SurveyStatus } from "../../generated/project/client";
import { project as db } from "../../lib/globalprimsaclient";
import genrateResponse from "../../lib/generateResponse";
import HttpStatus from "../../lib/httpStatus";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { getScope, isCompanyUser, NO_COMPANY, userNames } from "../../dal/scope.dal";
import { findProject, moveStage } from "../../dal/project.dal";
import { SurveyReportInput } from "../../validations/project.validation";
import { hasDocument } from "../../dal/document.dal";

// Survey: schedule → report bhar ke complete (stage ENGINEERING) | cancel → dobara schedule
// URL: /api/project/:id/survey ...

const surveyOf = (projectId: number, surveyId: number) => db.survey.findFirst({ where: { id: surveyId, projectId } });

// ============================================================
// SCHEDULE — surveyor + date. Ek time par ek hi scheduled survey.
// ============================================================
export const scheduleSurvey = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const project = await findProject(scope, Number(req.params.id));
    if (!project) return genrateResponse(res, HttpStatus.NotFound, "Project not found");
    if (project.status !== ProjectStatus.ACTIVE) return genrateResponse(res, HttpStatus.BadRequest, "Project is not active");
    if (project.stage !== ProjectStage.SURVEY) return genrateResponse(res, HttpStatus.BadRequest, "Survey is already done for this project");

    const pending = await db.survey.findFirst({ where: { projectId: project.id, status: SurveyStatus.SCHEDULED } });
    if (pending) return genrateResponse(res, HttpStatus.Conflict, "A survey is already scheduled — complete or cancel it first");

    const { surveyorId, scheduledAt } = req.body as { surveyorId: number; scheduledAt: Date };
    if (!(await isCompanyUser(project.companyId, surveyorId))) return genrateResponse(res, HttpStatus.BadRequest, "Select a valid surveyor");

    const surveyorName = (await userNames([surveyorId])).get(surveyorId);
    const when = scheduledAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
    const [survey] = await db.$transaction([
      db.survey.create({ data: { companyId: project.companyId, projectId: project.id, surveyorId, scheduledAt, createdBy: req.user!.userId } }),
      db.project.update({ where: { id: project.id }, data: { surveyorId } }),
      db.projectActivity.create({
        data: { projectId: project.id, type: ProjectActivityType.SURVEY, message: `Survey scheduled for ${when} · ${surveyorName}`, createdBy: req.user!.userId },
      }),
    ]);
    return genrateResponse(res, HttpStatus.Created, "Survey scheduled", survey);
  } catch (err) {
    console.error("[ScheduleSurvey]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to schedule survey");
  }
};

// ============================================================
// COMPLETE — report save + project stage ENGINEERING
// ============================================================
export const completeSurvey = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const project = await findProject(scope, Number(req.params.id));
    if (!project) return genrateResponse(res, HttpStatus.NotFound, "Project not found");
    if (project.status !== ProjectStatus.ACTIVE) return genrateResponse(res, HttpStatus.BadRequest, "Project is not active");

    const survey = await surveyOf(project.id, Number(req.params.surveyId));
    if (!survey) return genrateResponse(res, HttpStatus.NotFound, "Survey not found");
    if (survey.status !== SurveyStatus.SCHEDULED) return genrateResponse(res, HttpStatus.BadRequest, "Only a scheduled survey can be completed");

    // Purane app jaisa: kam se kam ek site photo zaroori
    if (!(await hasDocument({ projectId: project.id }, "Site Photo"))) return genrateResponse(res, HttpStatus.BadRequest, "Upload at least one site photo");

    const report = req.body as SurveyReportInput;
    await db.$transaction([
      db.survey.update({
        where: { id: survey.id },
        data: { ...report, status: SurveyStatus.COMPLETED, completedAt: new Date(), completedBy: req.user!.userId },
      }),
      db.projectActivity.create({
        data: {
          projectId: project.id,
          type: ProjectActivityType.SURVEY,
          message: `Survey completed · ${report.roofType}, ${report.roofAreaSqft} sq ft · recommended ${report.recommendedKw} kW`,
          createdBy: req.user!.userId,
        },
      }),
      ...moveStage(project.id, ProjectStage.ENGINEERING, "Moved to Engineering", req.user!.userId),
    ]);
    return genrateResponse(res, HttpStatus.OK, "Survey completed — moved to Engineering");
  } catch (err) {
    console.error("[CompleteSurvey]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to complete survey");
  }
};

// ============================================================
// CANCEL — reason ke saath, phir naya schedule ho sakta hai
// ============================================================
export const cancelSurvey = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const project = await findProject(scope, Number(req.params.id));
    if (!project) return genrateResponse(res, HttpStatus.NotFound, "Project not found");

    const survey = await surveyOf(project.id, Number(req.params.surveyId));
    if (!survey) return genrateResponse(res, HttpStatus.NotFound, "Survey not found");
    if (survey.status !== SurveyStatus.SCHEDULED) return genrateResponse(res, HttpStatus.BadRequest, "Only a scheduled survey can be cancelled");

    const { reason } = req.body as { reason: string };
    await db.$transaction([
      db.survey.update({ where: { id: survey.id }, data: { status: SurveyStatus.CANCELLED, cancelReason: reason } }),
      db.projectActivity.create({
        data: { projectId: project.id, type: ProjectActivityType.SURVEY, message: `Survey cancelled · ${reason}`, createdBy: req.user!.userId },
      }),
    ]);
    return genrateResponse(res, HttpStatus.OK, "Survey cancelled");
  } catch (err) {
    console.error("[CancelSurvey]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to cancel survey");
  }
};
