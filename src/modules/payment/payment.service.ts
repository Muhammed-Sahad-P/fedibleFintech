import { v4 as uuidv4 } from 'uuid';
import { db } from '../../database/pool';
import { paymentRepository } from './payment.repository';
import { mockPaymentGateway } from './mock-gateway.service';
import { CreatePaymentInput, PaymentWebhookPayload, ProcessMockPaymentInput } from './payment.dto';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../utils/errors';
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
   * 2. Ingests and processes payment webhooks with Inbox pattern & Postgres row locks
   */
  async handlePaymentWebhook(payload: PaymentWebhookPayload, signatureHeader: string | undefined, ipAddress?: string) {
    // A. Verify HMAC Signature
    const isValidSignature = mockPaymentGateway.verifySignature(payload, signatureHeader);
    if (!isValidSignature) {
      logger.warn('Unauthorized webhook signature rejected', { eventId: payload.eventId });
      throw new UnauthorizedError('Invalid cryptographic webhook signature');
    }

    // B. Inbox Pattern: Record raw webhook event atomically in Postgres
    const { isNew } = await paymentRepository.recordWebhookEventInbox(
      payload.eventId,
      payload.eventType,
      payload,
      'MOCK_GATEWAY'
    );

    if (!isNew) {
      logger.info('Duplicate webhook event detected in inbox', { eventId: payload.eventId });
      return {
        success: true,
        message: 'Duplicate webhook detected; transaction already recorded',
        data: {
          referenceId: payload.referenceId,
          status: 'SUCCESS',
          duplicate: true,
        }
      };
    }

    // C. Postgres Transaction with Row-Level Pessimistic Lock
    const result = await db.transaction(async (client) => {
      // Lock row to prevent concurrent race condition mutations
      const tx = await paymentRepository.findByReferenceIdForUpdate(client, payload.referenceId);
      if (!tx) {
        throw new NotFoundError(`Transaction reference ${payload.referenceId} not found`);
      }

      // Check if already in terminal state
      if (tx.status === 'SUCCESS' || tx.status === 'FAILED') {
        logger.info('Transaction already processed in terminal state', {
          referenceId: tx.reference_id,
          status: tx.status,
        });
        return {
          referenceId: tx.reference_id,
          status: tx.status,
          duplicate: true,
        };
      }

      // Transition state: PENDING -> SUCCESS or FAILED
      const newStatus = payload.eventType === 'payment.succeeded' ? 'SUCCESS' : 'FAILED';
      const updatedTx = await paymentRepository.updateTransactionStatus(
        client,
        payload.referenceId,
        newStatus,
        payload.gatewayTxId
      );

      // Record audit log entry
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

      return {
        referenceId: updatedTx.reference_id,
        status: updatedTx.status,
        amountMinor: Number(updatedTx.amount_minor),
        gatewayTxId: updatedTx.gateway_tx_id,
        duplicate: false,
      };
    });

    // Mark webhook event as successfully processed
    await paymentRepository.markWebhookProcessed(payload.eventId, 'PROCESSED');

    return {
      success: true,
      message: 'Payment webhook processed and transaction recorded successfully',
      data: result,
    };
  }

  /**
   * 3. Simulates customer checkout payment at mock gateway
   */
  async processMockPayment(input: ProcessMockPaymentInput, ipAddress?: string) {
    const tx = await paymentRepository.findByReferenceId(input.referenceId);
    if (!tx) {
      throw new NotFoundError(`Transaction ${input.referenceId} not found`);
    }

    if (tx.status !== 'PENDING') {
      return {
        referenceId: tx.reference_id,
        status: tx.status,
        message: `Transaction is already finalized with status: ${tx.status}`,
      };
    }

    // Simulate gateway checkout & signed webhook emission
    const { webhookPayload, signature } = mockPaymentGateway.simulatePayment(
      tx.reference_id,
      Number(tx.amount_minor),
      tx.currency,
      input.simulateOutcome
    );

    // Process webhook through standard pipeline
    const webhookResult = await this.handlePaymentWebhook(webhookPayload, signature, ipAddress);

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
