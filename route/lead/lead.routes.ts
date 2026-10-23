import { Router } from "express";
import {
  addNote,
  assignLead,
  convertLead,
  createLead,
  deleteLead,
  getLead,
  getLeadMeta,
  listLeads,
  logCall,
  markLost,
  updateLead,
} from "../../controller/lead/lead.controller";
import { deleteDocument, getDocumentFile, listDocuments, uploadDocument } from "../../controller/document/document.controller";
import { requirePermission } from "../../middleware/authMiddleware";
import { validId } from "../../middleware/validId";
import { documentUpload } from "../../middleware/documentUpload";
import { validate } from "../../middleware/validate";
import { uploadDocumentSchema } from "../../validations/document.validation";
import { assignLeadSchema, callSchema, leadSchema, lostSchema, noteSchema } from "../../validations/lead.validation";
import { customerSchema } from "../../validations/customer.validation";

const router = Router();
["id", "docId"].forEach((name) => router.param(name, validId)); // galat id → 404

router.get("/meta", requirePermission("leads.leads.view"), getLeadMeta);
router.get("/", requirePermission("leads.leads.view"), listLeads);
router.get("/:id", requirePermission("leads.leads.view"), getLead);
router.post("/", requirePermission("leads.leads.create"), validate(leadSchema), createLead);
router.put("/:id", requirePermission("leads.leads.edit"), validate(leadSchema), updateLead);
router.delete("/:id", requirePermission("leads.leads.delete"), deleteLead);

router.post("/:id/call", requirePermission("leads.followups.create"), validate(callSchema), logCall);
router.post("/:id/notes", requirePermission("leads.followups.create"), validate(noteSchema), addNote);
router.post("/:id/assign", requirePermission("leads.leads.assign"), validate(assignLeadSchema), assignLead);
router.post("/:id/lost", requirePermission("leads.leads.edit"), validate(lostSchema), markLost);
router.post("/:id/convert", requirePermission("leads.leads.edit", "sales.customers.create"), validate(customerSchema), convertLead);

// Documents (Aadhaar, bill, photo ...)
router.get("/:id/documents", requirePermission("leads.leads.view"), listDocuments("lead"));
router.post("/:id/documents", requirePermission("leads.leads.edit"), documentUpload, validate(uploadDocumentSchema), uploadDocument("lead"));
router.get("/:id/documents/:docId/file", requirePermission("leads.leads.view"), getDocumentFile("lead"));
router.delete("/:id/documents/:docId", requirePermission("leads.leads.edit"), deleteDocument("lead"));

export default router;
