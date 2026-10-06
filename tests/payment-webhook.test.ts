import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { mockPaymentGateway } from '../src/modules/payment/mock-gateway.service';
import { db } from '../src/database/pool';
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

  it('should reject webhook with amount mismatch and leave payment in PENDING state (400 Bad Request)', async () => {
    // 1. Create new payment with 500000 paise (₹5,000)
    const createRes = await request(app)
      .post('/api/v1/payments/create')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        amountMinor: 500000,
        currency: 'INR',
        paymentMethod: 'UPI',
      });
    const mismatchRefId = createRes.body.data.referenceId;

    // 2. Webhook arrives with mismatched amount (100 paise)
    const payload = {
      eventId: `evt_mismatch_${Date.now()}`,
      eventType: 'payment.succeeded' as const,
      referenceId: mismatchRefId,
      gatewayTxId: 'gtx_mismatch_1',
      amountMinor: 100, // Mismatch: 100 vs 500000
      currency: 'INR',
      timestamp: new Date().toISOString(),
    };
    const sig = mockPaymentGateway.generateSignature(payload);

    const res = await request(app)
      .post('/api/v1/webhooks/payment')
      .set('X-Webhook-Signature', sig)
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);

    // 3. (a) Assert the inbox row for that eventId has status REJECTED
    const inboxRes = await db.query(
      'SELECT * FROM webhook_events WHERE event_id = $1',
      [payload.eventId]
    );
    expect(inboxRes.rows.length).toBe(1);
    expect(inboxRes.rows[0].processing_status).toBe('REJECTED');

    // 4. (b) Assert an audit_logs row with action WEBHOOK_MISMATCH_REJECTED exists
    const auditRes = await db.query(
      "SELECT * FROM audit_logs WHERE action = 'WEBHOOK_MISMATCH_REJECTED' AND details->>'eventId' = $1",
      [payload.eventId]
    );
    expect(auditRes.rows.length).toBeGreaterThan(0);

    // 5. (c) Assert the transaction status in DB is still PENDING
    const checkRes = await request(app)
      .get(`/api/v1/payments/${mismatchRefId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(checkRes.status).toBe(200);
    expect(checkRes.body.data.status).toBe('PENDING');
  });

  it('should return real FAILED status (not hardcoded SUCCESS) on duplicate webhook for a failed payment', async () => {
    // 1. Create new payment
    const createRes = await request(app)
      .post('/api/v1/payments/create')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        amountMinor: 200000,
        currency: 'INR',
        paymentMethod: 'CARD',
      });
    const failRefId = createRes.body.data.referenceId;

    const eventId = `evt_failed_tx_${Date.now()}`;
    const payload = {
      eventId,
      eventType: 'payment.failed' as const,
      referenceId: failRefId,
      gatewayTxId: `gtx_failed_${Date.now()}`,
      amountMinor: 200000,
      currency: 'INR',
      timestamp: new Date().toISOString(),
    };
    const sig = mockPaymentGateway.generateSignature(payload);

    // 2. First delivery transitions to FAILED
    const firstRes = await request(app)
      .post('/api/v1/webhooks/payment')
      .set('X-Webhook-Signature', sig)
      .send(payload);

    expect(firstRes.status).toBe(200);
    expect(firstRes.body.data.status).toBe('FAILED');
    expect(firstRes.body.data.duplicate).toBe(false);

    // 3. Duplicate delivery must return FAILED (not SUCCESS)
    const dupRes = await request(app)
      .post('/api/v1/webhooks/payment')
      .set('X-Webhook-Signature', sig)
      .send(payload);

    expect(dupRes.status).toBe(200);
    expect(dupRes.body.data.status).toBe('FAILED');
    expect(dupRes.body.data.duplicate).toBe(true);
  });

  it('should recover and complete payment on retry after a previous crash left inbox event in RECEIVED state', async () => {
    // 1. Create payment
    const createRes = await request(app)
      .post('/api/v1/payments/create')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        amountMinor: 300000,
        currency: 'INR',
        paymentMethod: 'NETBANKING',
      });
    const crashRefId = createRes.body.data.referenceId;

    const eventId = `evt_crash_sim_${Date.now()}`;
    const payload = {
      eventId,
      eventType: 'payment.succeeded' as const,
      referenceId: crashRefId,
      gatewayTxId: `gtx_crash_recovery_${Date.now()}`,
      amountMinor: 300000,
      currency: 'INR',
      timestamp: new Date().toISOString(),
    };
    const sig = mockPaymentGateway.generateSignature(payload);

    // 2. Simulate prior crash leaving inbox record in 'RECEIVED' state
    const { db } = await import('../src/database/pool');
    await db.query(
      `INSERT INTO webhook_events (event_id, event_type, provider, raw_payload, processing_status)
       VALUES ($1, $2, 'MOCK_GATEWAY', $3, 'RECEIVED')`,
      [eventId, payload.eventType, JSON.stringify(payload)]
    );

    // 3. Gateway retries the webhook
    const retryRes = await request(app)
      .post('/api/v1/webhooks/payment')
      .set('X-Webhook-Signature', sig)
      .send(payload);

    // 4. Retry must reprocess the RECEIVED event and transition payment to SUCCESS
    expect(retryRes.status).toBe(200);
    expect(retryRes.body.data.status).toBe('SUCCESS');
    expect(retryRes.body.data.duplicate).toBe(false);

    // 5. Subsequent delivery is now recognized as PROCESSED duplicate
    const secondRetry = await request(app)
      .post('/api/v1/webhooks/payment')
      .set('X-Webhook-Signature', sig)
      .send(payload);

    expect(secondRetry.status).toBe(200);
    expect(secondRetry.body.data.status).toBe('SUCCESS');
    expect(secondRetry.body.data.duplicate).toBe(true);
  });

  it('should reject unauthenticated call to POST /payments/mock-gateway/process (401 Unauthorized)', async () => {
    const res = await request(app)
      .post('/api/v1/payments/mock-gateway/process')
      .send({ referenceId: referenceId, simulateOutcome: 'SUCCESS' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('should reject a non-owner user from settling another user\'s payment (403 Forbidden)', async () => {
    // Register another user (User B)
    const otherUserRes = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: `other.pay.user.${Date.now()}@example.com`, password: 'Password@123', fullName: 'Other User' });
    const userBToken = otherUserRes.body.data.token;

    // User A creates a payment
    const createRes = await request(app)
      .post('/api/v1/payments/create')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        amountMinor: 400000,
        currency: 'INR',
        paymentMethod: 'UPI',
      });
    const userAPaymentRef = createRes.body.data.referenceId;

    // User B attempts to call mock-gateway/process on User A's payment
    const processRes = await request(app)
      .post('/api/v1/payments/mock-gateway/process')
      .set('Authorization', `Bearer ${userBToken}`)
      .send({ referenceId: userAPaymentRef, simulateOutcome: 'SUCCESS' });

    expect(processRes.status).toBe(403);
    expect(processRes.body.success).toBe(false);

    // User A successfully processes their own payment
    const validProcessRes = await request(app)
      .post('/api/v1/payments/mock-gateway/process')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ referenceId: userAPaymentRef, simulateOutcome: 'SUCCESS' });

    expect(validProcessRes.status).toBe(200);
    expect(validProcessRes.body.success).toBe(true);
  });
});
