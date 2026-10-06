import { z } from 'zod';

export const SubmitAnswerItemDto = z.object({
  questionId: z.string().uuid('Question ID must be a valid UUID'),
  selectedOptionKey: z.string().min(1).max(5, 'Invalid option key'),
}).strict();

export const SubmitAnswersDto = z.object({
  answers: z.array(SubmitAnswerItemDto).min(1, 'At least one answer must be submitted'),
}).strict();

export type SubmitAnswersInput = z.infer<typeof SubmitAnswersDto>;

export const RiskTierEnum = z.enum(['EXCELLENT', 'GOOD', 'FAIR', 'HIGH_RISK']);
export type RiskTier = z.infer<typeof RiskTierEnum>;
