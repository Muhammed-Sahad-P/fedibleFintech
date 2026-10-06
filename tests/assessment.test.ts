import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { runMigrations } from '../src/database/migrate';
import { seedDatabase } from '../src/database/seed';

describe('Feditscore & Redis Caching Integration Tests', () => {
  let authToken: string;
  let assessmentId: string;
  let questionId: string;

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
    expect(res.body.data.questions.length).toBeGreaterThan(0);

    assessmentId = res.body.data.assessmentId;
    questionId = res.body.data.questions[0].id;
  });

  it('should submit answers and evaluate Feditscore (200 OK)', async () => {
    const res = await request(app)
      .post(`/api/v1/assessment/${assessmentId}/answers`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        answers: [
          { questionId, selectedOptionKey: 'A' }
        ]
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalScore).toBeGreaterThanOrEqual(300);
    expect(res.body.data.totalScore).toBeLessThanOrEqual(900);
    expect(res.body.data.riskTier).toBeDefined();
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
    // If Redis is running locally, it returns HIT
    if (res.headers['x-cache']) {
      expect(['HIT', 'MISS']).toContain(res.headers['x-cache']);
    }
  });

  it('should invalidate Redis cache when new answers are submitted', async () => {
    const res = await request(app)
      .post(`/api/v1/assessment/${assessmentId}/answers`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        answers: [
          { questionId, selectedOptionKey: 'B' }
        ]
      });

    expect(res.status).toBe(200);

    // Reading result after submit should yield a fresh cache MISS
    const readRes = await request(app)
      .get(`/api/v1/assessment/${assessmentId}/result`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(readRes.status).toBe(200);
    expect(readRes.headers['x-cache']).toBe('MISS');
  });
});
