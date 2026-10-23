import { Router } from "express";
import { createRole, deleteRole, getRole, getRoleMeta, listRoles, toggleRole, updateRole } from "../../controller/admin/role.controller";
import {
  attachUser,
  createUser,
  getUser,
  getUserMeta,
  listUsers,
  resetUserPassword,
  setUserPermissions,
  setUserStatus,
  updateUser,
} from "../../controller/admin/user.controller";
import { requirePermission } from "../../middleware/authMiddleware";
import { validId } from "../../middleware/validId";
import { validate } from "../../middleware/validate";
import {
  attachUserSchema,
  createUserSchema,
  resetPasswordSchema,
  roleSchema,
  updateUserSchema,
  userPermissionsSchema,
  userStatusSchema,
} from "../../validations/admin.validation";

// Administration — /api/panel/roles, /api/panel/users (active company ke andar)
const router = Router();
["id"].forEach((name) => router.param(name, validId)); // galat id → 404

// Roles & Permissions
router.get("/roles/meta", requirePermission("admin.roles.view"), getRoleMeta);
router.get("/roles", requirePermission("admin.roles.view"), listRoles);
router.get("/roles/:id", requirePermission("admin.roles.view"), getRole);
router.post("/roles", requirePermission("admin.roles.create"), validate(roleSchema), createRole);
router.put("/roles/:id", requirePermission("admin.roles.edit"), validate(roleSchema), updateRole);
router.post("/roles/:id/toggle", requirePermission("admin.roles.edit"), toggleRole);
router.delete("/roles/:id", requirePermission("admin.roles.delete"), deleteRole);

// Users (:id = CompanyUser id)
router.get("/users/meta", requirePermission("admin.users.view"), getUserMeta);
router.get("/users", requirePermission("admin.users.view"), listUsers);
router.get("/users/:id", requirePermission("admin.users.view"), getUser);
router.post("/users", requirePermission("admin.users.create"), validate(createUserSchema), createUser);
router.post("/users/attach", requirePermission("admin.users.create"), validate(attachUserSchema), attachUser);
router.put("/users/:id", requirePermission("admin.users.edit"), validate(updateUserSchema), updateUser);
router.put("/users/:id/permissions", requirePermission("admin.users.edit"), validate(userPermissionsSchema), setUserPermissions);
router.post("/users/:id/status", requirePermission("admin.users.edit"), validate(userStatusSchema), setUserStatus);
router.post("/users/:id/reset-password", requirePermission("admin.users.edit"), validate(resetPasswordSchema), resetUserPassword);

export default router;
