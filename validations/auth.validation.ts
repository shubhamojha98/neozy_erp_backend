import { z } from "zod";
import { password } from "./common.validation";

// Change password — purana password se pehchaan (OTP nahi). "Username na ho" wala check controller me (username DB se)
export const changePasswordSchema = z.object({
  currentPassword: z.string({ error: "Current password is required" }).min(1, { error: "Current password is required" }),
  newPassword: password(),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
