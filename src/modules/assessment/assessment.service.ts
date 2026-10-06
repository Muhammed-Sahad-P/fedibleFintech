import { assessmentRepository } from './assessment.repository';
import { SubmitAnswersInput } from './assessment.dto';
import { ScoringEngine, QuestionWithAnswer } from './scoring-engine';
import { redis } from '../../redis/client';
import { NotFoundError, BadRequestError } from '../../utils/errors';
import { logger } from '../../utils/logger';

export class AssessmentService {
  private readonly CACHE_TTL_SECONDS = 3600; // 1 Hour

  async startAssessment(userId: string) {
    const questions = await assessmentRepository.getActiveQuestions();
    const assessment = await assessmentRepository.createAssessment(userId);

    return {
      assessmentId: assessment.id,
      status: assessment.status,
      createdAt: assessment.created_at,
      questions: questions.map(q => ({
        id: q.id,
        code: q.code,
        prompt: q.prompt,
        category: q.category,
        options: q.options.map(o => ({ key: o.key, label: o.label })),
      })),
    };
  }

  async submitAnswers(assessmentId: string, userId: string, input: SubmitAnswersInput) {
    const assessment = await assessmentRepository.findAssessmentById(assessmentId);
    if (!assessment) {
      throw new NotFoundError('Assessment not found');
    }

    if (assessment.user_id !== userId) {
      throw new NotFoundError('Assessment not found');
    }

    // 1. Fetch relevant questions for scoring validation
    const questionIds = input.answers.map(a => a.questionId);
    const questions = await assessmentRepository.getQuestionsByIds(questionIds);
    const questionMap = new Map(questions.map(q => [q.id, q]));

    const questionsWithAnswers: QuestionWithAnswer[] = [];
    const answersToSave: Array<{ questionId: string; selectedOptionKey: string; scoreValue: number }> = [];

    for (const ans of input.answers) {
      const q = questionMap.get(ans.questionId);
      if (!q) {
        throw new BadRequestError(`Question ID ${ans.questionId} is invalid or inactive`);
      }

      const selectedOption = q.options.find(o => o.key === ans.selectedOptionKey);
      if (!selectedOption) {
        throw new BadRequestError(`Invalid option '${ans.selectedOptionKey}' for question ${q.code}`);
      }

      questionsWithAnswers.push({
        questionId: q.id,
        category: q.category,
        weight: q.weight,
        options: q.options,
        selectedOptionKey: ans.selectedOptionKey,
      });

      answersToSave.push({
        questionId: q.id,
        selectedOptionKey: ans.selectedOptionKey,
        scoreValue: selectedOption.score,
      });
    }

    // 2. Compute Feditscore
    const scoringResult = ScoringEngine.calculate(questionsWithAnswers);

    // 3. Save answers and results in database transaction
    const updatedAssessment = await assessmentRepository.saveAnswersAndScore(
      assessmentId,
      answersToSave,
      scoringResult
    );

    // 4. Invalidate Redis cache for this assessment
    const cacheKey = `feditscore:assessment:${assessmentId}:result`;
    await redis.del(cacheKey);
    logger.info('Purged Redis score cache on answer submission', { assessmentId, cacheKey });

    return {
      assessmentId: updatedAssessment.id,
      status: updatedAssessment.status,
      totalScore: updatedAssessment.total_score,
      riskTier: updatedAssessment.risk_tier,
      completedAt: updatedAssessment.completed_at,
    };
  }

  async getAssessmentResult(assessmentId: string, userId: string) {
    const cacheKey = `feditscore:assessment:${assessmentId}:result`;

    // 1. Check Redis Cache
    const cachedResult = await redis.get<any>(cacheKey);
    if (cachedResult && cachedResult.userId === userId) {
      return {
        ...cachedResult.data,
        _cacheHit: true,
      };
    }

    // 2. Fetch from Database (Single optimized query)
    const record = await assessmentRepository.getDetailedAssessmentResult(assessmentId, userId);
    if (!record) {
      throw new NotFoundError('Assessment result not found');
    }

    if (record.status !== 'COMPLETED') {
      return {
        assessmentId: record.id,
        status: record.status,
        message: 'Assessment is still in progress. Please submit all answers to view the result.',
        _cacheHit: false,
      };
    }

    const responseData = {
      assessmentId: record.id,
      status: record.status,
      totalScore: record.total_score,
      riskTier: record.risk_tier,
      breakdown: record.score_breakdown,
      categoryScores: record.category_scores,
      completedAt: record.completed_at,
    };

    // 3. Store in Redis Cache with 1-hour TTL
    await redis.set(cacheKey, { userId, data: responseData }, this.CACHE_TTL_SECONDS);

    return {
      ...responseData,
      _cacheHit: false,
    };
  }
}

export const assessmentService = new AssessmentService();
