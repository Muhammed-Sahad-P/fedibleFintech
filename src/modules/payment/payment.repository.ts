import { PoolClient } from 'pg';
import { db } from '../../database/pool';

export interface TransactionEntity {
  id: string;
  reference_id: string;
  user_id: string;
  amount_minor: string | number;
  currency: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  payment_method: string;
  gateway_tx_id: string | null;
  idempotency_key: string | null;
  metadata: any;
  created_at: Date;
  updated_at: Date;
}

export interface WebhookEventEntity {
  id: string;
  event_id: string;
  event_type: string;
  provider: string;
  raw_payload: any;
  processing_status: 'RECEIVED' | 'PROCESSED' | 'FAILED' | 'DUPLICATE';
  retry_count: number;
  processed_at: Date | null;
  created_at: Date;
}

export class PaymentRepository {
  async createTransaction(data: {
    referenceId: string;
    userId: string;
    amountMinor: number;
    currency: string;
    paymentMethod: string;
    idempotencyKey?: string;
    metadata?: Record<string, any>;
  }): Promise<TransactionEntity> {
    if (data.idempotencyKey) {
      // If idempotency key provided, handle idempotency
      const existing = await db.query<TransactionEntity>(
        'SELECT * FROM transactions WHERE idempotency_key = $1',
        [data.idempotencyKey]
      );
      if (existing.rows.length > 0) {
        return existing.rows[0];
      }
    }

    const result = await db.query<TransactionEntity>(
      `INSERT INTO transactions (reference_id, user_id, amount_minor, currency, payment_method, idempotency_key, metadata, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING')
       RETURNING *`,
      [
        data.referenceId,
        data.userId,
        data.amountMinor,
        data.currency,
        data.paymentMethod,
        data.idempotencyKey || null,
        JSON.stringify(data.metadata || {}),
      ]
    );
    return result.rows[0];
  }

  async findByReferenceId(identifier: string): Promise<TransactionEntity | null> {
    const result = await db.query<TransactionEntity>(
      'SELECT * FROM transactions WHERE reference_id = $1 OR id::text = $1',
      [identifier]
    );
    return result.rows[0] || null;
  }

  async findByReferenceIdForUpdate(client: PoolClient, referenceId: string): Promise<TransactionEntity | null> {
    const result = await client.query<TransactionEntity>(
      'SELECT * FROM transactions WHERE reference_id = $1 FOR UPDATE',
      [referenceId]
    );
    return result.rows[0] || null;
  }

  /**
   * Inbox pattern: Inserts raw webhook event atomically.
   * Returns true if event was newly inserted, false if it already existed (duplicate).
   */
  async recordWebhookEventInbox(
    eventId: string,
    eventType: string,
    rawPayload: any,
    provider: string = 'MOCK_GATEWAY'
  ): Promise<{ isNew: boolean; event: WebhookEventEntity | null }> {
    const result = await db.query<WebhookEventEntity>(
      `INSERT INTO webhook_events (event_id, event_type, provider, raw_payload, processing_status)
       VALUES ($1, $2, $3, $4, 'RECEIVED')
       ON CONFLICT (event_id) DO NOTHING
       RETURNING *`,
      [eventId, eventType, provider, JSON.stringify(rawPayload)]
    );

    if (result.rows.length > 0) {
      return { isNew: true, event: result.rows[0] };
    }

    // Fetch existing event for audit
    const existing = await db.query<WebhookEventEntity>(
      'SELECT * FROM webhook_events WHERE event_id = $1',
      [eventId]
    );
    return { isNew: false, event: existing.rows[0] || null };
  }

  async markWebhookProcessed(eventId: string, status: 'PROCESSED' | 'FAILED' | 'DUPLICATE') {
    await db.query(
      `UPDATE webhook_events 
       SET processing_status = $1, processed_at = NOW() 
       WHERE event_id = $2`,
      [status, eventId]
    );
  }

  async updateTransactionStatus(
    client: PoolClient,
    referenceId: string,
    status: 'SUCCESS' | 'FAILED',
    gatewayTxId: string
  ): Promise<TransactionEntity> {
    const result = await client.query<TransactionEntity>(
      `UPDATE transactions
       SET status = $1, gateway_tx_id = $2, updated_at = NOW()
       WHERE reference_id = $3
       RETURNING *`,
      [status, gatewayTxId, referenceId]
    );
    return result.rows[0];
  }

  async createAuditLog(
    actorId: string | null,
    entityType: string,
    entityId: string,
    action: string,
    details: Record<string, any>,
    ipAddress?: string
  ) {
    await db.query(
      `INSERT INTO audit_logs (actor_id, entity_type, entity_id, action, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [actorId, entityType, entityId, action, JSON.stringify(details), ipAddress || null]
    );
  }

  async listPendingTransactions(sinceMinutes: number = 60): Promise<TransactionEntity[]> {
    const result = await db.query<TransactionEntity>(
      `SELECT * FROM transactions 
       WHERE status = 'PENDING' AND created_at >= NOW() - ($1 || ' minutes')::interval`,
      [sinceMinutes]
    );
    return result.rows;
  }
}

export const paymentRepository = new PaymentRepository();
