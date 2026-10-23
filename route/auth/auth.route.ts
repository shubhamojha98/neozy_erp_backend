import express from "express";
import { changePassword, login, logout, refreshAccessToken, switchCompany } from "../../controller/auth/auth.controller";
import { authMiddleware } from "../../middleware/authMiddleware";
import { validate } from "../../middleware/validate";
import { changePasswordSchema } from "../../validations/auth.validation";

const router = express.Router();

// Public
router.post("/login", login);
router.post("/refresh", refreshAccessToken);
router.post("/logout", logout); // refresh token se session band karta hai

// Protected
router.post("/switch-company", authMiddleware, switchCompany);
router.post("/change-password", authMiddleware, validate(changePasswordSchema), changePassword);

export default router;
