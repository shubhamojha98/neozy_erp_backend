import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import genrateResponse from "../lib/generateResponse";
import HttpStatus from "../lib/httpStatus";
import { extractPayload } from "../lib/apiCryptography";

// Route par body check: router.post("/", validate(leadSchema), createLead)
// Galat data → 400 (pehla error message), sahi → req.body me saaf data
export const validate = (schema: ZodType) => (req: Request, res: Response, next: NextFunction) => {
  let body: unknown;
  try {
    body = extractPayload(req.body) ?? {};
  } catch {
    return genrateResponse(res, HttpStatus.BadRequest, "Invalid encrypted payload");
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    return genrateResponse(res, HttpStatus.BadRequest, result.error.issues[0]?.message ?? "Invalid data");
  }
  req.body = result.data;
  next();
};
