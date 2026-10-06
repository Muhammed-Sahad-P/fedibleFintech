import { Request, Response, NextFunction } from 'express';
import { assessmentService } from './assessment.service';
import { SubmitAnswersDto } from './assessment.dto';
import { sendSuccess } from '../../utils/response';

export class AssessmentController {
  async startAssessment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const result = await assessmentService.startAssessment(userId);
      sendSuccess(res, result, 'Assessment created successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  async submitAnswers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const assessmentId = req.params.id;
      const validated = SubmitAnswersDto.parse(req.body);
      const result = await assessmentService.submitAnswers(assessmentId, userId, validated);
      sendSuccess(res, result, 'Answers submitted and score computed successfully', 200);
    } catch (error) {
      next(error);
    }
  }

  async getResult(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const assessmentId = req.params.id;
      const result = await assessmentService.getAssessmentResult(assessmentId, userId);

      if (result._cacheHit) {
        res.setHeader('X-Cache', 'HIT');
      } else {
        res.setHeader('X-Cache', 'MISS');
      }

      const { _cacheHit, ...data } = result;
      sendSuccess(res, data, 'Assessment result retrieved successfully', 200);
    } catch (error) {
      next(error);
    }
  }
}

export const assessmentController = new AssessmentController();
