import { z } from "zod";
import { DataScope, PermissionEffect } from "../generated/panel/client";
import { email, optional, password, phone, requiredText } from "./common.validation";

// Administration — Roles & Users (sab active company ke andar)

const id = (message = "Invalid id") => z.coerce.number({ error: message }).int().positive({ error: message });
const idList = z.array(id(), { error: "Invalid list" }).max(1000).default([]);

// ============================================================
// ROLES
// ============================================================
export const roleSchema = z.object({
  name: requiredText("Role name").max(100, { error: "Role name is too long" }),
  // Khaali → naam se ban jayega (Site Supervisor → SITE_SUPERVISOR). Edit me code nahi badalta
  code: optional(
    z.string().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,49}$/, { error: "Code: capital letters, numbers and _ only" }),
  ),
  description: optional(z.string().max(500, { error: "Description is too long" })),
  dataScope: z.enum(DataScope, { error: "Select a valid data scope" }),
  permissionIds: idList,
  templateId: optional(id("Invalid template")), // RoleMaster — kis template se bana (sirf record ke liye)
});
export type RoleInput = z.infer<typeof roleSchema>;

// ============================================================
// USERS
// ============================================================

// Company membership wale fields (create / edit / attach teeno me)
const memberFields = {
  employeeCode: optional(z.string().max(30, { error: "Employee code is too long" })),
  designation: optional(z.string().max(100, { error: "Designation is too long" })),
  department: optional(z.string().max(100, { error: "Department is too long" })),
  reportsToId: optional(id("Select a valid manager")), // CompanyUser id (isi company ka)
  roleIds: z.array(id("Select a valid role"), { error: "Select at least one role" }).min(1, { error: "Select at least one role" }),
};

const profileFields = {
  firstName: requiredText("First name").max(100, { error: "First name is too long" }),
  lastName: optional(z.string().max(100, { error: "Last name is too long" })),
  email: optional(email),
  phone: optional(phone()),
};

const needEmailOrPhone = (data: { email?: string | null; phone?: string | null }, ctx: z.RefinementCtx) => {
  if (!data.email && !data.phone) ctx.addIssue({ code: "custom", message: "Email or phone is required", path: ["email"] });
};

export const createUserSchema = z
  .object({
    ...profileFields,
    ...memberFields,
    // Khaali → email / phone se ban jayega
    username: optional(
      z.string().toLowerCase().regex(/^[a-z0-9._-]{3,30}$/, { error: "Username: 3-30 letters, numbers, . _ - only" }),
    ),
    password: z.string({ error: "Password is required" }),
  })
  .superRefine((data, ctx) => {
    needEmailOrPhone(data, ctx);
    // Password me username na ho — username nahi diya to email ka pehla hissa
    const result = password(data.username ?? data.email?.split("@")[0]).safeParse(data.password);
    if (!result.success) ctx.addIssue({ code: "custom", message: result.error.issues[0]?.message ?? "Weak password", path: ["password"] });
  });
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({ ...profileFields, ...memberFields }).superRefine(needEmailOrPhone);
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

// Same tenant ki dusri company ka user → is company me bhi access
export const attachUserSchema = z.object({ userId: id("Select a valid user"), ...memberFields });
export type AttachUserInput = z.infer<typeof attachUserSchema>;

// Role ke upar extra GRANT / REVOKE — poori list bhejo, purani replace ho jayegi
export const userPermissionsSchema = z.object({
  overrides: z
    .array(
      z.object({
        permissionId: id("Invalid permission"),
        effect: z.enum(PermissionEffect, { error: "Effect must be GRANT or REVOKE" }),
        reason: optional(z.string().max(255, { error: "Reason is too long" })),
        validUntil: optional(z.coerce.date({ error: "Invalid date" })),
      }),
    )
    .max(500)
    .refine((list) => new Set(list.map((o) => o.permissionId)).size === list.length, {
      error: "A permission can be added only once",
    }),
});
export type UserPermissionsInput = z.infer<typeof userPermissionsSchema>;

export const userStatusSchema = z.object({ active: z.boolean({ error: "active must be true or false" }) });

// Username wala check controller me (DB se username aata hai)
export const resetPasswordSchema = z.object({ password: password() });

// Users list ke upar wale KPI cards (filter controller ke USER_CARD_FILTERS me)
export const USER_CARDS = ["ACTIVE", "INACTIVE", "ADMINS", "PENDING"] as const;

export const userListQuery = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  perPage: z.coerce.number().int().min(1).max(100).catch(10),
  search: optional(z.string()).catch(null),
  card: z.enum(USER_CARDS).optional().catch(undefined),
  roleId: z.coerce.number().int().positive().optional().catch(undefined),
});
