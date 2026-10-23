import { Prisma, ProjectActivityType, ProjectStage, ProjectStatus } from "../generated/project/client";
import { project as db } from "../lib/globalprimsaclient";
import { nextCode } from "../utility/codeGenerator";
import type { Scope } from "./scope.dal";
import type { PROJECT_CARDS } from "../validations/project.validation";

// Stage ka order (haath wala workflow). LOAN sirf Bank Loan wale project me aata hai.
export const STAGE_ORDER: ProjectStage[] = [
  ProjectStage.SURVEY, ProjectStage.ENGINEERING, ProjectStage.QUOTATION, ProjectStage.LOAN, ProjectStage.REGISTRATION,
  ProjectStage.INVOICE, ProjectStage.ORDER, ProjectStage.DISPATCH, ProjectStage.INSTALLATION, ProjectStage.QC,
  ProjectStage.COMMISSIONING, ProjectStage.NET_METERING, ProjectStage.SUBSIDY, ProjectStage.HANDOVER,
];

// Scope ke andar wale projects (SELF / TEAM: owner, surveyor, installer ya banane wala)
export const projectWhere = (scope: Scope, extra: Prisma.ProjectWhereInput = {}): Prisma.ProjectWhereInput => ({
  companyId: { in: scope.companyIds },
  deletedAt: null,
  ...(scope.userIds && {
    OR: [
      { assignedTo: { in: scope.userIds } },
      { surveyorId: { in: scope.userIds } },
      { installerId: { in: scope.userIds } },
      { createdBy: { in: scope.userIds } },
    ],
  }),
  ...extra,
});

export const findProject = (scope: Scope, id: number) => db.project.findFirst({ where: projectWhere(scope, { id }) });

// Upar wale KPI card → filter
const CARD_FILTERS: Record<(typeof PROJECT_CARDS)[number], Prisma.ProjectWhereInput> = {
  SURVEY_DESIGN: { status: { not: ProjectStatus.COMPLETED }, stage: { in: [ProjectStage.SURVEY, ProjectStage.ENGINEERING] } },
  SALES: {
    status: { not: ProjectStatus.COMPLETED },
    stage: { in: [ProjectStage.QUOTATION, ProjectStage.LOAN, ProjectStage.REGISTRATION, ProjectStage.INVOICE, ProjectStage.ORDER] },
  },
  EXECUTION: {
    status: { not: ProjectStatus.COMPLETED },
    stage: { in: [ProjectStage.DISPATCH, ProjectStage.INSTALLATION, ProjectStage.QC, ProjectStage.COMMISSIONING] },
  },
  POST_INSTALL: {
    status: { not: ProjectStatus.COMPLETED },
    stage: { in: [ProjectStage.NET_METERING, ProjectStage.SUBSIDY, ProjectStage.HANDOVER] },
  },
  COMPLETED: { status: ProjectStatus.COMPLETED },
};
export const projectCardFilter = (card: (typeof PROJECT_CARDS)[number]) => CARD_FILTERS[card];

// Naya project — code PRJ000001 (do request ek saath aayein to unique error par dobara try)
export async function createProjectRecord(data: Omit<Prisma.ProjectUncheckedCreateInput, "projectCode">) {
  for (let attempt = 0; ; attempt++) {
    const last = await db.project.findFirst({ where: { companyId: data.companyId }, orderBy: { id: "desc" }, select: { projectCode: true } });
    try {
      return await db.project.create({ data: { ...data, projectCode: nextCode("PRJ", last?.projectCode) } });
    } catch (err) {
      const duplicateCode = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (!duplicateCode || attempt >= 2) throw err;
    }
  }
}

// Timeline me ek line
export const activity = (projectId: number, type: ProjectActivityType, message: string, createdBy: number) =>
  db.projectActivity.create({ data: { projectId, type, message, createdBy } });

// Stage badlo + timeline (transaction me use karne ke liye do query)
export const moveStage = (projectId: number, stage: ProjectStage, message: string, userId: number) => [
  db.project.update({ where: { id: projectId }, data: { stage } }),
  db.projectActivity.create({ data: { projectId, type: ProjectActivityType.STAGE, message, createdBy: userId } }),
];


// Ab tak kitna paisa aaya (delete wale chhod ke)
export async function paidTotal(projectId: number) {
  const sum = await db.payment.aggregate({ where: { projectId, deletedAt: null }, _sum: { amount: true } });
  return Number(sum._sum.amount ?? 0);
}

// Agla code (QT / INV / ORD / DSP / SO) — company ke last record se
const LAST_CODE = {
  QT: (companyId: number) => db.quotation.findFirst({ where: { companyId }, orderBy: { id: "desc" }, select: { quotationNo: true } }).then((r) => r?.quotationNo),
  INV: (companyId: number) => db.invoice.findFirst({ where: { companyId }, orderBy: { id: "desc" }, select: { invoiceNo: true } }).then((r) => r?.invoiceNo),
  ORD: (companyId: number) => db.projectOrder.findFirst({ where: { companyId }, orderBy: { id: "desc" }, select: { orderNo: true } }).then((r) => r?.orderNo),
  SO: (companyId: number) => db.salesOrder.findFirst({ where: { companyId }, orderBy: { id: "desc" }, select: { orderNo: true } }).then((r) => r?.orderNo),
  DSP: (companyId: number) => db.dispatch.findFirst({ where: { companyId }, orderBy: { id: "desc" }, select: { dispatchNo: true } }).then((r) => r?.dispatchNo),
};

// Naya code banake create — do request ek saath aayein to unique error par dobara try
export async function createWithCode(prefix: keyof typeof LAST_CODE, companyId: number, create: (code: string) => Promise<unknown>) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await create(nextCode(prefix, await LAST_CODE[prefix](companyId)));
    } catch (err) {
      const duplicateCode = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (!duplicateCode || attempt >= 2) throw err;
    }
  }
}

// Stage ke kaam se pehle check: project mila, active hai, sahi stage par hai
// error ho to { error: "..." } (controller 400/404 bhejta hai)
export async function projectAtStage(scope: Scope, id: number, stage: ProjectStage) {
  const project = await findProject(scope, id);
  if (!project) return { notFound: true as const };
  if (project.status !== ProjectStatus.ACTIVE) return { error: "Project is not active" };
  if (project.stage !== stage) return { error: `This can be done only in ${stage.replace(/_/g, " ").toLowerCase()} stage` };
  return { project };
}
