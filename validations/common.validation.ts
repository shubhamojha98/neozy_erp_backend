import { z } from "zod";
import { INDIAN_STATES, PHONE_REGEX } from "../constants/crm";

// Form ke khaali field ("" / null / undefined) → null, baaki text trim
const emptyToNull = (value: unknown) => {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() === "" ? null : value.trim();
  return value;
};

// Optional field: khaali ho to null, bhara ho to diya hua schema check karega
export const optional = <T extends z.ZodType>(schema: T) => z.preprocess(emptyToNull, schema.nullable());

// Zaruri text field
export const requiredText = (label: string) =>
  z.string({ error: `${label} is required` }).trim().min(1, { error: `${label} is required` });

export const phone = (message = "Enter a valid 10-digit mobile number") =>
  z.string({ error: message }).trim().regex(PHONE_REGEX, { error: message });

export const email = z.string().trim().toLowerCase().pipe(z.email({ error: "Enter a valid email" }));
export const state = z.enum(INDIAN_STATES, { error: "Select a valid state" });
export const pincode = z.string().regex(/^\d{6}$/, { error: "Pincode must be 6 digits" });
export const date = (message = "Invalid date") => z.coerce.date({ error: message });

// User id (assign) — company ka member hai ya nahi, ye controller check karta hai
export const userId = (message = "Select a valid user") => z.coerce.number({ error: message }).int().positive({ error: message });
