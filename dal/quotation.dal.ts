import { round2 } from "../utility/format";
import type { QuotationInput } from "../validations/project.validation";

// Quotation ke common helpers — B2C project aur B2B sales order dono me

// Item lines + charges → totals (GST item ke rate par)
export function quotationTotals(input: QuotationInput) {
  const subtotal = round2(input.items.reduce((sum, i) => sum + i.qty * i.rate, 0));
  const taxTotal = round2(input.items.reduce((sum, i) => sum + (i.qty * i.rate * i.gstRate) / 100, 0));
  const total = round2(subtotal + taxTotal + input.installationCharges + input.transportCharges - input.discount);
  return { subtotal, taxTotal, total };
}

export const quotationItemRows = (input: QuotationInput) => input.items.map((item, index) => ({ ...item, sortOrder: index }));

export const quotationHeader = (input: QuotationInput) => ({
  date: new Date(input.date),
  validUntil: input.validUntil ? new Date(input.validUntil) : null,
  deliveryTimeline: input.deliveryTimeline,
  notes: input.notes,
  installationCharges: input.installationCharges,
  transportCharges: input.transportCharges,
  discount: input.discount,
});
