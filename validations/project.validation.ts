import { z } from "zod";
import { ProjectStatus } from "../generated/project/client";
import { METER_PHASES, PROJECT_TYPES, ROOF_TYPES, STRUCTURE_TYPES } from "../constants/options";
import { optional, pincode, requiredText, state, userId } from "./common.validation";

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
