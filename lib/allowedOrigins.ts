import "dotenv/config";

// API (CORS) aur socket.io dono yahi list use karte hain — FRONTEND_URL me comma se kai URL
export const ALLOWED_ORIGINS = (process.env.FRONTEND_URL ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
