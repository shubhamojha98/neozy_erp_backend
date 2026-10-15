import express from "express";
import { login, switchCompany } from "../../controller/auth/auth.controller";
import { authMiddleware } from "../../middleware/authMiddleware";

const router = express.Router();

// Public
router.post("/login", login);
router.post("/switch-company", authMiddleware, switchCompany);
// router.post("/refresh", refreshAccessToken);
// router.post("/verify-otp", verifyOTP);
// router.post("/resend-otp", resendLoginOtp);
// router.post("/request-reset-password", requestResetPassword);
// router.post("/reset-password", resetPassword);

// // Protected (requires valid access token)
// router.get("/me", authMiddleware, getMe);
// router.post("/logout", authMiddleware, logoutUser);
// router.post("/switch-company", authMiddleware, switchCompany);
// router.post("/change-password/otp", authMiddleware, requestChangePasswordOTP);
// router.post("/change-password/verify", authMiddleware, verifyChangePassword);

export default router;
