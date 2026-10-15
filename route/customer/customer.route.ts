import { Router } from "express";
import {
  addCustomer,
  assignCustomer,
  deleteCustomers,
  getCustomer,
  getCustomerMeta,
  listCustomers,
  updateCustomer,
} from "../../controller/customer/customer.controller";
import { deleteDocument, getDocumentFile, listDocuments, uploadDocument } from "../../controller/document/document.controller";
import { requirePermission } from "../../middleware/authMiddleware";
import { documentUpload } from "../../middleware/documentUpload";
import { validate } from "../../middleware/validate";
import { uploadDocumentSchema } from "../../validations/document.validation";
import { assignCustomerSchema, bulkDeleteSchema, customerSchema } from "../../validations/customer.validation";

const router = Router();

router.get("/meta", requirePermission("sales.customers.view"), getCustomerMeta);
router.get("/", requirePermission("sales.customers.view"), listCustomers);
router.get("/:id", requirePermission("sales.customers.view"), getCustomer);
router.post("/", requirePermission("sales.customers.create"), validate(customerSchema), addCustomer);
router.post("/bulk-delete", requirePermission("sales.customers.delete"), validate(bulkDeleteSchema), deleteCustomers);
router.put("/:id", requirePermission("sales.customers.edit"), validate(customerSchema), updateCustomer);
router.post("/:id/assign", requirePermission("sales.customers.edit"), validate(assignCustomerSchema), assignCustomer);
router.delete("/:id", requirePermission("sales.customers.delete"), deleteCustomers);

// Documents (Aadhaar, bill, photo ...)
router.get("/:id/documents", requirePermission("sales.customers.view"), listDocuments("customer"));
router.post("/:id/documents", requirePermission("sales.customers.edit"), documentUpload, validate(uploadDocumentSchema), uploadDocument("customer"));
router.get("/:id/documents/:docId/file", requirePermission("sales.customers.view"), getDocumentFile("customer"));
router.delete("/:id/documents/:docId", requirePermission("sales.customers.edit"), deleteDocument("customer"));

export default router;
