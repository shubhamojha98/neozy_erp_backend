import { Response } from "express";
import { project as db } from "../../lib/globalprimsaclient";
import genrateResponse from "../../lib/generateResponse";
import HttpStatus from "../../lib/httpStatus";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { getScope, NO_COMPANY, userNames } from "../../dal/scope.dal";
import { DocumentEntity, documentOwner, documentWhere, listDocumentsOf } from "../../dal/document.dal";
import { DOCUMENT_CATEGORIES } from "../../constants/options";
import { absoluteUploadPath, InvalidFileError, removeUploadFile, saveDocumentFile } from "../../utility/fileStorage";
import { UploadDocumentInput } from "../../validations/document.validation";

// Ek hi controller Lead aur Customer dono ke liye: route par listDocuments("lead") / listDocuments("customer")
// URL: /api/lead/:id/documents ...  /api/customer/:id/documents ...

const NOT_FOUND = { lead: "Lead not found", customer: "Customer not found", project: "Project not found", "sales-order": "Sales order not found" };

// ============================================================
// LIST — documents + upload karne wale ka naam + categories
// ============================================================
export const listDocuments = (entity: DocumentEntity) => async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const owner = await documentOwner(scope, entity, Number(req.params.id));
    if (!owner) return genrateResponse(res, HttpStatus.NotFound, NOT_FOUND[entity]);

    const rows = await listDocumentsOf(documentWhere(entity, owner));
    const names = await userNames(rows.map((r) => r.uploadedBy));
    return genrateResponse(res, HttpStatus.OK, "Documents", {
      categories: DOCUMENT_CATEGORIES,
      rows: rows.map((r) => ({ ...r, uploadedByName: names.get(r.uploadedBy) ?? null })),
    });
  } catch (err) {
    console.error("[ListDocuments]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to load documents");
  }
};

// ============================================================
// UPLOAD — multipart: file + category. Photo compress hokar JPG.
// ============================================================
export const uploadDocument = (entity: DocumentEntity) => async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const owner = await documentOwner(scope, entity, Number(req.params.id));
    if (!owner) return genrateResponse(res, HttpStatus.NotFound, NOT_FOUND[entity]);

    const { category } = req.body as UploadDocumentInput;
    const saved = await saveDocumentFile({ companyId: owner.companyId, category, file: req.file! });

    const doc = await db.document.create({
      data: { ...owner, ...saved, category, uploadedBy: req.user!.userId },
      select: { id: true, category: true, fileName: true, mimeType: true, size: true, createdAt: true },
    });
    return genrateResponse(res, HttpStatus.Created, "Document uploaded", doc);
  } catch (err) {
    if (err instanceof InvalidFileError) return genrateResponse(res, HttpStatus.BadRequest, err.message);
    console.error("[UploadDocument]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to upload document");
  }
};

// ============================================================
// FILE — preview (inline) ya ?download=1. Sirf scope wale user ko.
// ============================================================
export const getDocumentFile = (entity: DocumentEntity) => async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const owner = await documentOwner(scope, entity, Number(req.params.id));
    if (!owner) return genrateResponse(res, HttpStatus.NotFound, NOT_FOUND[entity]);

    const doc = await db.document.findFirst({ where: documentWhere(entity, owner, { id: Number(req.params.docId) }) });
    if (!doc) return genrateResponse(res, HttpStatus.NotFound, "Document not found");

    res.setHeader("Cache-Control", "private, no-store");
    const absolute = absoluteUploadPath(doc.filePath);
    const onError = (err: Error | undefined) => {
      if (!err) return;
      console.error("[DocumentFile]", err);
      if (!res.headersSent) genrateResponse(res, HttpStatus.NotFound, "File missing on server");
    };
    if (req.query.download) return res.download(absolute, doc.fileName, onError);
    res.type(doc.mimeType);
    return res.sendFile(absolute, onError);
  } catch (err) {
    console.error("[DocumentFile]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to load file");
  }
};

// ============================================================
// DELETE — record soft delete (kisne / kab ka hisaab rahe), file disk se hata do
// ============================================================
export const deleteDocument = (entity: DocumentEntity) => async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = await getScope(req.user!);
    if (!scope) return genrateResponse(res, HttpStatus.BadRequest, NO_COMPANY);
    const owner = await documentOwner(scope, entity, Number(req.params.id));
    if (!owner) return genrateResponse(res, HttpStatus.NotFound, NOT_FOUND[entity]);

    const doc = await db.document.findFirst({ where: documentWhere(entity, owner, { id: Number(req.params.docId) }) });
    if (!doc) return genrateResponse(res, HttpStatus.NotFound, "Document not found");

    await db.document.update({ where: { id: doc.id }, data: { deletedAt: new Date() } });
    await removeUploadFile(doc.filePath);
    return genrateResponse(res, HttpStatus.OK, "Document deleted");
  } catch (err) {
    console.error("[DeleteDocument]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to delete document");
  }
};
