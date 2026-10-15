import { AuthenticatedRequest } from "../../src/core/types";
import { panel } from "../../lib/globalprimsaclient";
import genrateResponse from "../../lib/generateResponse";
import HttpStatus from "../../lib/httpStatus";
import { Request, Response } from "express";


/**
 * sanitizeForJson
 * - converts BigInt -> string
 */
function sanitizeForJson<T>(value: T): T {
  const convert = (v: any): any => {
    if (typeof v === "bigint") return v.toString();
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map(convert);
    if (v && typeof v === "object") {
      const out: any = {};
      for (const [k, val] of Object.entries(v)) {
        out[k] = convert(val);
      }
      return out;
    }
    return v;
  };

  return convert(value) as T;
}

/**
 * GET /master/notifications
 */
export const getNotifications = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (String(req.query.unread).toLowerCase() === 'true') {
      where.is_read = false;
    }
    if (req.query.room) {
      where.room = String(req.query.room);
    }

    const [items, total] = await Promise.all([
      panel.notifications.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: limit,
        skip,
      }),
      panel.notifications.count({ where }),
    ]);

    // sanitize DB values (BigInt -> string, Date -> ISO)
    const sanitizedItems = sanitizeForJson(items);

    const payload = {
      data: sanitizedItems,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };

    genrateResponse(res, HttpStatus.OK, "Notifications fetched successfully", payload);
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}] getNotifications error:`, err);
    genrateResponse(res, err?.status || HttpStatus.BadRequest, err?.message || "Failed to fetch notifications");
  }
};

/**
 * PUT /master/notifications/read/:id
 */
export const markNotificationRead = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const idParam = req.params.id;
    if (!idParam) {
      return genrateResponse(res, HttpStatus.BadRequest, "Invalid notification id");
    }

    // If your DB id is BigInt in Prisma, convert param to BigInt or number as needed.
    // Prisma expects a number for non-BigInt id; adapt if your model uses BigInt primary key.
    const id = Number(idParam); // if notifications.id is BigInt in DB, Prisma may still accept Number

    const existing = await panel.notifications.findUnique({ where: { id } });
    if (!existing) {
      return genrateResponse(res, HttpStatus.NotFound, "Notification not found");
    }

    const updated = await panel.notifications.update({
      where: { id },
      data: { is_read: true },
    });

    const sanitized = sanitizeForJson(updated);
    genrateResponse(res, HttpStatus.OK, "Notification marked as read", sanitized);
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}] markNotificationRead error:`, err);
    genrateResponse(res, err?.status || HttpStatus.BadRequest, err?.message || "Failed to mark notification read");
  }
};

/**
 * PUT /master/notifications/read-all
 */
export const markAllNotificationsRead = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const where: any = { is_read: false };
    if (req.query.room) where.room = String(req.query.room);

    await panel.notifications.updateMany({
      where,
      data: { is_read: true },
    });

    genrateResponse(res, HttpStatus.OK, "All notifications marked as read");
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}] markAllNotificationsRead error:`, err);
    genrateResponse(res, err?.status || HttpStatus.BadRequest, err?.message || "Failed to mark all notifications read");
  }
};
