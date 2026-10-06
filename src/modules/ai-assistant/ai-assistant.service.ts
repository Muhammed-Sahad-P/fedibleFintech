import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../../config';
import { FinancialAssistantRequest } from './ai-assistant.dto';
import { logger } from '../../utils/logger';

export interface FinancialAssistantResponse {
  financialHealthScore: number;
  riskTier: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'HIGH_RISK';
  metrics: {
    monthlySurplus: number;
    savingsRatePercentage: number;
    debtToAnnualIncomePercentage: number;
    emergencyFundMonths: number;
  };
  keyInsights: string[];
  actionableRecommendations: string[];
  budgetingAllocation: {
    necessitiesPercentage: number;
    savingsInvestmentPercentage: number;
    discretionaryPercentage: number;
  };
  dataPrivacyNotice: string;
}

export class AIAssistantService {
  private genAI: GoogleGenerativeAI | null = null;

  constructor() {
    if (config.ai.geminiApiKey) {
      try {
        this.genAI = new GoogleGenerativeAI(config.ai.geminiApiKey);
      } catch (err: any) {
        logger.warn('Failed to initialize Gemini AI client, falling back to deterministic engine', { error: err.message });
      }
    }
  }

  async analyzeFinancialProfile(input: FinancialAssistantRequest): Promise<FinancialAssistantResponse> {
    // 1. Calculate deterministic baseline financial metrics
    const monthlySurplus = Math.max(0, input.income - input.expenses);
    const savingsRate = Math.min(100, Math.max(0, (monthlySurplus / input.income) * 100));
    const annualIncome = input.income * 12;
    // Total Debt Balance / Annual Gross Income
    const debtRatio = annualIncome > 0 ? (input.debt / annualIncome) * 100 : 0;
    const emergencyMonths = input.expenses > 0 ? Number((input.savings / input.expenses).toFixed(1)) : 12;

    // Composite health score (0 - 100)
    let score = 50;
    if (savingsRate >= 30) score += 20;
    else if (savingsRate >= 15) score += 10;
    else if (savingsRate <= 5) score -= 15;

    if (emergencyMonths >= 6) score += 20;
    else if (emergencyMonths >= 3) score += 10;
    else if (emergencyMonths < 1) score -= 20;

    if (debtRatio < 20) score += 10;
    else if (debtRatio > 60) score -= 20;

    const normalizedScore = Math.min(100, Math.max(10, Math.round(score)));
    const riskTier = this.determineRiskTier(normalizedScore);

    // 2. If Gemini API key is configured and not in mock-only mode, enrich with LLM
    if (this.genAI && !config.ai.enableMockAi) {
      try {
        const llmResult = await this.callGeminiLLM(input, normalizedScore, riskTier, {
          monthlySurplus,
          savingsRate,
          debtRatio,
          emergencyMonths,
        });
        if (llmResult) return llmResult;
      } catch (err: any) {
        logger.warn('Gemini LLM call failed, falling back to deterministic heuristic engine', { error: err.message });
      }
    }

    // 3. Deterministic Heuristic Engine (Offline / Fallback / Fast mode)
    return this.generateDeterministicAnalysis(input, normalizedScore, riskTier, {
      monthlySurplus,
      savingsRate,
      debtRatio,
      emergencyMonths,
    });
  }

  private determineRiskTier(score: number): 'EXCELLENT' | 'GOOD' | 'FAIR' | 'HIGH_RISK' {
    if (score >= 80) return 'EXCELLENT';
    if (score >= 65) return 'GOOD';
    if (score >= 45) return 'FAIR';
    return 'HIGH_RISK';
  }

  private generateDeterministicAnalysis(
    input: FinancialAssistantRequest,
    score: number,
    riskTier: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'HIGH_RISK',
    metrics: { monthlySurplus: number; savingsRate: number; debtRatio: number; emergencyMonths: number }
  ): FinancialAssistantResponse {
    const keyInsights: string[] = [];
    const recommendations: string[] = [];

    // Insights
    if (metrics.savingsRate >= 30) {
      keyInsights.push(`Strong savings rate of ${metrics.savingsRate.toFixed(1)}%, providing excellent capital for long-term compounding.`);
    } else if (metrics.savingsRate < 15) {
      keyInsights.push(`Current savings rate of ${metrics.savingsRate.toFixed(1)}% leaves limited buffer for unforeseen market or personal shocks.`);
    }

    if (metrics.emergencyMonths >= 6) {
      keyInsights.push(`Robust liquidity reserve with ${metrics.emergencyMonths} months of essential living expenses safely preserved.`);
    } else {
      keyInsights.push(`Liquid reserve of ${metrics.emergencyMonths} months is below the recommended 3-to-6 month safety threshold.`);
    }

    // Recommendations based on goals
    if (input.financialGoals.includes('EMERGENCY_FUND') && metrics.emergencyMonths < 6) {
      recommendations.push(`Target saving ${input.currency} ${(input.expenses * 6 - input.savings).toLocaleString()} in high-yield liquid instruments to complete your emergency buffer.`);
    }

    if (input.financialGoals.includes('DEBT_FREEDOM') && input.debt > 0) {
      recommendations.push(`Apply the avalanche repayment strategy: direct 50% of your monthly surplus (${input.currency} ${(metrics.monthlySurplus * 0.5).toLocaleString()}) towards your highest-interest debt.`);
    }

    if (input.financialGoals.includes('HOME_PURCHASE')) {
      recommendations.push(`Allocate structured monthly capital into low-volatility fixed-income instruments to lock in your future home down-payment.`);
    }

    if (recommendations.length === 0) {
      recommendations.push('Maintain balanced 50/30/20 budgeting and review asset allocation quarterly.');
    }

    return {
      financialHealthScore: score,
      riskTier,
      metrics: {
        monthlySurplus: Math.round(metrics.monthlySurplus),
        savingsRatePercentage: Number(metrics.savingsRate.toFixed(1)),
        debtToAnnualIncomePercentage: Number(metrics.debtRatio.toFixed(1)),
        emergencyFundMonths: metrics.emergencyMonths,
      },
      keyInsights,
      actionableRecommendations: recommendations,
      budgetingAllocation: {
        necessitiesPercentage: 50,
        savingsInvestmentPercentage: Math.max(20, Math.round(metrics.savingsRate)),
        discretionaryPercentage: Math.max(10, 100 - 50 - Math.max(20, Math.round(metrics.savingsRate))),
      },
      dataPrivacyNotice: 'Data minimisation enforced. Zero personal identifiers transmitted. TLS in transit and encryption at rest applied.',
    };
  }

  private async callGeminiLLM(
    input: FinancialAssistantRequest,
    baselineScore: number,
    riskTier: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'HIGH_RISK',
    metrics: { monthlySurplus: number; savingsRate: number; debtRatio: number; emergencyMonths: number }
  ): Promise<FinancialAssistantResponse | null> {
    if (!this.genAI) return null;

    const model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    // Strict prompt with zero identifiers
    const prompt = `
You are a senior fintech financial health analyst. Analyze the following sanitized numeric profile:
- Monthly Income: ${input.income} ${input.currency}
- Monthly Expenses: ${input.expenses} ${input.currency}
- Liquid Savings: ${input.savings} ${input.currency}
- Total Debt: ${input.debt} ${input.currency}
- Financial Goals: ${input.financialGoals.join(', ')}

Calculated Metrics:
- Monthly Surplus: ${metrics.monthlySurplus}
- Savings Rate: ${metrics.savingsRate.toFixed(1)}%
- Debt-to-Annual-Income: ${metrics.debtRatio.toFixed(1)}%
- Emergency Fund Coverage: ${metrics.emergencyMonths} months

Respond STRICTLY with a valid JSON object matching this schema:
{
  "financialHealthScore": <number between 0 and 100>,
  "riskTier": "${riskTier}",
  "keyInsights": ["<bullet 1>", "<bullet 2>"],
  "actionableRecommendations": ["<recommendation 1>", "<recommendation 2>", "<recommendation 3>"],
  "budgetingAllocation": {
    "necessitiesPercentage": <number>,
    "savingsInvestmentPercentage": <number>,
    "discretionaryPercentage": <number>
  }
}
Do not include markdown codeblocks or other formatting outside the raw JSON.
`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const cleanJson = text.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(cleanJson);

    return {
      financialHealthScore: parsed.financialHealthScore || baselineScore,
      riskTier,
      metrics: {
        monthlySurplus: Math.round(metrics.monthlySurplus),
        savingsRatePercentage: Number(metrics.savingsRate.toFixed(1)),
        debtToAnnualIncomePercentage: Number(metrics.debtRatio.toFixed(1)),
        emergencyFundMonths: metrics.emergencyMonths,
      },
      keyInsights: parsed.keyInsights || [],
      actionableRecommendations: parsed.actionableRecommendations || [],
      budgetingAllocation: parsed.budgetingAllocation || {
        necessitiesPercentage: 50,
        savingsInvestmentPercentage: 30,
        discretionaryPercentage: 20,
      },
      dataPrivacyNotice: 'Data minimisation enforced. Zero personal identifiers transmitted. TLS in transit and encryption at rest applied.',
    };
  }
}

export const aiAssistantService = new AIAssistantService();
