import { Response } from "express";
import { Prisma } from "../../generated/panel/client";
import { panel } from "../../lib/globalprimsaclient";
import genrateResponse from "../../lib/generateResponse";
import HttpStatus from "../../lib/httpStatus";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

// Notifications — har user sirf APNE dekh / read kar sakta hai
// Active company ke + bina company wale (system) notifications

const myNotifications = (req: AuthenticatedRequest): Prisma.NotificationWhereInput => ({
  user_id: req.user!.userId,
  OR: [{ company_id: null }, ...(req.user!.company ? [{ company_id: req.user!.company.id }] : [])],
});

// ============================================================
// LIST — ?page=1&limit=20&unread=true
// ============================================================
export const getNotifications = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const where: Prisma.NotificationWhereInput = {
      ...myNotifications(req),
      ...(req.query.unread === "true" && { read_at: null }),
    };

    const [rows, total, unread] = await Promise.all([
      panel.notification.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: { id: true, title: true, message: true, type: true, link: true, entity_type: true, entity_id: true, read_at: true, created_at: true },
      }),
      panel.notification.count({ where }),
      panel.notification.count({ where: { ...myNotifications(req), read_at: null } }),
    ]);

    return genrateResponse(res, HttpStatus.OK, "Notifications", { rows, total, unread, page, limit });
  } catch (err) {
    console.error("[GetNotifications]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to load notifications");
  }
};

// ============================================================
// MARK READ — ek notification
// ============================================================
export const markNotificationRead = async (req: AuthenticatedRequest, res: Response) => {
  try {
    // updateMany + user filter → dusre ka notification id bhejo to bhi kuch nahi badlega
    const result = await panel.notification.updateMany({
      where: { id: Number(req.params.id), ...myNotifications(req), read_at: null },
      data: { read_at: new Date() },
    });
    if (result.count === 0) return genrateResponse(res, HttpStatus.NotFound, "Notification not found or already read");
    return genrateResponse(res, HttpStatus.OK, "Notification marked as read");
  } catch (err) {
    console.error("[MarkNotificationRead]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to mark notification as read");
  }
};

// ============================================================
// MARK ALL READ
// ============================================================
export const markAllNotificationsRead = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await panel.notification.updateMany({
      where: { ...myNotifications(req), read_at: null },
      data: { read_at: new Date() },
    });
    return genrateResponse(res, HttpStatus.OK, `${result.count} notification(s) marked as read`);
  } catch (err) {
    console.error("[MarkAllNotificationsRead]", err);
    return genrateResponse(res, HttpStatus.InternalServerError, "Failed to mark notifications as read");
  }
};
