import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { todayIST } from "./istDate";

// Saari upload files yahan (public nahi — file sirf login + scope check wali API se milti hai)
export const UPLOAD_ROOT = path.resolve("uploads");

// Photo: lambi side max 2000px, JPG quality 80 (mozjpeg) → text saaf, size chhota
const MAX_SIDE = 2000;
const JPEG_QUALITY = 80;

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const randomName = () => Array.from({ length: 12 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join("");

// "Electricity Bill" → "electricity-bill"
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const isPdf = (buffer: Buffer) => buffer.subarray(0, 5).toString() === "%PDF-";

// Photo → seedhi (EXIF rotate), 2000px tak chhoti, safed background, JPG. GPS / EXIF hat jata hai.
const compressImage = (buffer: Buffer) =>
  sharp(buffer, { failOn: "error" })
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();

// File disk par: uploads/{companyId}/{yyyy-mm}/{category}/{random}.jpg|.pdf
// Galat / tooti file → error (controller 400 bhejta hai)
export async function saveDocumentFile({ companyId, category, file }: { companyId: number; category: string; file: Express.Multer.File }) {
  let data: Buffer;
  let ext: string;
  let mimeType: string;

  if (file.mimetype === "application/pdf") {
    if (!isPdf(file.buffer)) throw new InvalidFileError("File is not a valid PDF");
    [data, ext, mimeType] = [file.buffer, "pdf", "application/pdf"];
  } else {
    try {
      data = await compressImage(file.buffer);
    } catch {
      throw new InvalidFileError("Image is corrupted or not supported");
    }
    [ext, mimeType] = ["jpg", "image/jpeg"];
  }

  const month = todayIST().slice(0, 7); // "2026-10" — mahina badla to naya folder apne aap
  const filePath = path.posix.join(String(companyId), month, slug(category), `${randomName()}.${ext}`);
  const absolute = path.join(UPLOAD_ROOT, filePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, data);

  // Photo JPG ban gayi to naam bhi .jpg ("IMG_01.png" → "IMG_01.jpg")
  const fileName = ext === "jpg" ? file.originalname.replace(/\.[^.]+$/, "") + ".jpg" : file.originalname;
  return { filePath, fileName, mimeType, size: data.length };
}

// DB ka relative path → disk ka poora path (uploads/ ke bahar ka path kabhi nahi)
export function absoluteUploadPath(filePath: string) {
  const absolute = path.resolve(UPLOAD_ROOT, filePath);
  if (!absolute.startsWith(UPLOAD_ROOT + path.sep)) throw new Error("Invalid file path");
  return absolute;
}

export const removeUploadFile = (filePath: string) => fs.rm(absoluteUploadPath(filePath), { force: true });

export class InvalidFileError extends Error {}
