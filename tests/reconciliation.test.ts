import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { runMigrations } from '../src/database/migrate';

describe('Task 8 Crash Recovery & Payment Reconciliation Tests', () => {
  let userToken: string;
  let adminToken: string;
  let crashReferenceId: string;

  beforeAll(async () => {
    try {
      await runMigrations();
    } catch {}

    // Register User
    const userRes = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: `crash.user.${Date.now()}@example.com`, password: 'Password@123', fullName: 'Crash User', role: 'USER' });
    userToken = userRes.body.data.token;

    // Register Admin
    const adminRes = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: `crash.admin.${Date.now()}@example.com`, password: 'Password@123', fullName: 'Crash Admin', role: 'ADMIN' });
    adminToken = adminRes.body.data.token;
  });

  it('should simulate a DB crash scenario (charge settled at gateway, PENDING in DB)', async () => {
    const res = await request(app)
      .post('/api/v1/payments/simulate-crash')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.transaction.status).toBe('PENDING');
    expect(res.body.data.gatewayCharge.status).toBe('SUCCESS');

    crashReferenceId = res.body.data.transaction.referenceId;
  });

  it('should reject non-admin users from triggering reconciliation (403 Forbidden)', async () => {
    const res = await request(app)
      .post('/api/v1/payments/reconcile')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ windowMinutes: 60 });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('should allow Admin to run reconciliation and auto-heal the orphaned transaction', async () => {
    const res = await request(app)
      .post('/api/v1/payments/reconcile')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ windowMinutes: 60 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.recoveredCount).toBeGreaterThanOrEqual(1);

    // Verify transaction in DB is now SUCCESS
    const checkRes = await request(app)
      .get(`/api/v1/payments/${crashReferenceId}`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(checkRes.status).toBe(200);
    expect(checkRes.body.data.status).toBe('SUCCESS');
  });
});
