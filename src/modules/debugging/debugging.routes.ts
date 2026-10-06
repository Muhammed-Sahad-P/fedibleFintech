import { Router } from 'express';
import { debuggingController } from './debugging.controller';
import { authenticateJwt } from '../../middlewares/auth.middleware';
import { config } from '../../config';

const router = Router();

if (config.debug.enableBenchmarks) {
  // Debug endpoints protected by auth and feature flag
  router.use(authenticateJwt);

  router.get('/slow-assessment-report', (req, res, next) =>
    debuggingController.getSlowReport(req, res, next)
  );

  router.get('/optimized-assessment-report', (req, res, next) =>
    debuggingController.getOptimizedReport(req, res, next)
  );
}

export const debuggingRoutes = router;
