import { z } from 'zod';

export const FinancialGoalEnum = z.enum([
  'EMERGENCY_FUND',
  'HOME_PURCHASE',
  'DEBT_FREEDOM',
  'RETIREMENT_PLANNING',
  'WEALTH_CREATION',
  'EDUCATION',
]);

export const FinancialAssistantRequestDto = z.object({
  income: z.number().positive('Monthly income must be a positive number'),
  expenses: z.number().nonnegative('Monthly expenses must be zero or a positive number'),
  savings: z.number().nonnegative('Liquid savings must be zero or a positive number'),
  debt: z.number().nonnegative('Total debt must be zero or a positive number'),
  currency: z.enum(['INR', 'USD', 'EUR', 'GBP']).default('INR'),
  financialGoals: z.array(FinancialGoalEnum).min(1, 'At least one financial goal is required'),
}).strict();

export type FinancialAssistantRequest = z.infer<typeof FinancialAssistantRequestDto>;
