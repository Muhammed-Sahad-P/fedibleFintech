import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { runMigrations } from '../src/database/migrate';

describe('AI Financial Assistant Integration Tests', () => {
  let authToken: string;

  beforeAll(async () => {
    try {
      await runMigrations();
    } catch {}

    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: `ai.user.${Date.now()}@example.com`, password: 'Password@123', fullName: 'AI Tester' });

    authToken = regRes.body.data.token;
  });

  it('should generate financial analysis and metrics with data minimisation (200 OK)', async () => {
    const res = await request(app)
      .post('/api/v1/financial-assistant')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        income: 120000,
        expenses: 60000,
        savings: 300000,
        debt: 150000,
        currency: 'INR',
        financialGoals: ['EMERGENCY_FUND', 'HOME_PURCHASE'],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.financialHealthScore).toBeGreaterThan(0);
    expect(res.body.data.metrics.savingsRatePercentage).toBe(50);
    expect(res.body.data.metrics.debtToAnnualIncomePercentage).toBe(10.4);
    expect(res.body.data.metrics.emergencyFundMonths).toBe(5);
    expect(res.body.data.riskTier).toBeDefined();
    expect(res.body.data.keyInsights.length).toBeGreaterThan(0);
    expect(res.body.data.actionableRecommendations.length).toBeGreaterThan(0);
    expect(res.body.data.dataPrivacyNotice).toBeDefined();
  });

  it('should reject requests with negative financial numbers (400 Bad Request)', async () => {
    const res = await request(app)
      .post('/api/v1/financial-assistant')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        income: -5000,
        expenses: 2000,
        savings: 1000,
        debt: 0,
        currency: 'INR',
        financialGoals: ['EMERGENCY_FUND'],
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should reject requests with invalid goal enums (400 Bad Request)', async () => {
    const res = await request(app)
      .post('/api/v1/financial-assistant')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        income: 50000,
        expenses: 20000,
        savings: 10000,
        debt: 0,
        currency: 'INR',
        financialGoals: ['INVALID_GOAL_ENUM'],
      });

    expect(res.status).toBe(400);
  });
});
