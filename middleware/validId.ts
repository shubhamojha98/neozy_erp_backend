import type { NextFunction, Request, Response } from "express";
import genrateResponse from "../lib/generateResponse";
import HttpStatus from "../lib/httpStatus";

// URL ke :id, :docId ... sirf positive number (1, 25, 9007199254740993 bhi — BigInt id ke liye regex, Number nahi)
// "abc" / "0" / "-1" → 404, controller tak jata hi nahi (warna Prisma crash → 500)
// Route file me: ["id", "docId"].forEach((name) => router.param(name, validId));
const POSITIVE_INT = /^[1-9]\d*$/;

export const validId = (_req: Request, res: Response, next: NextFunction, value: string) => {
  if (POSITIVE_INT.test(value)) return next();
  return genrateResponse(res, HttpStatus.NotFound, "Not found");
};
