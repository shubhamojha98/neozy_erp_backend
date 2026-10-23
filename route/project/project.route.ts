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
import { acceptQuotation, createQuotation, listQuotationProducts, setQuotationStatus, updateQuotation } from "../../controller/project/quotation.controller";
import { rejectLoan, sanctionLoan, saveLoan, switchToCash } from "../../controller/project/loan.controller";
import { approveRegistration, rejectRegistration, saveRegistration } from "../../controller/project/registration.controller";
import { addPayment, createInvoice, createOrder, deletePayment } from "../../controller/project/billing.controller";
import { addSerials, completeInstallation, deliverDispatch, removeSerial, saveDispatch, scheduleInstallation, submitQc } from "../../controller/project/execution.controller";
import {
  completeNetMetering,
  meterInstalled,
  rejectNetMetering,
  rejectSubsidy,
  saveCommissioning,
  saveHandover,
  saveNetMetering,
  saveSubsidy,
  skipSubsidy,
  subsidyDisbursed,
} from "../../controller/project/closing.controller";
import { deleteDocument, getDocumentFile, listDocuments, uploadDocument } from "../../controller/document/document.controller";
import { requirePermission } from "../../middleware/authMiddleware";
import { validId } from "../../middleware/validId";
import { documentUpload } from "../../middleware/documentUpload";
import { validate } from "../../middleware/validate";
import { uploadDocumentSchema } from "../../validations/document.validation";
import {
  commissioningSchema,
  deliverSchema,
  disbursedSchema,
  dispatchSchema,
  handoverSchema,
  installationSchema,
  meterInstalledSchema,
  netMeteringSchema,
  qcSchema,
  serialsSchema,
  subsidySchema,
  acceptQuotationSchema,
  loanSchema,
  paymentSchema,
  quotationSchema,
  reasonSchema,
  registrationSchema,
  sanctionSchema,
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
["id", "docId", "paymentId", "quotationId", "serialId", "surveyId"].forEach((name) => router.param(name, validId)); // galat id → 404
const VIEW = requirePermission("projects.projects.view");
const EDIT = requirePermission("projects.projects.edit");

router.get("/meta", VIEW, getProjectMeta);
router.get("/products", VIEW, listQuotationProducts); // quotation item picker
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

// Quotation
router.post("/:id/quotations", EDIT, validate(quotationSchema), createQuotation);
router.put("/:id/quotations/:quotationId", EDIT, validate(quotationSchema), updateQuotation);
router.post("/:id/quotations/:quotationId/sent", EDIT, setQuotationStatus("SENT"));
router.post("/:id/quotations/:quotationId/reject", EDIT, validate(reasonSchema), setQuotationStatus("REJECTED"));
router.post("/:id/quotations/:quotationId/accept", EDIT, validate(acceptQuotationSchema), acceptQuotation);

// Bank Loan
router.put("/:id/loan", EDIT, validate(loanSchema), saveLoan);
router.post("/:id/loan/sanction", EDIT, validate(sanctionSchema), sanctionLoan);
router.post("/:id/loan/reject", EDIT, validate(reasonSchema), rejectLoan);
router.post("/:id/loan/switch-cash", EDIT, switchToCash);

// Registration
router.put("/:id/registration", EDIT, validate(registrationSchema), saveRegistration);
router.post("/:id/registration/approve", EDIT, approveRegistration);
router.post("/:id/registration/reject", EDIT, validate(reasonSchema), rejectRegistration);

// Invoice, Payments, Order
router.post("/:id/invoice", EDIT, createInvoice);
router.post("/:id/payments", EDIT, validate(paymentSchema), addPayment);
router.delete("/:id/payments/:paymentId", EDIT, deletePayment);
router.post("/:id/order", EDIT, createOrder);

// Dispatch, serials, Installation, QC
router.put("/:id/dispatch", EDIT, validate(dispatchSchema), saveDispatch);
router.post("/:id/dispatch/deliver", EDIT, validate(deliverSchema), deliverDispatch);
router.post("/:id/serials", EDIT, validate(serialsSchema), addSerials);
router.delete("/:id/serials/:serialId", EDIT, removeSerial);
router.put("/:id/installation", EDIT, validate(installationSchema), scheduleInstallation);
router.post("/:id/installation/complete", EDIT, completeInstallation);
router.post("/:id/qc", EDIT, validate(qcSchema), submitQc);

// Commissioning, Net Metering, Subsidy, Handover
router.post("/:id/commissioning", EDIT, validate(commissioningSchema), saveCommissioning);
router.put("/:id/net-metering", EDIT, validate(netMeteringSchema), saveNetMetering);
router.post("/:id/net-metering/reject", EDIT, validate(reasonSchema), rejectNetMetering);
router.post("/:id/net-metering/installed", EDIT, validate(meterInstalledSchema), meterInstalled);
router.post("/:id/net-metering/complete", EDIT, completeNetMetering);
router.put("/:id/subsidy", EDIT, validate(subsidySchema), saveSubsidy);
router.post("/:id/subsidy/disbursed", EDIT, validate(disbursedSchema), subsidyDisbursed);
router.post("/:id/subsidy/reject", EDIT, validate(reasonSchema), rejectSubsidy);
router.post("/:id/subsidy/skip", EDIT, validate(reasonSchema), skipSubsidy);
router.post("/:id/handover", EDIT, validate(handoverSchema), saveHandover);

// Documents (site photo, drawings ...)
router.get("/:id/documents", VIEW, listDocuments("project"));
router.post("/:id/documents", EDIT, documentUpload, validate(uploadDocumentSchema), uploadDocument("project"));
router.get("/:id/documents/:docId/file", VIEW, getDocumentFile("project"));
router.delete("/:id/documents/:docId", EDIT, deleteDocument("project"));

export default router;
