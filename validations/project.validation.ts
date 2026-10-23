import { z } from "zod";
import { ProjectStatus } from "../generated/project/client";
import { METER_PHASES, PROJECT_TYPES, QC_CHECKLIST, REGISTRATION_PORTALS, ROOF_TYPES, STRUCTURE_TYPES, SUBSIDY_SCHEMES } from "../constants/options";
import { optional, phone, pincode, requiredText, state, userId } from "./common.validation";

const positive = (label: string) =>
  z.coerce.number({ error: `${label} is required` }).positive({ error: `${label} must be more than 0` });

// Project add / edit
export const projectSchema = z.object({
  capacityKw: positive("Capacity (kW)").max(10000, { error: "Capacity looks too high" }),
  projectType: z.enum(PROJECT_TYPES, { error: "Select project type" }),
  assignedTo: optional(userId()),
  address: requiredText("Site address"),
  landmark: optional(z.string()),
  city: optional(z.string()),
  state: optional(state),
  pincode: optional(pincode),
  notes: optional(z.string()),
});
export type ProjectInput = z.infer<typeof projectSchema>;

export const createProjectSchema = projectSchema.extend({
  customerId: z.coerce.number({ error: "Select a customer" }).int().positive({ error: "Select a customer" }),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

// Hold / Resume / Cancel
export const projectStatusSchema = z.object({
  status: z.enum([ProjectStatus.ACTIVE, ProjectStatus.ON_HOLD, ProjectStatus.CANCELLED], { error: "Select a valid status" }),
  reason: optional(z.string()),
});

export const projectNoteSchema = z.object({ message: requiredText("Note") });

// Survey schedule — scheduledAt "2026-10-23T11:00+05:30"
export const scheduleSurveySchema = z.object({
  surveyorId: userId("Select a surveyor"),
  scheduledAt: z.coerce.date({ error: "Select survey date and time" }),
});

// Survey report — complete karte waqt
export const surveyReportSchema = z.object({
  roofType: z.enum(ROOF_TYPES, { error: "Select roof type" }),
  roofAreaSqft: positive("Roof area"),
  shadowFreeAreaSqft: optional(z.coerce.number().positive({ error: "Shadow-free area must be more than 0" })),
  meterPhase: z.enum(METER_PHASES, { error: "Select meter phase" }),
  sanctionLoadKw: optional(z.coerce.number().positive({ error: "Sanction load must be more than 0" })),
  recommendedKw: positive("Recommended capacity"),
  shadingNotes: optional(z.string()),
  structureNotes: optional(z.string()),
  latitude: optional(z.coerce.number().min(-90).max(90)),
  longitude: optional(z.coerce.number().min(-180).max(180)),
  remarks: optional(z.string()),
});
export type SurveyReportInput = z.infer<typeof surveyReportSchema>;

export const cancelSurveySchema = z.object({ reason: requiredText("Reason") });

// Engineering design — systemKw backend khud nikalta hai
export const engineeringSchema = z.object({
  panelBrand: optional(z.string()),
  panelWattage: z.coerce.number({ error: "Panel wattage is required" }).int().min(50, { error: "Panel wattage looks too low" }).max(1000, { error: "Panel wattage looks too high" }),
  panelCount: z.coerce.number({ error: "Panel count is required" }).int().min(1, { error: "Panel count must be at least 1" }).max(20000),
  inverterBrand: optional(z.string()),
  inverterKw: positive("Inverter capacity"),
  structureType: z.enum(STRUCTURE_TYPES, { error: "Select structure type" }),
  notes: optional(z.string()),
});
export type EngineeringInput = z.infer<typeof engineeringSchema>;

// LIST query — card = upar wala KPI card (stage group)
export const PROJECT_CARDS = ["SURVEY_DESIGN", "SALES", "EXECUTION", "POST_INSTALL", "COMPLETED"] as const;

export const projectListQuery = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  perPage: z.coerce.number().int().min(1).max(100).catch(10),
  search: optional(z.string()).catch(null),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  card: z.enum(PROJECT_CARDS).optional().catch(undefined),
  customerId: z.coerce.number().int().positive().optional().catch(undefined),
});

// ============================================================
// 2B — Quotation, Loan, Registration, Payment
// ============================================================
const money = (label: string) => z.coerce.number({ error: `${label} must be a number` }).min(0, { error: `${label} cannot be negative` });
const isoDate = (label: string) => z.iso.date({ error: `${label} is required` });

const quotationItem = z.object({
  productId: optional(z.coerce.number().int().positive()),
  name: requiredText("Item name"),
  description: optional(z.string()),
  hsn: optional(z.string()),
  unit: optional(z.string()).transform((v) => v ?? "Nos"),
  qty: z.coerce.number({ error: "Quantity is required" }).positive({ error: "Quantity must be more than 0" }),
  rate: money("Rate"),
  gstRate: z.coerce.number({ error: "GST % is required" }).min(0).max(28, { error: "GST % must be 0 to 28" }),
});

export const quotationSchema = z.object({
  date: isoDate("Quotation date"),
  validUntil: optional(z.iso.date()),
  deliveryTimeline: optional(z.string()),
  notes: optional(z.string()),
  installationCharges: money("Installation charges").default(0),
  transportCharges: money("Transport charges").default(0),
  discount: money("Discount").default(0),
  items: z.array(quotationItem, { error: "Add at least one item" }).min(1, { error: "Add at least one item" }),
});
export type QuotationInput = z.infer<typeof quotationSchema>;

export const acceptQuotationSchema = z.object({
  paymentMode: z.enum(["CASH", "LOAN"], { error: "Select Cash or Bank Loan" }),
});

export const reasonSchema = z.object({ reason: requiredText("Reason") });

export const loanSchema = z.object({
  bankName: requiredText("Bank name"),
  branch: optional(z.string()),
  applicationNo: optional(z.string()),
  loanAmount: positive("Loan amount"),
  notes: optional(z.string()),
});
export type LoanInput = z.infer<typeof loanSchema>;

export const sanctionSchema = z.object({
  sanctionedAmount: positive("Sanctioned amount"),
  sanctionDate: isoDate("Sanction date"),
});

export const registrationSchema = z.object({
  portal: z.enum(REGISTRATION_PORTALS, { error: "Select portal" }),
  discom: optional(z.string()),
  applicationNo: requiredText("Application number"),
  registrationDate: isoDate("Registration date"),
  notes: optional(z.string()),
});
export type RegistrationInput = z.infer<typeof registrationSchema>;

export const paymentSchema = z.object({
  amount: positive("Amount"),
  method: z.enum(["CASH", "UPI", "CHEQUE", "BANK_TRANSFER", "LOAN"], { error: "Select payment method" }),
  paidOn: isoDate("Payment date"),
  reference: optional(z.string()),
  notes: optional(z.string()),
});
export type PaymentInput = z.infer<typeof paymentSchema>;

// ============================================================
// 2C — Dispatch → Installation → QC → Commissioning → Net Metering → Subsidy → Handover
// ============================================================

// "SN1, SN2\nSN3" → ["SN1", "SN2", "SN3"] (scanner / paste dono chalega)
const serialList = z
  .string()
  .transform((text) => [...new Set(text.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean))]);

export const serialsSchema = z.object({
  type: z.enum(["PANEL", "INVERTER"], { error: "Select panel or inverter" }),
  serials: serialList.pipe(z.array(z.string().max(60)).min(1, { error: "Enter at least one serial number" })),
});

export const dispatchSchema = z.object({
  dispatchDate: isoDate("Dispatch date"),
  vehicleNo: requiredText("Vehicle number").transform((v) => v.toUpperCase()),
  driverName: optional(z.string()),
  driverPhone: optional(phone("Enter a valid driver phone")),
  lrNumber: optional(z.string()),
  notes: optional(z.string()),
});
export type DispatchInput = z.infer<typeof dispatchSchema>;

export const deliverSchema = z.object({ receivedBy: requiredText("Received by") });

export const installationSchema = z.object({
  installerId: userId("Select an installer"),
  scheduledDate: isoDate("Installation date"),
  notes: optional(z.string()),
});

// QC: har checklist item ka pass / fail
export const qcSchema = z.object({
  items: z
    .array(z.object({ item: z.enum(QC_CHECKLIST), passed: z.boolean() }), { error: "Checklist is required" })
    .length(QC_CHECKLIST.length, { error: "Fill the full checklist" }),
  remarks: optional(z.string()),
});

export const commissioningSchema = z.object({
  commissionedOn: isoDate("Commissioning date"),
  generationKwh: z.coerce.number({ error: "Generation test is required" }).min(0, { error: "Generation cannot be negative" }),
  warrantyStart: isoDate("Warranty start"),
  warrantyMonths: z.coerce.number({ error: "Warranty is required" }).int().min(1).max(600),
  notes: optional(z.string()),
});

export const netMeteringSchema = z.object({
  discom: requiredText("DISCOM"),
  applicationNo: requiredText("Application number"),
  submittedOn: isoDate("Submitted date"),
  notes: optional(z.string()),
});
export type NetMeteringInput = z.infer<typeof netMeteringSchema>;

export const meterInstalledSchema = z.object({
  meterNo: requiredText("Meter number"),
  installedOn: isoDate("Installation date"),
});

export const subsidySchema = z.object({
  scheme: z.enum(SUBSIDY_SCHEMES, { error: "Select scheme" }),
  applicationNo: requiredText("Application number"),
  amount: positive("Subsidy amount"),
  appliedOn: isoDate("Application date"),
  notes: optional(z.string()),
});
export type SubsidyInput = z.infer<typeof subsidySchema>;

export const disbursedSchema = z.object({
  disbursedAmount: positive("Disbursed amount"),
  disbursedOn: isoDate("Disbursed date"),
});

export const handoverSchema = z.object({
  handoverDate: isoDate("Handover date"),
  receivedBy: requiredText("Customer name"),
  notes: optional(z.string()),
});
