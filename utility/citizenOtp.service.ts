import { panel as panelDb } from "../lib/globalprimsaclient";
import { sendWhatsappOtp } from './sendWhatsappOtp';


// ================================================================
// TYPES
// ================================================================

export type OtpModule = 'grievance' | 'property' | 'water' | 'shop' | string;
export type OtpAction = 'SUBMIT' | 'TRACK' | 'PAYMENT' | 'VERIFY' | string;

export interface GenerateOtpParams {
    identifier: string;   // 10-digit mobile number
    module?: OtpModule;
    action: OtpAction;
    ulb_id?: number;
    ip_address?: string;
    expiryMinutes?: number; // default: 5
}

export interface VerifyOtpParams {
    reference_id: string; // UUID returned from generateOtp
    otp: string;          // 6-digit OTP entered by citizen
}

export type OtpVerifyStatus =
    | 'VERIFIED'
    | 'WRONG_OTP'
    | 'EXPIRED'
    | 'ALREADY_USED'
    | 'MAX_ATTEMPTS_EXCEEDED'
    | 'NOT_FOUND';

export interface OtpVerifyResult {
    isValid: boolean;
    status: OtpVerifyStatus;
    message: string;
    attemptsLeft?: number;
}

// ================================================================
// OTP SERVICE
// Global citizen OTP engine — no auth required, used across all modules
// ================================================================

/**
 * Generate a 6-digit OTP, store it in DB, send via WhatsApp.
 * Returns the `reference_id` (UUID) to pass back to the frontend.
 *
 * The frontend must send this `reference_id` + the OTP entered by
 * the citizen back to the verify endpoint.
 */
export async function generateAndSendOtp(params: GenerateOtpParams): Promise<string> {
    const { identifier, module, action, ulb_id, ip_address, expiryMinutes = 5 } = params;

    // Invalidate any previous unused OTPs for same phone + module + action
    // (prevents confusion if citizen requests OTP multiple times)
    await panelDb.citizen_otp.updateMany({
        where: {
            identifier,
            module: module ?? null,
            action,
            is_used: false,
            expires_at: { gt: new Date() },
        },
        data: { is_used: true }, // Mark old ones as used so they're dead
    });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expires_at = new Date(Date.now() + expiryMinutes * 60 * 1000);

    const record = await panelDb.citizen_otp.create({
        data: {
            identifier,
            module: module ?? null,
            action,
            ulb_id: ulb_id ?? null,
            ip_address: ip_address ?? null,
            otp,
            expires_at,
        },
    });

    // Send OTP via WhatsApp (non-blocking — failure doesn't break flow)
    const result = await sendWhatsappOtp(identifier, 'otp_services_new', [otp], 'en_US');


    return record.id; // reference_id returned to frontend
}

/**
 * Verify an OTP by reference_id + citizen-entered otp.
 *
 * Returns a structured result with status and message for the controller
 * to pass directly to the frontend — handles all edge cases cleanly.
 */
export async function verifyOtp(params: VerifyOtpParams): Promise<OtpVerifyResult> {
    const { reference_id, otp } = params;

    const record = await panelDb.citizen_otp.findUnique({
        where: { id: reference_id },
    });

    // Case 1: Reference not found
    if (!record) {
        return { isValid: false, status: 'NOT_FOUND', message: 'Invalid OTP reference. Please request a new OTP.' };
    }

    // Case 2: Already used (replay attack prevention)
    if (record.is_used) {
        return { isValid: false, status: 'ALREADY_USED', message: 'This OTP has already been used. Please request a new OTP.' };
    }

    // Case 3: Expired
    if (new Date() > record.expires_at) {
        return { isValid: false, status: 'EXPIRED', message: 'OTP has expired. Please request a new one.' };
    }

    // Case 4: Max attempts exceeded (locked)
    if (record.attempts >= record.max_attempts) {
        return { isValid: false, status: 'MAX_ATTEMPTS_EXCEEDED', message: 'Too many incorrect attempts. Please request a new OTP.' };
    }

    // Case 5: Wrong OTP — increment attempts
    if (record.otp !== otp) {
        const updated = await panelDb.citizen_otp.update({
            where: { id: reference_id },
            data: { attempts: { increment: 1 } },
        });
        const attemptsLeft = record.max_attempts - updated.attempts;
        return {
            isValid: false,
            status: 'WRONG_OTP',
            message: `Incorrect OTP. ${attemptsLeft} attempt(s) remaining.`,
            attemptsLeft,
        };
    }

    // Case 6: SUCCESS — mark as used
    await panelDb.citizen_otp.update({
        where: { id: reference_id },
        data: { is_used: true },
    });

    return { isValid: true, status: 'VERIFIED', message: 'OTP verified successfully.' };
}

/**
 * Check if an identifier has sent too many OTPs in the last hour
 * (rate-limit guard — call this before generateAndSendOtp)
 */
export async function isRateLimited(identifier: string, limitPerHour = 5): Promise<boolean> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const count = await panelDb.citizen_otp.count({
        where: {
            identifier,
            created_at: { gte: oneHourAgo },
        },
    });
    return count >= limitPerHour;
}
