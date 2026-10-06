import { db } from '../../database/pool';
import { ScoringResult } from './scoring-engine';

export interface QuestionEntity {
  id: string;
  code: string;
  prompt: string;
  category: string;
  weight: number;
  options: Array<{ key: string; label: string; score: number }>;
}

export interface AssessmentEntity {
  id: string;
  user_id: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'EXPIRED';
  total_score: number | null;
  risk_tier: string | null;
  score_breakdown: any;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export class AssessmentRepository {
  async getActiveQuestions(): Promise<QuestionEntity[]> {
    const result = await db.query<QuestionEntity>(
      'SELECT id, code, prompt, category, weight, options FROM questions WHERE is_active = TRUE ORDER BY created_at ASC'
    );
    return result.rows;
  }

  async getQuestionsByIds(ids: string[]): Promise<QuestionEntity[]> {
    const result = await db.query<QuestionEntity>(
      'SELECT id, code, prompt, category, weight, options FROM questions WHERE id = ANY($1::uuid[])',
      [ids]
    );
    return result.rows;
  }

  async createAssessment(userId: string): Promise<AssessmentEntity> {
    const result = await db.query<AssessmentEntity>(
      `INSERT INTO assessments (user_id, status)
       VALUES ($1, 'IN_PROGRESS')
       RETURNING id, user_id, status, total_score, risk_tier, score_breakdown, completed_at, created_at, updated_at`,
      [userId]
    );
    return result.rows[0];
  }

  async findAssessmentById(id: string): Promise<AssessmentEntity | null> {
    const result = await db.query<AssessmentEntity>(
      'SELECT id, user_id, status, total_score, risk_tier, score_breakdown, completed_at, created_at, updated_at FROM assessments WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  async saveAnswersAndScore(
    assessmentId: string,
    answers: Array<{ questionId: string; selectedOptionKey: string; scoreValue: number }>,
    scoring: ScoringResult
  ): Promise<AssessmentEntity> {
    return await db.transaction(async (client) => {
      // 1. Delete any existing answers for this assessment (clean idempotency)
      await client.query('DELETE FROM answers WHERE assessment_id = $1', [assessmentId]);

      // 2. Insert submitted answers in batch
      for (const ans of answers) {
        await client.query(
          `INSERT INTO answers (assessment_id, question_id, selected_option_key, score_value)
           VALUES ($1, $2, $3, $4)`,
          [assessmentId, ans.questionId, ans.selectedOptionKey, ans.scoreValue]
        );
      }

      // 3. Delete existing category scores
      await client.query('DELETE FROM scores WHERE assessment_id = $1', [assessmentId]);

      // 4. Insert category scores
      for (const [cat, res] of Object.entries(scoring.categoryScores)) {
        await client.query(
          `INSERT INTO scores (assessment_id, category, category_score, max_score, metadata)
           VALUES ($1, $2, $3, $4, $5)`,
          [assessmentId, cat, res.score, res.maxScore, JSON.stringify(res)]
        );
      }

      // 5. Update assessment status, total score, and recommendations
      const updated = await client.query<AssessmentEntity>(
        `UPDATE assessments
         SET status = 'COMPLETED',
             total_score = $1,
             risk_tier = $2,
             score_breakdown = $3,
             completed_at = NOW(),
             updated_at = NOW()
         WHERE id = $4
         RETURNING id, user_id, status, total_score, risk_tier, score_breakdown, completed_at, created_at, updated_at`,
        [scoring.totalScore, scoring.riskTier, JSON.stringify(scoring), assessmentId]
      );

      return updated.rows[0];
    });
  }

  // Optimized single-query assessment lookup (No N+1)
  async getDetailedAssessmentResult(assessmentId: string, userId: string): Promise<any | null> {
    const query = `
      SELECT 
        a.id,
        a.user_id,
        a.status,
        a.total_score,
        a.risk_tier,
        a.score_breakdown,
        a.completed_at,
        a.created_at,
        (
          SELECT json_agg(json_build_object(
            'category', s.category,
            'score', s.category_score,
            'maxScore', s.max_score,
            'metadata', s.metadata
          ))
          FROM scores s
          WHERE s.assessment_id = a.id
        ) AS category_scores,
        (
          SELECT json_agg(json_build_object(
            'questionId', ans.question_id,
            'questionCode', q.code,
            'selectedOptionKey', ans.selected_option_key,
            'scoreValue', ans.score_value
          ))
          FROM answers ans
          JOIN questions q ON q.id = ans.question_id
          WHERE ans.assessment_id = a.id
        ) AS submitted_answers
      FROM assessments a
      WHERE a.id = $1 AND a.user_id = $2;
    `;

    const result = await db.query(query, [assessmentId, userId]);
    return result.rows[0] || null;
  }
}

export const assessmentRepository = new AssessmentRepository();
