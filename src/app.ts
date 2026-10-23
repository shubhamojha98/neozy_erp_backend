import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import masterRouter from '../route/app.route';
import { ALLOWED_ORIGINS } from '../lib/allowedOrigins';

const app = express();

// Swagger Setup
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('../swagger-output.json');

export const createApp = () => {
    // 1. Core Middlewares
    // Security headers — CSP off (API sirf JSON deta hai, aur Swagger UI CSP se toot jata hai)
    // same-site: frontend (localhost:3000 / app.domain) PDF / image preview khol sake
    app.use(helmet({
        contentSecurityPolicy: false,
        crossOriginResourcePolicy: { policy: 'same-site' },
    }));

    // Sirf apne frontend se — FRONTEND_URL me comma se kai URL de sakte ho
    app.use(cors({
        origin: ALLOWED_ORIGINS,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        exposedHeaders: ['Content-Disposition'],
    }));

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // 2. Rate Limiters
    // Login: max 20 attempts per IP per 15 minutes (brute-force protection)
    app.use('/api/auth/login', rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 20,
        standardHeaders: true,
        legacyHeaders: false,
        message: {
            success: false,
            message: 'Too many login attempts. Please try again after 15 minutes.'
        }
    }));

    // Refresh token: max 200 per 15 minutes per IP (access token 15 min ka hai, office me ek IP par kai users)
    app.use('/api/auth/refresh', rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 200,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, message: 'Too many refresh requests.' }
    }));

    // Change password: max 10 per 15 minutes per IP (purana password guess na ho)
    app.use('/api/auth/change-password', rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 10,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, message: 'Too many attempts. Please try again after 15 minutes.' }
    }));

    // 3. Documentation
    // uploads/ public nahi hai (Aadhaar, bill ...) — files sirf document API se, login + scope check ke baad
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

    // 4. Routing Layer
    app.use(masterRouter);

    // 5. Global Error Handler
    app.use((err: any, req: Request, res: Response, next: NextFunction) => {
        const status = err.status || err.statusCode || 500;
        const message = err.message || 'Internal server error';

        // Log full error server-side
        console.error(`[${new Date().toISOString()}] [ERROR] ${req.method} ${req.originalUrl} →`, err);

        res.status(status).json({
            success: false,
            message,
            ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
        });
    });

    return app;
};

export default app;
