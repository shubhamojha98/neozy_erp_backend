import { Router } from "express";
import {
  addProjectNote,
  createProject,
  deleteProject,
  getProject,
  getProjectMeta,
  listProjects,
  setProjectStatus,
  updateProject,
} from "../../controller/project/project.controller";
import { cancelSurvey, completeSurvey, scheduleSurvey } from "../../controller/project/survey.controller";
import { approveEngineering, saveEngineering } from "../../controller/project/engineering.controller";
import { deleteDocument, getDocumentFile, listDocuments, uploadDocument } from "../../controller/document/document.controller";
import { requirePermission } from "../../middleware/authMiddleware";
import { documentUpload } from "../../middleware/documentUpload";
import { validate } from "../../middleware/validate";
import { uploadDocumentSchema } from "../../validations/document.validation";
import {
  cancelSurveySchema,
  createProjectSchema,
  engineeringSchema,
  projectNoteSchema,
  projectSchema,
  projectStatusSchema,
  scheduleSurveySchema,
  surveyReportSchema,
} from "../../validations/project.validation";

const router = Router();
const VIEW = requirePermission("projects.projects.view");
const EDIT = requirePermission("projects.projects.edit");

router.get("/meta", VIEW, getProjectMeta);
router.get("/", VIEW, listProjects);
router.get("/:id", VIEW, getProject);
router.post("/", requirePermission("projects.projects.create"), validate(createProjectSchema), createProject);
router.put("/:id", EDIT, validate(projectSchema), updateProject);
router.post("/:id/status", EDIT, validate(projectStatusSchema), setProjectStatus);
router.post("/:id/notes", EDIT, validate(projectNoteSchema), addProjectNote);
router.delete("/:id", requirePermission("projects.projects.delete"), deleteProject);

// Survey
router.post("/:id/survey", EDIT, validate(scheduleSurveySchema), scheduleSurvey);
router.post("/:id/survey/:surveyId/complete", EDIT, validate(surveyReportSchema), completeSurvey);
router.post("/:id/survey/:surveyId/cancel", EDIT, validate(cancelSurveySchema), cancelSurvey);

// Engineering
router.put("/:id/engineering", EDIT, validate(engineeringSchema), saveEngineering);
router.post("/:id/engineering/approve", EDIT, approveEngineering);

// Documents (site photo, drawings ...)
router.get("/:id/documents", VIEW, listDocuments("project"));
router.post("/:id/documents", EDIT, documentUpload, validate(uploadDocumentSchema), uploadDocument("project"));
router.get("/:id/documents/:docId/file", VIEW, getDocumentFile("project"));
router.delete("/:id/documents/:docId", EDIT, deleteDocument("project"));

export default router;
