import { z } from "zod";
import { optional, requiredText, userId } from "./common.validation";

// B2B sales order — naya order (pehle Quotation ya seedha Invoice)
export const createSalesOrderSchema = z.object({
  customerId: z.coerce.number({ error: "Select a customer" }).int().positive({ error: "Select a customer" }),
  start: z.enum(["QUOTATION", "INVOICE"], { error: "Choose how to start" }),
  assignedTo: optional(userId()),
  notes: optional(z.string()),
});
export type CreateSalesOrderInput = z.infer<typeof createSalesOrderSchema>;

export const salesOrderNoteSchema = z.object({ message: requiredText("Note") });

// LIST query — card = upar wala KPI card (stage)
export const SALES_ORDER_CARDS = ["QUOTATION", "INVOICE", "ORDER", "DISPATCH", "CLOSED"] as const;

export const salesOrderListQuery = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  perPage: z.coerce.number().int().min(1).max(100).catch(10),
  search: optional(z.string()).catch(null),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  card: z.enum(SALES_ORDER_CARDS).optional().catch(undefined),
});
