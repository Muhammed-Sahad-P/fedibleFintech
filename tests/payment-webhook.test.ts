import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { mockPaymentGateway } from '../src/modules/payment/mock-gateway.service';
import { runMigrations } from '../src/database/migrate';

describe('Payment & Webhook Idempotency Integration Tests', () => {
  let authToken: string;
  let referenceId: string;
  const amountMinor = 1000000; // ₹10,000.00

  beforeAll(async () => {
    try {
      await runMigrations();
    } catch {}

    const email = `pay.user.${Date.now()}@example.com`;
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: 'Password@123', fullName: 'Payment Tester' });

    authToken = regRes.body.data.token;
  });

  it('should create a payment order with status PENDING (201 Created)', async () => {
    const res = await request(app)
      .post('/api/v1/payments/create')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        amountMinor,
        currency: 'INR',
        paymentMethod: 'UPI',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.referenceId).toBeDefined();
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.amountMinor).toBe(amountMinor);

    referenceId = res.body.data.referenceId;
  });

  it('should reject webhook with invalid or missing HMAC signature (401 Unauthorized)', async () => {
    const fakePayload = {
      eventId: `evt_fake_${Date.now()}`,
      eventType: 'payment.succeeded',
      referenceId,
      gatewayTxId: 'gtx_fake_123',
      amountMinor,
      currency: 'INR',
      timestamp: new Date().toISOString(),
    };

    const res = await request(app)
      .post('/api/v1/webhooks/payment')
      .set('X-Webhook-Signature', 'invalid_signature_hash')
      .send(fakePayload);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('CONCURRENCY TEST: should process exactly 1 transaction when 5 identical webhooks arrive concurrently', async () => {
    // Generate valid signed webhook payload
    const { webhookPayload, signature } = mockPaymentGateway.simulatePayment(
      referenceId,
      amountMinor,
      'INR',
      'SUCCESS'
    );

    // Fire 5 identical requests concurrently
    const requests = Array.from({ length: 5 }, () =>
      request(app)
        .post('/api/v1/webhooks/payment')
        .set('X-Webhook-Signature', signature)
        .send(webhookPayload)
    );

    const responses = await Promise.all(requests);

    // All responses should succeed (200 OK)
    for (const res of responses) {
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    }

    // Exactly one must be the primary processed event, and the other 4 must be recognized duplicates
    const duplicateFlags = responses.map(r => r.body.data.duplicate);
    const primaryProcessed = duplicateFlags.filter(d => d === false);
    const duplicates = duplicateFlags.filter(d => d === true);

    expect(primaryProcessed.length).toBe(1);
    expect(duplicates.length).toBe(4);

    // Verify transaction status in database is now SUCCESS
    const checkRes = await request(app)
      .get(`/api/v1/payments/${referenceId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(checkRes.status).toBe(200);
    expect(checkRes.body.data.status).toBe('SUCCESS');
  });

  it('should reject state change if payment is already in terminal SUCCESS state', async () => {
    // Attempting another webhook with a different event ID for the same referenceId
    const payload = {
      eventId: `evt_late_${Date.now()}`,
      eventType: 'payment.failed' as const,
      referenceId,
      gatewayTxId: 'gtx_late_999',
      amountMinor,
      currency: 'INR',
      timestamp: new Date().toISOString(),
    };

    const sig = mockPaymentGateway.generateSignature(payload);

    const res = await request(app)
      .post('/api/v1/webhooks/payment')
      .set('X-Webhook-Signature', sig)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('SUCCESS'); // Remains SUCCESS, cannot regress to FAILED
    expect(res.body.data.duplicate).toBe(true);
  });
});
