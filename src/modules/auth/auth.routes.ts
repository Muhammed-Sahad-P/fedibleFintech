import { Router } from 'express';
import { authController } from './auth.controller';
import { authenticateJwt } from '../../middlewares/auth.middleware';
import { rateLimiter } from '../../middlewares/rate-limiter.middleware';

const router = Router();

// Public Auth Endpoints with Rate Limiting (max 20 attempts per minute)
router.post('/register', rateLimiter({ maxRequests: 20, windowSeconds: 60, keyPrefix: 'auth_register' }), (req, res, next) => authController.register(req, res, next));
router.post('/login', rateLimiter({ maxRequests: 20, windowSeconds: 60, keyPrefix: 'auth_login' }), (req, res, next) => authController.login(req, res, next));

// Protected Profile Endpoint
router.get('/me', authenticateJwt, (req, res, next) => authController.getMe(req, res, next));

export const authRoutes = router;
