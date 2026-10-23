import { Router } from "express";
import { addSalesOrderNote, cancelSalesOrder, createSalesOrder, getSalesOrder, getSalesOrderMeta, listSalesOrders } from "../../controller/sales-order/sales-order.controller";
import {
  acceptOrderQuotation,
  addOrderPayment,
  confirmSalesOrder,
  createOrderInvoice,
  createOrderQuotation,
  deleteOrderPayment,
  deliverSalesOrder,
  saveOrderDispatch,
  setOrderQuotationStatus,
  updateOrderQuotation,
} from "../../controller/sales-order/order-flow.controller";
import { listQuotationProducts } from "../../controller/project/quotation.controller";
import { deleteDocument, getDocumentFile, listDocuments, uploadDocument } from "../../controller/document/document.controller";
import { requirePermission } from "../../middleware/authMiddleware";
import { documentUpload } from "../../middleware/documentUpload";
import { validate } from "../../middleware/validate";
import { validId } from "../../middleware/validId";
import { deliverSchema, dispatchSchema, paymentSchema, quotationSchema, reasonSchema } from "../../validations/project.validation";
import { createSalesOrderSchema, salesOrderNoteSchema } from "../../validations/sales-order.validation";
import { uploadDocumentSchema } from "../../validations/document.validation";

// B2B Sales Orders — Quotation / Direct Invoice → 100% Payment → Order → Dispatch → Close
const router = Router();
["id", "quotationId", "paymentId", "docId"].forEach((name) => router.param(name, validId));
const VIEW = requirePermission("sales.orders.view");
const EDIT = requirePermission("sales.orders.edit");

router.get("/meta", VIEW, getSalesOrderMeta);
router.get("/products", VIEW, listQuotationProducts); // item picker
router.get("/", VIEW, listSalesOrders);
router.get("/:id", VIEW, getSalesOrder);
router.post("/", requirePermission("sales.orders.create"), validate(createSalesOrderSchema), createSalesOrder);
router.post("/:id/notes", EDIT, validate(salesOrderNoteSchema), addSalesOrderNote);
router.post("/:id/cancel", EDIT, validate(reasonSchema), cancelSalesOrder);

// Quotation
router.post("/:id/quotations", EDIT, validate(quotationSchema), createOrderQuotation);
router.put("/:id/quotations/:quotationId", EDIT, validate(quotationSchema), updateOrderQuotation);
router.post("/:id/quotations/:quotationId/sent", EDIT, setOrderQuotationStatus("SENT"));
router.post("/:id/quotations/:quotationId/reject", EDIT, validate(reasonSchema), setOrderQuotationStatus("REJECTED"));
router.post("/:id/quotations/:quotationId/accept", EDIT, acceptOrderQuotation);

// Invoice (accepted quotation se) / Direct invoice (repeat order)
router.post("/:id/invoice", EDIT, createOrderInvoice(false));
router.post("/:id/invoice/direct", EDIT, validate(quotationSchema), createOrderInvoice(true));

// Payments (100% advance) → Confirm order
router.post("/:id/payments", EDIT, validate(paymentSchema), addOrderPayment);
router.delete("/:id/payments/:paymentId", EDIT, deleteOrderPayment);
router.post("/:id/confirm", EDIT, confirmSalesOrder);

// Dispatch → Delivered (close)
router.put("/:id/dispatch", EDIT, validate(dispatchSchema), saveOrderDispatch);
router.post("/:id/dispatch/deliver", EDIT, validate(deliverSchema), deliverSalesOrder);

// Documents (PO, challan, delivery proof ...)
router.get("/:id/documents", VIEW, listDocuments("sales-order"));
router.post("/:id/documents", EDIT, documentUpload, validate(uploadDocumentSchema), uploadDocument("sales-order"));
router.get("/:id/documents/:docId/file", VIEW, getDocumentFile("sales-order"));
router.delete("/:id/documents/:docId", EDIT, deleteDocument("sales-order"));

export default router;
