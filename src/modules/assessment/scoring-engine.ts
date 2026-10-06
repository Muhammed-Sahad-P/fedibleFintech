import { RiskTier } from './assessment.dto';

export interface QuestionWithAnswer {
  questionId: string;
  category: string;
  weight: number;
  options: Array<{ key: string; label: string; score: number }>;
  selectedOptionKey: string;
}

export interface CategoryScoreResult {
  category: string;
  score: number;
  maxScore: number;
  percentage: number;
  grade: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';
}

export interface ScoringResult {
  totalScore: number;
  riskTier: RiskTier;
  categoryScores: Record<string, CategoryScoreResult>;
  recommendations: string[];
}

export class ScoringEngine {
  private static readonly CATEGORY_WEIGHTS: Record<string, number> = {
    DEBT: 0.35,
    LIQUIDITY: 0.25,
    SAVINGS: 0.20,
    INCOME_STABILITY: 0.10,
    EXPENSES: 0.10,
  };

  public static calculate(answers: QuestionWithAnswer[]): ScoringResult {
    const categoryTotals: Record<string, { earned: number; max: number }> = {};

    for (const ans of answers) {
      const selectedOption = ans.options.find(opt => opt.key === ans.selectedOptionKey);
      const scoreValue = selectedOption ? selectedOption.score : 0;
      const maxPossibleScore = Math.max(...ans.options.map(o => o.score), 100);

      if (!categoryTotals[ans.category]) {
        categoryTotals[ans.category] = { earned: 0, max: 0 };
      }
      categoryTotals[ans.category].earned += scoreValue;
      categoryTotals[ans.category].max += maxPossibleScore;
    }

    const categoryScores: Record<string, CategoryScoreResult> = {};
    let weightedSum = 0;
    let totalWeightApplied = 0;

    for (const [category, totals] of Object.entries(categoryTotals)) {
      const percentage = totals.max > 0 ? (totals.earned / totals.max) * 100 : 0;
      const weight = this.CATEGORY_WEIGHTS[category] || 0.10;

      weightedSum += percentage * weight;
      totalWeightApplied += weight;

      categoryScores[category] = {
        category,
        score: Math.round(totals.earned),
        maxScore: Math.round(totals.max),
        percentage: Math.round(percentage),
        grade: this.gradePercentage(percentage),
      };
    }

    const compositePercentage = totalWeightApplied > 0 
      ? weightedSum / totalWeightApplied 
      : 50;

    // Credit score scaled between 300 and 900
    const totalScore = Math.min(900, Math.max(300, Math.round(300 + (compositePercentage * 6))));
    const riskTier = this.determineRiskTier(totalScore);
    const recommendations = this.generateRecommendations(categoryScores);

    return {
      totalScore,
      riskTier,
      categoryScores,
      recommendations,
    };
  }

  private static gradePercentage(pct: number): 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' {
    if (pct >= 85) return 'EXCELLENT';
    if (pct >= 70) return 'GOOD';
    if (pct >= 50) return 'FAIR';
    return 'POOR';
  }

  private static determineRiskTier(score: number): RiskTier {
    if (score >= 800) return 'EXCELLENT';
    if (score >= 700) return 'GOOD';
    if (score >= 580) return 'FAIR';
    return 'HIGH_RISK';
  }

  private static generateRecommendations(categoryScores: Record<string, CategoryScoreResult>): string[] {
    const recs: string[] = [];

    if (categoryScores['DEBT'] && categoryScores['DEBT'].percentage < 70) {
      recs.push('Prioritize paying down high-interest credit lines and keep total debt-to-income ratio below 30%.');
    }
    if (categoryScores['LIQUIDITY'] && categoryScores['LIQUIDITY'].percentage < 70) {
      recs.push('Build a dedicated emergency cash buffer covering 3 to 6 months of living expenses.');
    }
    if (categoryScores['SAVINGS'] && categoryScores['SAVINGS'].percentage < 70) {
      recs.push('Automate monthly savings to allocate at least 20% of net income into index or mutual funds.');
    }
    if (categoryScores['EXPENSES'] && categoryScores['EXPENSES'].percentage < 70) {
      recs.push('Audit fixed recurring obligations to reduce monthly fixed overhead below 50% of earnings.');
    }

    if (recs.length === 0) {
      recs.push('Maintain your solid financial discipline and continue periodic portfolio rebalancing.');
    }

    return recs;
  }
}
