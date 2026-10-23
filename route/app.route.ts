import express, { Request, Response } from "express";
import { authMiddleware, requireSuperAdmin } from "../middleware/authMiddleware";
import { dynamicCheckPermission } from "../middleware/dynamicPermission";
import { sendOtpHandler } from "../controller/external/whatsapp.controller";
import { proxyImageHandler } from "../controller/external/imageProxy.controller";
import rateLimit from "express-rate-limit";

// Module Routes
import authRoute from "./auth/auth.route";
import panelRoute from "./panel/panel.route";
import inventoryRoutes from "./inventory/invenotry.route";
import projectRoutes from "./project/project.route";
import salesOrderRoutes from "./sales-order/sales-order.route";
import leadRoutes from "./lead/lead.routes";
import customerRoutes from "./customer/customer.route";
import platformRoutes from "./platform/platform.route";



const router = express.Router();

/**
 * Health Check & Basic Info
 */
router.get("/", (req: Request, res: Response) => {
  res.send("ERP Panel API");
});

/**
 * Public Routes (No Auth Required)
 */
router.use("/api/auth", authRoute);
router.use("/api/platform", authMiddleware, requireSuperAdmin, platformRoutes); // super admin only
router.post("/api/whatsapp/otp", sendOtpHandler);

const proxyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 800,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many image preview requests. Please try again later." }
});

router.get("/api/proxy-image", proxyLimiter, proxyImageHandler);


router.use(authMiddleware);
router.use(dynamicCheckPermission());

router.use("/api/panel", panelRoute);
router.use("/api/inventory", inventoryRoutes);
router.use("/api/project", projectRoutes);
router.use("/api/sales-order", salesOrderRoutes);
router.use("/api/lead", leadRoutes);
router.use("/api/customer", customerRoutes);

export default router;
