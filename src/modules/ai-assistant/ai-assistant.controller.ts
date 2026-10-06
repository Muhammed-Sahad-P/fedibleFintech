import { Request, Response, NextFunction } from 'express';
import { aiAssistantService } from './ai-assistant.service';
import { FinancialAssistantRequestDto } from './ai-assistant.dto';
import { sendSuccess } from '../../utils/response';

export class AIAssistantController {
  async getFinancialAnalysis(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const validated = FinancialAssistantRequestDto.parse(req.body);
      const result = await aiAssistantService.analyzeFinancialProfile(validated);
      sendSuccess(res, result, 'Financial health analysis generated successfully', 200);
    } catch (error) {
      next(error);
    }
  }
}

export const aiAssistantController = new AIAssistantController();
