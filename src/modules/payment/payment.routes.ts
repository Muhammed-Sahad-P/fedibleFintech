import { Router } from 'express';
import { paymentController } from './payment.controller';
import { authenticateJwt, requireRole } from '../../middlewares/auth.middleware';
import { rateLimiter } from '../../middlewares/rate-limiter.middleware';

const router = Router();

// 1. Webhook Ingress (Public, HMAC Signed, Rate Limited)
router.post(
  '/webhooks/payment',
  rateLimiter({ maxRequests: 120, windowSeconds: 60, keyPrefix: 'webhook_payment' }),
  (req, res, next) => paymentController.handleWebhook(req, res, next)
);

// 2. Mock Gateway Checkout Simulator (For testing & demo flow)
router.post(
  '/payments/mock-gateway/process',
  (req, res, next) => paymentController.processMockPayment(req, res, next)
);

// 3. Authenticated Payment Routes
router.post(
  '/payments/create',
  authenticateJwt,
  rateLimiter({ maxRequests: 20, windowSeconds: 60, keyPrefix: 'payment_create' }),
  (req, res, next) => paymentController.createPayment(req, res, next)
);

router.get(
  '/payments/:referenceId',
  authenticateJwt,
  (req, res, next) => paymentController.getPaymentStatus(req, res, next)
);

// 4. Task 8 DB Crash Simulation Helper (Authenticated)
router.post(
  '/payments/simulate-crash',
  authenticateJwt,
  (req, res, next) => paymentController.simulateCrashScenario(req, res, next)
);

// 5. Admin-Only Payment Reconciliation Worker Trigger (Task 8)
router.post(
  '/payments/reconcile',
  authenticateJwt,
  requireRole('ADMIN'),
  (req, res, next) => paymentController.reconcilePayments(req, res, next)
);

export const paymentRoutes = router;
