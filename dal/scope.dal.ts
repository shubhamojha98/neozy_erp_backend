import { UserStatus } from "../generated/panel/client";
import { panel } from "../lib/globalprimsaclient";
import type { TokenPayload } from "../middleware/authMiddleware";
import { scopedCompanyIds, scopedCompanyUserIds } from "./access.dal";

export type Scope = {
  companyId: number; // active company (naye record isi me bante hain)
  companyIds: number[]; // ye companies dikhengi (COMPANY_TREE me sub-companies bhi)
  userIds: number[] | null; // SELF / TEAM: sirf in users ke records, null = sab
};

export const NO_COMPANY = "Please select a company first";

// User ko kaunsa data dikhega — token ki active company + data scope se
export async function getScope(user: TokenPayload): Promise<Scope | null> {
  const companyId = user.company?.id;
  if (!companyId) return null;

  const ctx = { companyId, isSuperAdmin: user.isSuperAdmin, companyUserId: user.companyUserId, dataScope: user.dataScope };
  const [companyIds, companyUserIds] = await Promise.all([scopedCompanyIds(ctx), scopedCompanyUserIds(ctx)]);

  let userIds: number[] | null = null;
  if (companyUserIds) {
    const members = await panel.companyUser.findMany({ where: { id: { in: companyUserIds } }, select: { user_id: true } });
    userIds = members.map((m) => m.user_id);
  }
  return { companyId, companyIds, userIds };
}

const fullName = (u: { first_name: string | null; last_name: string | null; username: string }) =>
  [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username;

// "Assign To" dropdown — company ke active users
export async function companyUsers(companyId: number) {
  const members = await panel.companyUser.findMany({
    where: { company_id: companyId, is_active: true, user: { status: UserStatus.ACTIVE, deleted_at: null } },
    select: { user: { select: { id: true, first_name: true, last_name: true, username: true } } },
  });
  return members.map((m) => ({ id: m.user.id, name: fullName(m.user) })).sort((a, b) => a.name.localeCompare(b.name));
}

// Assign karne wala user isi company ka active member hai?
export async function isCompanyUser(companyId: number, userId: number) {
  const users = await companyUsers(companyId);
  return users.some((u) => u.id === userId);
}

// User ids → naam (table me "Assigned To" dikhane ke liye)
export async function userNames(ids: (number | null | undefined)[]) {
  const unique = [...new Set(ids.filter((id): id is number => !!id))];
  if (!unique.length) return new Map<number, string>();
  const users = await panel.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, first_name: true, last_name: true, username: true },
  });
  return new Map(users.map((u) => [u.id, fullName(u)]));
}
