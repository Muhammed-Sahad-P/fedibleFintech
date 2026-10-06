import { Request, Response, NextFunction } from 'express';
import { debuggingService } from './debugging.service';
import { sendSuccess } from '../../utils/response';

export class DebuggingController {
  async getSlowReport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const limit = parseInt(req.query.limit as string || '20', 10);
      const result = await debuggingService.getSlowAssessmentReport(userId, limit);
      sendSuccess(res, result, 'Slow assessment report generated (N+1 demonstration)', 200);
    } catch (error) {
      next(error);
    }
  }

  async getOptimizedReport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const limit = parseInt(req.query.limit as string || '20', 10);
      const result = await debuggingService.getOptimizedAssessmentReport(userId, limit);
      sendSuccess(res, result, 'Optimized assessment report generated (1 Query)', 200);
    } catch (error) {
      next(error);
    }
  }
}

export const debuggingController = new DebuggingController();
