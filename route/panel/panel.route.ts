import express from "express";
import {
  create,
  getAll as getAllRoles,
  getById as getRoleById,
  update as updateRole,
  toggle,
} from "../../controller/panel/role.controller";
import {
  create as createPermission,
  getAll,
  getOne,
  update as updatePermission,
  toggle as togglePermission,
} from "../../controller/panel/permission.controller";
import {
  createMenuPanel,
  getAllMenu,
  getMenuById,
  toggleMenu,
  updateMenuById,
} from "../../controller/panel/menu.controller";
import {
  createModule,
  getAllModule,
  getModuleById,
  toggleModule,
  updateModuleById,
} from "../../controller/panel/module.controller";
import {
  createBank,
  getAllBank,
  getBankById,
  toggleBank,
  updateBankById,
} from "../../controller/panel/bank.controller";
import {
  connectUlb,
  createEmployeeWithUser,
  disconnectUlb,
  getAllEmployeeWithUser,
  getEmplyoeeWithUserId,
  getModuleByEmployeeId,
  mapPermissionToUser,
  bulkMapPermissionsToUser,
  mapWardsToUser,
  toggleUserStatus,
  updateEmployeeWithUser,
} from "../../controller/panel/employee.controller";
import { upload } from "../../middleware/upload.middleware";
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "../../controller/panel/notification.controller";
import { getMenuCatalog } from "../../dal/panel.dal";
import { Response } from "express";
import { AuthenticatedRequest } from "../../src/core/types";
import genrateResponse from "../../lib/generateResponse";
import HttpStatus from "../../lib/httpStatus";
import { encryptData } from "../../lib/apiCryptography";
import { requirePermission, requireSuperAdmin } from "../../middleware/authMiddleware";

const router = express.Router();

// ================================================================
// PERMISSION CATALOG
// ================================================================
router.get(
  "/master/menu/catalog",
  requireSuperAdmin,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { ulbId } = req.query;
      const catalog = await getMenuCatalog(ulbId ? Number(ulbId) : undefined);
      genrateResponse(
        res,
        HttpStatus.OK,
        "Menu catalog fetched successfully",
        encryptData(catalog),
      );
    } catch (err: any) {
      genrateResponse(
        res,
        HttpStatus.InternalServerError,
        err?.message || "Failed to fetch catalog",
      );
    }
  },
);

// ================================================================
// Permission (menu_action management)
// ================================================================
router.post("/master/permission", requireSuperAdmin, createPermission);
router.get("/master/permission", requireSuperAdmin, getAll);
router.get("/master/permission/by-id", requireSuperAdmin, getOne);
router.put("/master/permission", requireSuperAdmin, updatePermission);
router.put("/master/permission/toggle", requireSuperAdmin, togglePermission);

// ================================================================
// Role
// ================================================================
router.post("/master/role", requirePermission("admin.roles.create"), create);
router.get("/master/role", requirePermission("admin.roles.view"), getAllRoles);
router.get("/master/role/by-id", requirePermission("admin.roles.view"), getRoleById);
router.put("/master/role", requirePermission("admin.roles.edit"), updateRole);
router.put("/master/role/toggle", requirePermission("admin.roles.edit"), toggle);

// ================================================================
// Menu
// ================================================================
router.post("/master/menu", requireSuperAdmin, createMenuPanel);
router.get("/master/menu", requireSuperAdmin, getAllMenu);
router.get("/master/menu/by-id", requireSuperAdmin, getMenuById);
router.put("/master/menu", requireSuperAdmin, updateMenuById);
router.put("/master/menu/toggle", requireSuperAdmin, toggleMenu);

// ================================================================
// Module
// ================================================================
router.post("/master/module", requireSuperAdmin, createModule);
router.get("/master/module", requireSuperAdmin, getAllModule);
router.get("/master/module/by-id", requireSuperAdmin, getModuleById);
router.put("/master/module", requireSuperAdmin, updateModuleById);
router.put("/master/module/toggle", requireSuperAdmin, toggleModule);

// ================================================================
// Bank
// ================================================================
router.post("/master/bank", requireSuperAdmin, createBank);
router.get("/master/bank", requireSuperAdmin, getAllBank);
router.get("/master/bank/by-id", requireSuperAdmin, getBankById);
router.put("/master/bank", requireSuperAdmin, updateBankById);
router.put("/master/bank/toggle", requireSuperAdmin, toggleBank);

// ================================================================
// Employee / Staff
// ================================================================
router.post(
  "/master/employee",
  requirePermission("admin.users.create"),
  upload.single("profile"),
  createEmployeeWithUser,
);
router.get("/master/employee", requirePermission("admin.users.view"), getAllEmployeeWithUser);
router.get("/master/employee/by-id", requirePermission("admin.users.view"), getEmplyoeeWithUserId);
router.put(
  "/master/employee",
  requirePermission("admin.users.edit"),
  upload.single("profile"),
  updateEmployeeWithUser,
);
router.put("/master/employee/toggle", requirePermission("admin.users.edit"), toggleUserStatus);
router.put("/master/employee/connect-ulb", requirePermission("admin.users.edit"), connectUlb);
router.put("/master/employee/disconnect-ulb", requirePermission("admin.users.edit"), disconnectUlb);
router.put("/master/employee/map-wards", requirePermission("admin.users.edit"), mapWardsToUser);
router.put("/master/employee/map-permission", requirePermission("admin.users.edit"), mapPermissionToUser);
router.put("/master/employee/bulk-map-permission", requirePermission("admin.users.edit"), bulkMapPermissionsToUser);
router.get("/master/employee/getMenuWithEmployee-id", requirePermission("admin.users.view"), getModuleByEmployeeId); // mobile api

// ================================================================
// Notifications
// ================================================================
router.get("/master/notifications", getNotifications);
router.patch("/master/notifications/read/:id", markNotificationRead);
router.patch("/master/notifications/read-all", markAllNotificationsRead);

export default router;
