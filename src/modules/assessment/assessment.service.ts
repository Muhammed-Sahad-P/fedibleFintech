import { assessmentRepository } from './assessment.repository';
import { SubmitAnswersInput } from './assessment.dto';
import { ScoringEngine, QuestionWithAnswer } from './scoring-engine';
import { redis } from '../../redis/client';
import { NotFoundError, BadRequestError, ConflictError } from '../../utils/errors';
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

    // 1. Reject re-submission to an already completed assessment
    if (assessment.status === 'COMPLETED') {
      throw new ConflictError('Assessment has already been completed and cannot be re-submitted');
    }

    // 2. Reject duplicate question IDs in the submission payload
    const submittedQuestionIds = input.answers.map(a => a.questionId);
    const uniqueSubmittedIds = new Set(submittedQuestionIds);
    if (uniqueSubmittedIds.size !== submittedQuestionIds.length) {
      throw new BadRequestError('Duplicate answers for the same question are not permitted');
    }

    // 3. Fetch all active canonical questions to ensure 100% complete question coverage
    const activeQuestions = await assessmentRepository.getActiveQuestions();
    const activeQuestionMap = new Map(activeQuestions.map(q => [q.id, q]));

    // Check that every question submitted is a valid, active question
    for (const qId of submittedQuestionIds) {
      if (!activeQuestionMap.has(qId)) {
        throw new BadRequestError(`Question ID '${qId}' is invalid, unknown, or inactive`);
      }
    }

    // Reject partial submissions (must answer all active questions)
    if (submittedQuestionIds.length !== activeQuestions.length) {
      throw new BadRequestError(
        `Assessment requires answering all ${activeQuestions.length} active questions. Received ${submittedQuestionIds.length}.`
      );
    }

    // 4. Validate option keys and construct scoring entities
    const questionsWithAnswers: QuestionWithAnswer[] = [];
    const answersToSave: Array<{ questionId: string; selectedOptionKey: string; scoreValue: number }> = [];

    for (const ans of input.answers) {
      const q = activeQuestionMap.get(ans.questionId)!;

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

    // 5. Compute Feditscore
    const scoringResult = ScoringEngine.calculate(questionsWithAnswers);

    // 6. Save answers and results in database transaction
    const updatedAssessment = await assessmentRepository.saveAnswersAndScore(
      assessmentId,
      answersToSave,
      scoringResult
    );

    // 7. Invalidate Redis cache for this assessment
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
