import { Router } from 'express';
import { aiAssistantController } from './ai-assistant.controller';
import { authenticateJwt } from '../../middlewares/auth.middleware';
import { rateLimiter } from '../../middlewares/rate-limiter.middleware';

const router = Router();

// Financial AI Assistant endpoint (Protected & Rate Limited)
router.post(
  '/financial-assistant',
  authenticateJwt,
  rateLimiter({ maxRequests: 15, windowSeconds: 60, keyPrefix: 'ai_assistant' }),
  (req, res, next) => aiAssistantController.getFinancialAnalysis(req, res, next)
);

export const aiAssistantRoutes = router;
