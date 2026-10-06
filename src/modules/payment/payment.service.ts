import { v4 as uuidv4 } from 'uuid';
import { db } from '../../database/pool';
import { paymentRepository } from './payment.repository';
import { mockPaymentGateway } from './mock-gateway.service';
import { CreatePaymentInput, PaymentWebhookPayload, ProcessMockPaymentInput } from './payment.dto';
import { BadRequestError, NotFoundError, UnauthorizedError, ForbiddenError } from '../../utils/errors';
import { config } from '../../config';
import { logger } from '../../utils/logger';

export class PaymentService {
  /**
   * 1. Creates a pending payment order
   */
  async createPayment(userId: string, input: CreatePaymentInput) {
    const referenceId = `REF_${Date.now()}_${uuidv4().replace(/-/g, '').slice(0, 8).toUpperCase()}`;

    const transaction = await paymentRepository.createTransaction({
      referenceId,
      userId,
      amountMinor: input.amountMinor,
      currency: input.currency || 'INR',
      paymentMethod: input.paymentMethod || 'UPI',
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
    });

    return {
      transactionId: transaction.id,
      referenceId: transaction.reference_id,
      amountMinor: Number(transaction.amount_minor),
      currency: transaction.currency,
      status: transaction.status,
      paymentMethod: transaction.payment_method,
      createdAt: transaction.created_at,
    };
  }

  /**
   * 2. Ingests and processes payment webhooks with atomic Inbox pattern & Postgres row locks
   */
  async handlePaymentWebhook(
    payload: PaymentWebhookPayload,
    signatureHeader: string | undefined,
    rawBody?: string | Buffer,
    ipAddress?: string
  ) {
    // A. Verify HMAC Signature against raw request bytes
    const bodyToVerify = rawBody || payload;
    const isValidSignature = mockPaymentGateway.verifySignature(bodyToVerify, signatureHeader);
    if (!isValidSignature) {
      logger.warn('Unauthorized webhook signature rejected', { eventId: payload.eventId });
      throw new UnauthorizedError('Invalid cryptographic webhook signature');
    }

    // B. Replay Attack Prevention: Validate timestamp within 300-second tolerance window
    if (payload.timestamp) {
      const eventTime = new Date(payload.timestamp).getTime();
      const now = Date.now();
      const ageSeconds = (now - eventTime) / 1000;
      if (isNaN(ageSeconds) || ageSeconds > 300 || ageSeconds < -60) {
        logger.warn('Webhook rejected due to timestamp out of tolerance window', {
          timestamp: payload.timestamp,
          ageSeconds,
          eventId: payload.eventId,
        });
        throw new BadRequestError('Webhook timestamp is expired or outside acceptable replay window (300s)');
      }
    }

    // C. Atomic PostgreSQL Transaction: Inbox insertion + Row lock + Amount validation + Status update
    const result = await db.transaction(async (client) => {
      // 1. Record in Inbox (with row-level lock on conflict)
      const { isNew, event: inboxEvent } = await paymentRepository.recordWebhookEventInbox(
        client,
        payload.eventId,
        payload.eventType,
        payload,
        'MOCK_GATEWAY'
      );

      // 2. If already processed, duplicate, or rejected, return current real status from database
      if (!isNew && inboxEvent && inboxEvent.processing_status !== 'RECEIVED') {
        logger.info('Duplicate webhook event detected in inbox', {
          eventId: payload.eventId,
          status: inboxEvent.processing_status
        });
        const existingTx = await paymentRepository.findByReferenceId(payload.referenceId);
        return {
          referenceId: existingTx ? existingTx.reference_id : payload.referenceId,
          status: existingTx ? existingTx.status : 'SUCCESS',
          amountMinor: existingTx ? Number(existingTx.amount_minor) : payload.amountMinor,
          gatewayTxId: existingTx ? existingTx.gateway_tx_id : payload.gatewayTxId,
          duplicate: true,
        };
      }

      // 3. Lock transaction row to prevent concurrent mutations
      const tx = await paymentRepository.findByReferenceIdForUpdate(client, payload.referenceId);
      if (!tx) {
        await paymentRepository.markWebhookProcessed(client, payload.eventId, 'REJECTED');
        return { notFound: true };
      }

      // 4. Validate Amount and Currency Integrity
      if (Number(tx.amount_minor) !== payload.amountMinor || tx.currency !== payload.currency) {
        logger.warn('Webhook amount/currency mismatch rejected', {
          expectedAmount: tx.amount_minor,
          receivedAmount: payload.amountMinor,
          expectedCurrency: tx.currency,
          receivedCurrency: payload.currency,
          eventId: payload.eventId,
        });

        // Mark webhook as REJECTED so it isn't indefinitely retried
        await paymentRepository.markWebhookProcessed(client, payload.eventId, 'REJECTED');

        // Write security audit log entry
        await client.query(
          `INSERT INTO audit_logs (actor_id, entity_type, entity_id, action, details, ip_address)
           VALUES ($1, 'PAYMENT', $2, 'WEBHOOK_MISMATCH_REJECTED', $3, $4)`,
          [
            tx.user_id,
            tx.id,
            JSON.stringify({
              expected: { amountMinor: Number(tx.amount_minor), currency: tx.currency },
              received: { amountMinor: payload.amountMinor, currency: payload.currency },
              eventId: payload.eventId,
            }),
            ipAddress || null,
          ]
        );

        return { mismatch: true };
      }

      // 5. Check if transaction is already in terminal state
      if (tx.status === 'SUCCESS' || tx.status === 'FAILED') {
        logger.info('Transaction already processed in terminal state', {
          referenceId: tx.reference_id,
          status: tx.status,
        });
        await paymentRepository.markWebhookProcessed(client, payload.eventId, 'PROCESSED');
        return {
          referenceId: tx.reference_id,
          status: tx.status,
          amountMinor: Number(tx.amount_minor),
          gatewayTxId: tx.gateway_tx_id,
          duplicate: true,
        };
      }

      // 6. Transition state: PENDING -> SUCCESS or FAILED
      const newStatus = payload.eventType === 'payment.succeeded' ? 'SUCCESS' : 'FAILED';
      const updatedTx = await paymentRepository.updateTransactionStatus(
        client,
        payload.referenceId,
        newStatus,
        payload.gatewayTxId
      );

      // 7. Record audit log entry
      await client.query(
        `INSERT INTO audit_logs (actor_id, entity_type, entity_id, action, details, ip_address)
         VALUES ($1, 'PAYMENT', $2, 'STATUS_UPDATE', $3, $4)`,
        [
          tx.user_id,
          tx.id,
          JSON.stringify({ previousStatus: tx.status, newStatus, eventId: payload.eventId }),
          ipAddress || null,
        ]
      );

      // 8. Mark webhook event as successfully PROCESSED
      await paymentRepository.markWebhookProcessed(client, payload.eventId, 'PROCESSED');

      return {
        referenceId: updatedTx.reference_id,
        status: updatedTx.status,
        amountMinor: Number(updatedTx.amount_minor),
        gatewayTxId: updatedTx.gateway_tx_id,
        duplicate: false,
      };
    });

    if ('notFound' in result && (result as any).notFound) {
      throw new NotFoundError(`Transaction reference ${payload.referenceId} not found`);
    }

    if ('mismatch' in result && (result as any).mismatch) {
      throw new BadRequestError('Webhook payload amount or currency does not match transaction record');
    }

    return {
      success: true,
      message: (result as any).duplicate
        ? 'Duplicate webhook detected; transaction already recorded'
        : 'Payment webhook processed and transaction recorded successfully',
      data: result as {
        referenceId: string;
        status: string;
        amountMinor: number;
        gatewayTxId?: string;
        duplicate?: boolean;
      },
    };
  }

  /**
   * 3. Simulates customer checkout payment at mock gateway (Non-production only, requires ownership or ADMIN)
   */
  async processMockPayment(userId: string, userRole: string, input: ProcessMockPaymentInput, ipAddress?: string) {
    if (config.isProduction) {
      throw new ForbiddenError('Mock gateway process endpoint is disabled in production environment');
    }

    const tx = await paymentRepository.findByReferenceId(input.referenceId);
    if (!tx) {
      throw new NotFoundError(`Transaction ${input.referenceId} not found`);
    }

    // Require ownership or ADMIN role
    if (tx.user_id !== userId && userRole !== 'ADMIN') {
      throw new ForbiddenError('You do not have permission to process this payment transaction');
    }

    if (tx.status !== 'PENDING') {
      return {
        referenceId: tx.reference_id,
        status: tx.status,
        message: `Transaction is already finalized with status: ${tx.status}`,
      };
    }

    // Simulate gateway checkout & signed webhook emission
    const { webhookPayload, rawPayloadString, signature } = mockPaymentGateway.simulatePayment(
      tx.reference_id,
      Number(tx.amount_minor),
      tx.currency,
      input.simulateOutcome
    );

    // Process webhook through standard pipeline
    const webhookResult = await this.handlePaymentWebhook(webhookPayload, signature, rawPayloadString, ipAddress);

    return {
      referenceId: tx.reference_id,
      outcome: input.simulateOutcome,
      webhookResult: webhookResult.data,
    };
  }

  /**
   * 4. Retrieve payment status (verifying tenant ownership)
   */
  async getPaymentStatus(referenceId: string, userId: string) {
    const tx = await paymentRepository.findByReferenceId(referenceId);
    if (!tx || tx.user_id !== userId) {
      throw new NotFoundError('Transaction not found');
    }

    return {
      transactionId: tx.id,
      referenceId: tx.reference_id,
      amountMinor: Number(tx.amount_minor),
      currency: tx.currency,
      status: tx.status,
      paymentMethod: tx.payment_method,
      gatewayTxId: tx.gateway_tx_id,
      createdAt: tx.created_at,
      updatedAt: tx.updated_at,
    };
  }
}

export const paymentService = new PaymentService();
