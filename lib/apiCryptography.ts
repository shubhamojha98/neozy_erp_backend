import crypto from 'crypto';
import { config } from 'dotenv'

config()
const ENCRYPTION_KEY = process.env.API_ENCRYPTION_KEY as string;

const keyBuffer = Buffer.from(ENCRYPTION_KEY, 'hex');

export function encryptData(data: any) {
    const iv = crypto.randomBytes(16);
    const jsonData = JSON.stringify(data);
    const cipher = crypto.createCipheriv('aes-256-cbc', keyBuffer, iv);
    let encrypted = cipher.update(jsonData, 'utf-8', 'hex');
    encrypted += cipher.final('hex');

    return {
        iv: iv.toString('hex'),
        encryptedData: encrypted,
    };
}

export function decryptData({ encryptedData, iv }: { encryptedData: string; iv: string }) {
    const ivBuffer = Buffer.from(iv, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuffer, ivBuffer);
    let decrypted = decipher.update(encryptedData, 'hex', 'utf-8');
    decrypted += decipher.final('utf-8');

    return JSON.parse(decrypted);
}

// Helper to accept both encrypted and plain payloads seamlessly
export function extractPayload(payload: any) {
    if (payload && payload.encryptedData && payload.iv) {
        try {
            return decryptData({ encryptedData: payload.encryptedData as string, iv: payload.iv as string });
        } catch (err) {
            throw new Error("Invalid encrypted payload");
        }
    }
    return payload;
}