// Dropdown ki fixed lists — lead / customer / project / document forms (frontend ko /meta API se milti hain)

export const LEAD_SOURCES = [
  "Website",
  "Referral",
  "Walk-in",
  "Phone Inquiry",
  "Social Media",
  "WhatsApp",
  "Campaign",
  "Exhibition",
  "Channel Partner",
  "Field Agent",
  "Other",
] as const;

// Call outcome → lead ka naya status (null = status mat badlo)
export const CONNECTED_OUTCOMES: Record<string, "FOLLOW_UP" | "QUALIFIED" | "LOST"> = {
  Interested: "FOLLOW_UP",
  "Need Follow-up": "FOLLOW_UP",
  Qualified: "QUALIFIED",
  Rejected: "LOST",
  Duplicate: "LOST",
  "Wrong Number": "LOST",
};
// Not connected: retry date ho to FOLLOW_UP, warna status same. "Invalid Number" → LOST
export const NOT_CONNECTED_REASONS = ["Busy", "Switched Off", "No Answer", "Not Reachable", "Call Rejected", "Invalid Number"] as const;

export const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana",
  "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
  "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana",
  "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Andaman and Nicobar Islands", "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
] as const;

export const INDUSTRY_TYPES = ["Manufacturing", "Retail", "IT/Software", "Healthcare", "Education", "Real Estate", "Agriculture", "Other"] as const;
export const PROJECT_TYPES = ["Residential", "Commercial", "Industrial", "Agricultural"] as const;
export const ROOF_TYPES = ["RCC Flat", "Tin Sheet", "Asbestos", "Mangalore Tile", "Other"] as const;

// Documents (Lead / Customer / Project) — har category ka disk par apna folder
export const DOCUMENT_CATEGORIES = [
  "Aadhaar Card", "PAN Card", "Electricity Bill", "Property Document", "Bank Passbook / Cheque",
  "Site Photo", "GST Certificate", "Agreement", "Single Line Diagram", "Structure Drawing",
  "Installation Photo", "Customer Signature", "Delivery Proof", "Purchase Order", "Dispatch Challan", "Other",
] as const;

// Project (B2C)
export const METER_PHASES = ["Single Phase", "Three Phase"] as const;
export const STRUCTURE_TYPES = ["Elevated", "Flush Mount", "Ground Mount", "Tin Shed Mount"] as const;
export const REGISTRATION_PORTALS = ["PM Surya Ghar", "DISCOM Portal", "State Nodal Agency", "Other"] as const;
export const GST_RATES = [0, 5, 12, 18, 28] as const;

// Order ke liye kam se kam itna % payment (haath wala workflow: 90% ke baad hi order, baaki 10% net metering ke baad)
export const ORDER_MIN_PERCENT = 90;

// QC checklist (purane app jaisa) — sab OK hone par hi pass
export const QC_CHECKLIST = [
  "Panel mounting and alignment verified",
  "Electrical connections checked",
  "Grounding / earthing verified",
  "String voltage measured and verified",
  "Inverter configuration verified",
  "AC/DC isolation tested",
  "Earthing resistance measured",
  "System insulation resistance tested",
  "Meter reading captured",
  "Overall workmanship inspection",
] as const;

export const SUBSIDY_SCHEMES = ["PM Surya Ghar", "State Subsidy", "Other"] as const;
