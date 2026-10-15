import { z } from "zod";
import { CustomerStatus, CustomerType } from "../generated/project/client";
import { AADHAAR_REGEX, GSTIN_REGEX, INDUSTRY_TYPES, PROJECT_TYPES, ROOF_TYPES } from "../constants/crm";
import { email, optional, phone, pincode, requiredText, state, userId } from "./common.validation";

// Dono type me common fields
const common = {
  phone: phone(),
  alternatePhone: optional(phone("Enter a valid alternate number")),
  email: optional(email),
  city: optional(z.string()),
  state: optional(state),
  pincode: optional(pincode),
  notes: optional(z.string()),
  assignedTo: optional(userId()),
  status: z.enum(CustomerStatus).optional(), // sirf Edit me
};

// B2B — material / distribution buyer
const b2bSchema = z.object({
  type: z.literal(CustomerType.B2B),
  ...common,
  name: requiredText("Contact person"),
  companyName: requiredText("Company name"),
  gstin: optional(z.string().toUpperCase().regex(GSTIN_REGEX, { error: "Enter a valid GST number" })),
  industryType: optional(z.enum(INDUSTRY_TYPES, { error: "Select a valid industry type" })),
  address: optional(z.string()),
});

// B2C — solar installation customer
const b2cSchema = z.object({
  type: z.literal(CustomerType.B2C),
  ...common,
  name: requiredText("Name"),
  address: requiredText("Installation address"),
  aadhaarNumber: optional(z.string().transform((v) => v.replace(/\s/g, "")).pipe(z.string().regex(AADHAAR_REGEX, { error: "Aadhaar number must be 12 digits" }))),
  projectType: optional(z.enum(PROJECT_TYPES, { error: "Select a valid project type" })),
  monthlyBill: optional(z.coerce.number().min(0, { error: "Monthly bill must be a positive number" })),
  sanctionLoadKw: optional(z.coerce.number().min(0, { error: "Sanction load must be a positive number" })),
  consumerNumber: optional(z.string()),
  roofType: optional(z.enum(ROOF_TYPES, { error: "Select a valid roof type" })),
});

// Add / Edit / Lead convert — "type" se B2B ya B2C ke rules
export const customerSchema = z.discriminatedUnion("type", [b2bSchema, b2cSchema], {
  error: "Select customer type (B2B or B2C)",
});
export type CustomerInput = z.infer<typeof customerSchema>;

export const assignCustomerSchema = z.object({ assignedTo: optional(userId()) });

export const bulkDeleteSchema = z.object({
  ids: z.array(z.coerce.number().int().positive(), { error: "Select customers to delete" }).min(1, { error: "Select customers to delete" }),
});

// LIST query — galat value par default
export const customerListQuery = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  perPage: z.coerce.number().int().min(1).max(100).catch(10),
  search: optional(z.string()).catch(null),
  type: z.enum(CustomerType).optional().catch(undefined),
  status: z.enum(CustomerStatus).optional().catch(undefined),
  assignedTo: z.coerce.number().int().positive().optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined), // YYYY-MM-DD
  to: z.iso.date().optional().catch(undefined),
  sort: z.enum(["name", "type", "status", "createdAt"]).catch("createdAt"),
  dir: z.enum(["asc", "desc"]).catch("desc"),
});
