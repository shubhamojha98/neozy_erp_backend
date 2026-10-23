import { z } from "zod";
import { INDIAN_STATES } from "../constants/options";
import { PHONE_REGEX } from "../constants/regex";

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

// Password policy — user create / reset / change sab jagah yahi use karo
// bcrypt 72 bytes ke baad ka hissa ignore karta hai, isliye max 72
export const password = (username?: string) =>
  z
    .string({ error: "Password is required" })
    .min(8, { error: "Password must be at least 8 characters" })
    .refine((value) => Buffer.byteLength(value) <= 72, { error: "Password must be at most 72 characters" })
    .regex(/[a-z]/, { error: "Password must contain a lowercase letter" })
    .regex(/[A-Z]/, { error: "Password must contain an uppercase letter" })
    .regex(/\d/, { error: "Password must contain a number" })
    .regex(/[^A-Za-z0-9]/, { error: "Password must contain a special character" })
    .refine((value) => !username || !value.toLowerCase().includes(username.toLowerCase()), {
      error: "Password must not contain the username",
    });
