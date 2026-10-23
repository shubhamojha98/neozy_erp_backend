import { z } from "zod";
import { CONNECTED_OUTCOMES, LEAD_SOURCES, NOT_CONNECTED_REASONS } from "../constants/options";
import { date, email, optional, phone, pincode, requiredText, state, userId } from "./common.validation";

// ============================================================
// LEAD — Add / Edit
// ============================================================
export const leadSchema = z.object({
  name: requiredText("Name"),
  phone: phone(),
  alternateName: optional(z.string()),
  alternatePhone: optional(phone("Enter a valid alternate number")),
  email: optional(email),
  address: optional(z.string()),
  city: optional(z.string()),
  state: optional(state),
  pincode: optional(pincode),
  source: z.enum(LEAD_SOURCES, { error: "Select a valid source" }),
  notes: optional(z.string()),
  nextFollowupDate: optional(date("Invalid follow-up date")),
  assignedTo: optional(userId()), // sirf Add me use hota hai
});
export type LeadInput = z.infer<typeof leadSchema>;

// ============================================================
// CALL LOG — connected ho to outcome, nahi to reason
// ============================================================
export const callSchema = z
  .object({
    connected: z.boolean({ error: "Select Connected or Not Connected" }),
    outcome: requiredText("Outcome"),
    remarks: optional(z.string()),
    nextFollowupDate: optional(date("Invalid follow-up date")),
  })
  .superRefine((data, ctx) => {
    const allowed: readonly string[] = data.connected ? Object.keys(CONNECTED_OUTCOMES) : NOT_CONNECTED_REASONS;
    if (!allowed.includes(data.outcome)) {
      ctx.addIssue({ code: "custom", path: ["outcome"], message: data.connected ? "Select a valid call outcome" : "Select a valid reason" });
    }
    if (data.connected && data.outcome === "Need Follow-up" && !data.nextFollowupDate) {
      ctx.addIssue({ code: "custom", path: ["nextFollowupDate"], message: "Follow-up date is required" });
    }
  });
export type CallInput = z.infer<typeof callSchema>;

export const noteSchema = z.object({ remarks: requiredText("Note") });

export const assignLeadSchema = z.object({
  assignedTo: userId("Select a user"),
  remarks: optional(z.string()),
});

export const lostSchema = z.object({ reason: requiredText("Reason") });

// ============================================================
// LIST query (?page=&perPage=&search=&from=&to=&card=) — galat value par default
// card = upar wala KPI card (ek time par ek)
// ============================================================
// Upar wale KPI card = lead status
export const LEAD_CARDS = ["NEW", "FOLLOW_UP", "CONVERTED", "LOST"] as const;

export const leadListQuery = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  perPage: z.coerce.number().int().min(1).max(100).catch(10),
  search: optional(z.string()).catch(null),
  from: z.iso.date().optional().catch(undefined), // YYYY-MM-DD (created date)
  to: z.iso.date().optional().catch(undefined),
  card: z.enum(LEAD_CARDS).optional().catch(undefined),
});
