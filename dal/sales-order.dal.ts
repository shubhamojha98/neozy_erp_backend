import { Prisma, ProjectActivityType, SalesOrderStage, SalesOrderStatus } from "../generated/project/client";
import { project as db } from "../lib/globalprimsaclient";
import type { Scope } from "./scope.dal";
import type { SALES_ORDER_CARDS } from "../validations/sales-order.validation";

// Scope ke andar wale B2B orders (SELF / TEAM: assigned ya banane wala)
export const salesOrderWhere = (scope: Scope, extra: Prisma.SalesOrderWhereInput = {}): Prisma.SalesOrderWhereInput => ({
  companyId: { in: scope.companyIds },
  deletedAt: null,
  ...(scope.userIds && { OR: [{ assignedTo: { in: scope.userIds } }, { createdBy: { in: scope.userIds } }] }),
  ...extra,
});

export const findSalesOrder = (scope: Scope, id: number) => db.salesOrder.findFirst({ where: salesOrderWhere(scope, { id }) });

// Upar wala KPI card → filter
const CARD_FILTERS: Record<(typeof SALES_ORDER_CARDS)[number], Prisma.SalesOrderWhereInput> = {
  QUOTATION: { status: SalesOrderStatus.OPEN, stage: SalesOrderStage.QUOTATION },
  INVOICE: { status: SalesOrderStatus.OPEN, stage: SalesOrderStage.INVOICE },
  ORDER: { status: SalesOrderStatus.OPEN, stage: SalesOrderStage.ORDER },
  DISPATCH: { status: SalesOrderStatus.OPEN, stage: SalesOrderStage.DISPATCH },
  CLOSED: { status: SalesOrderStatus.CLOSED },
};
export const salesOrderCardFilter = (card: (typeof SALES_ORDER_CARDS)[number]) => CARD_FILTERS[card];

// Timeline me ek line
export const orderActivity = (salesOrderId: number, type: ProjectActivityType, message: string, createdBy: number) =>
  db.projectActivity.create({ data: { salesOrderId, type, message, createdBy } });

// Stage badlo + timeline
export const moveOrderStage = (salesOrderId: number, stage: SalesOrderStage, message: string, userId: number) => [
  db.salesOrder.update({ where: { id: salesOrderId }, data: { stage } }),
  db.projectActivity.create({ data: { salesOrderId, type: ProjectActivityType.STAGE, message, createdBy: userId } }),
];

// Kitna paisa aaya
export async function orderPaidTotal(salesOrderId: number) {
  const sum = await db.payment.aggregate({ where: { salesOrderId, deletedAt: null }, _sum: { amount: true } });
  return Number(sum._sum.amount ?? 0);
}

// Kaam se pehle check: order mila, khula hai, sahi stage par hai
export async function orderAtStage(scope: Scope, id: number, stage: SalesOrderStage) {
  const order = await findSalesOrder(scope, id);
  if (!order) return { notFound: true as const };
  if (order.status !== SalesOrderStatus.OPEN) return { error: "Order is closed" };
  if (order.stage !== stage) return { error: `This can be done only in ${stage.toLowerCase()} stage` };
  return { order };
}
