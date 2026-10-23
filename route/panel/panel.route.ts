import express from "express";
import { getNotifications, markAllNotificationsRead, markNotificationRead } from "../../controller/panel/notification.controller";
import { validId } from "../../middleware/validId";
import adminRoutes from "../admin/admin.route";

const router = express.Router();
["id"].forEach((name) => router.param(name, validId)); // galat id → 404

// Administration — Roles & Users (/api/panel/roles, /api/panel/users)
router.use(adminRoutes);

// Notifications — har user sirf apne (login ke baad sabke liye khule, dynamicPermission OPEN_PATHS)
router.get("/master/notifications", getNotifications);
router.patch("/master/notifications/read/:id", markNotificationRead);
router.patch("/master/notifications/read-all", markAllNotificationsRead);

export default router;
