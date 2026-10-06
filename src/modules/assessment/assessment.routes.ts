import { Router } from 'express';
import { assessmentController } from './assessment.controller';
import { authenticateJwt } from '../../middlewares/auth.middleware';
import { rateLimiter } from '../../middlewares/rate-limiter.middleware';

const router = Router();

// All assessment routes require authenticated user
router.use(authenticateJwt);

// 1. Create Assessment (Rate limited: 30 requests / min)
router.post(
  '/',
  rateLimiter({ maxRequests: 30, windowSeconds: 60, keyPrefix: 'assessment_create' }),
  (req, res, next) => assessmentController.startAssessment(req, res, next)
);

// 2. Submit Answers
router.post(
  '/:id/answers',
  rateLimiter({ maxRequests: 30, windowSeconds: 60, keyPrefix: 'assessment_answers' }),
  (req, res, next) => assessmentController.submitAnswers(req, res, next)
);

// 3. Get Assessment Result (Cached with Redis)
router.get(
  '/:id/result',
  rateLimiter({ maxRequests: 60, windowSeconds: 60, keyPrefix: 'assessment_result' }),
  (req, res, next) => assessmentController.getResult(req, res, next)
);

export const assessmentRoutes = router;
