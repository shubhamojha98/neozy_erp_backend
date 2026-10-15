import express from "express";
import { getPlatformDashboard } from "../../controller/platform/dashboard.controller";

const router = express.Router();

router.get("/dashboard", getPlatformDashboard);

export default router;
