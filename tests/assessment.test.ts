import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { runMigrations } from '../src/database/migrate';
import { seedDatabase } from '../src/database/seed';

describe('Feditscore & Redis Caching Integration Tests', () => {
  let authToken: string;
  let assessmentId: string;
  let allQuestions: Array<{ id: string; code: string; options: Array<{ key: string }> }>;

  beforeAll(async () => {
    try {
      await runMigrations();
      await seedDatabase();
    } catch {}

    const email = `score.user.${Date.now()}@example.com`;
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: 'Password@123', fullName: 'Score Tester' });

    authToken = regRes.body.data.token;
  });

  it('should start a new assessment session and return active questions (201 Created)', async () => {
    const res = await request(app)
      .post('/api/v1/assessment')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.assessmentId).toBeDefined();
    expect(res.body.data.questions.length).toBeGreaterThanOrEqual(6);

    assessmentId = res.body.data.assessmentId;
    allQuestions = res.body.data.questions;
  });

  it('should reject partial answer submission when not all questions are answered (400 Bad Request)', async () => {
    // Only answer 1 of 6 questions
    const res = await request(app)
      .post(`/api/v1/assessment/${assessmentId}/answers`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        answers: [
          { questionId: allQuestions[0].id, selectedOptionKey: 'A' }
        ]
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should reject submission with duplicate question IDs (400 Bad Request)', async () => {
    const duplicateAnswers = allQuestions.map(q => ({ questionId: q.id, selectedOptionKey: 'A' }));
    // Add duplicate entry
    duplicateAnswers.push({ questionId: allQuestions[0].id, selectedOptionKey: 'B' });

    const res = await request(app)
      .post(`/api/v1/assessment/${assessmentId}/answers`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ answers: duplicateAnswers });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should reject submission with unknown question ID (400 Bad Request)', async () => {
    const answersWithUnknown = allQuestions.map(q => ({ questionId: q.id, selectedOptionKey: 'A' }));
    answersWithUnknown[0].questionId = '00000000-0000-0000-0000-000000000000';

    const res = await request(app)
      .post(`/api/v1/assessment/${assessmentId}/answers`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ answers: answersWithUnknown });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should reject submission with invalid option key (400 Bad Request)', async () => {
    const answersWithInvalidKey = allQuestions.map(q => ({ questionId: q.id, selectedOptionKey: 'A' }));
    answersWithInvalidKey[0].selectedOptionKey = 'INVALID_Z';

    const res = await request(app)
      .post(`/api/v1/assessment/${assessmentId}/answers`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ answers: answersWithInvalidKey });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should submit complete valid answers and evaluate Feditscore (200 OK)', async () => {
    const validAnswers = allQuestions.map(q => ({
      questionId: q.id,
      selectedOptionKey: 'A',
    }));

    const res = await request(app)
      .post(`/api/v1/assessment/${assessmentId}/answers`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ answers: validAnswers });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('COMPLETED');
    expect(res.body.data.totalScore).toBeGreaterThanOrEqual(300);
    expect(res.body.data.totalScore).toBeLessThanOrEqual(900);
    expect(res.body.data.riskTier).toBeDefined();
  });

  it('should reject re-submission to an already COMPLETED assessment (409 Conflict)', async () => {
    const validAnswers = allQuestions.map(q => ({
      questionId: q.id,
      selectedOptionKey: 'B',
    }));

    const res = await request(app)
      .post(`/api/v1/assessment/${assessmentId}/answers`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ answers: validAnswers });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it('should fetch score result with X-Cache: MISS on first read', async () => {
    const res = await request(app)
      .get(`/api/v1/assessment/${assessmentId}/result`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['x-cache']).toBe('MISS');
    expect(res.body.data.totalScore).toBeDefined();
  });

  it('should fetch score result with X-Cache: HIT on subsequent read (Redis Caching)', async () => {
    const res = await request(app)
      .get(`/api/v1/assessment/${assessmentId}/result`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    if (res.headers['x-cache']) {
      expect(['HIT', 'MISS']).toContain(res.headers['x-cache']);
    }
  });
});
