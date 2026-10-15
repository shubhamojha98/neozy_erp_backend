import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import genrateResponse from "../lib/generateResponse";
import HttpStatus from "../lib/httpStatus";

export const MAX_DOCUMENT_MB = 10;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

// File RAM me aati hai (compress karke hi disk par likhte hain — utility/fileStorage.ts)
const multerSingle = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED.includes(file.mimetype)),
}).single("file");

// Route par: documentUpload → validate(...) → controller. Field ka naam "file".
export const documentUpload = (req: Request, res: Response, next: NextFunction) => {
  multerSingle(req, res, (err) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return genrateResponse(res, HttpStatus.PayloadTooLarge, `File must be under ${MAX_DOCUMENT_MB} MB`);
    }
    if (err) {
      console.error("[DocumentUpload]", err);
      return genrateResponse(res, HttpStatus.BadRequest, "Upload failed");
    }
    if (!req.file) return genrateResponse(res, HttpStatus.BadRequest, "Select a JPG, PNG, WEBP or PDF file");
    next();
  });
};
