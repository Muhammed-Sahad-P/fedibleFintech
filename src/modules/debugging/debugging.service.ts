import { db } from '../../database/pool';
import { redis } from '../../redis/client';
import { logger } from '../../utils/logger';

export class DebuggingService {
  /**
   * BUGGY ENDPOINT: Demonstrates N+1 Query Problem & Unindexed Scan
   */
  async getSlowAssessmentReport(userId: string, limit: number = 50) {
    const start = Date.now();
    let queryCount = 0;

    // 1. Initial query: Fetches assessments (Unindexed table scan if sorting without index)
    queryCount++;
    const assessmentsRes = await db.query(
      'SELECT id, user_id, status, total_score, risk_tier, created_at FROM assessments WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, limit]
    );

    const assessments = assessmentsRes.rows;
    const detailedResults: any[] = [];

    // 2. N+1 PROBLEM: Iterating through each assessment and executing individual child queries
    for (const a of assessments) {
      queryCount++;
      const answersRes = await db.query(
        'SELECT question_id, selected_option_key, score_value FROM answers WHERE assessment_id = $1',
        [a.id]
      );

      queryCount++;
      const scoresRes = await db.query(
        'SELECT category, category_score, max_score FROM scores WHERE assessment_id = $1',
        [a.id]
      );

      detailedResults.push({
        ...a,
        answers: answersRes.rows,
        categoryScores: scoresRes.rows,
      });
    }

    const durationMs = Date.now() - start;

    return {
      performanceProfile: {
        mode: 'UNOPTIMIZED_N_PLUS_1',
        totalAssessmentsFetched: assessments.length,
        totalDbQueriesExecuted: queryCount,
        executionDurationMs: durationMs,
        bottleneck: 'N+1 Query Loop: 1 parent query + (2 * N) child queries executing sequentially over the network',
      },
      data: detailedResults,
    };
  }

  /**
   * OPTIMIZED ENDPOINT: Single Relational Query with JSON Aggregation & Composite Index
   */
  async getOptimizedAssessmentReport(userId: string, limit: number = 50) {
    const start = Date.now();

    // Single query using relational JSON aggregation (No N+1)
    const query = `
      SELECT 
        a.id,
        a.user_id,
        a.status,
        a.total_score,
        a.risk_tier,
        a.created_at,
        COALESCE(
          (
            SELECT json_agg(json_build_object(
              'question_id', ans.question_id,
              'selected_option_key', ans.selected_option_key,
              'score_value', ans.score_value
            ))
            FROM answers ans
            WHERE ans.assessment_id = a.id
          ), '[]'::json
        ) AS answers,
        COALESCE(
          (
            SELECT json_agg(json_build_object(
              'category', s.category,
              'category_score', s.category_score,
              'max_score', s.max_score
            ))
            FROM scores s
            WHERE s.assessment_id = a.id
          ), '[]'::json
        ) AS category_scores
      FROM assessments a
      WHERE a.user_id = $1
      ORDER BY a.created_at DESC
      LIMIT $2;
    `;

    const result = await db.query(query, [userId, limit]);
    const durationMs = Date.now() - start;

    return {
      performanceProfile: {
        mode: 'OPTIMIZED_SINGLE_QUERY',
        totalAssessmentsFetched: result.rows.length,
        totalDbQueriesExecuted: 1,
        executionDurationMs: durationMs,
        optimizationStrategy: 'Single SQL query utilizing JSON aggregation + composite B-tree index on (user_id, created_at DESC)',
      },
      data: result.rows,
    };
  }
}

export const debuggingService = new DebuggingService();
