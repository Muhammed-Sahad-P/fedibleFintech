import { db } from '../../database/pool';
import { paymentRepository } from './payment.repository';
import { mockPaymentGateway } from './mock-gateway.service';
import { ForbiddenError } from '../../utils/errors';
import { config } from '../../config';
import { logger } from '../../utils/logger';

export interface ReconciliationResult {
  scannedWindowMinutes: number;
  gatewayChargesFound: number;
  matchedCount: number;
  recoveredCount: number;
  recoveredTransactions: Array<{
    referenceId: string;
    amountMinor: number;
    action: string;
    gatewayTxId: string;
  }>;
}

export class ReconciliationService {
  /**
   * Reconciles gateway settled charges against the internal database
   */
  async reconcileOrphanedPayments(windowMinutes: number = 60, actorId?: string): Promise<ReconciliationResult> {
    logger.info(`Starting payment reconciliation for the last ${windowMinutes} minutes...`);

    const gatewayCharges = await mockPaymentGateway.listSettledCharges(windowMinutes);
    const recoveredTransactions: Array<{
      referenceId: string;
      amountMinor: number;
      action: string;
      gatewayTxId: string;
    }> = [];

    let matchedCount = 0;

    for (const charge of gatewayCharges) {
      if (charge.status !== 'SUCCESS') continue;

      // Check transaction in Fedible database
      const tx = await paymentRepository.findByReferenceId(charge.referenceId);

      if (!tx) {
        logger.warn(`Gateway charge ${charge.referenceId} has no corresponding local transaction`);
        continue;
      }

      if (tx.status === 'SUCCESS') {
        matchedCount++;
        continue;
      }

      // If transaction is still PENDING or crashed before completion, auto-reconcile in ACID transaction
      if (tx.status === 'PENDING') {
        logger.info(`Reconciling orphaned pending transaction: ${tx.reference_id}`);

        await db.transaction(async (client) => {
          // Lock row
          const lockedTx = await paymentRepository.findByReferenceIdForUpdate(client, tx.reference_id);
          if (lockedTx && lockedTx.status === 'PENDING') {
            await paymentRepository.updateTransactionStatus(
              client,
              tx.reference_id,
              'SUCCESS',
              charge.gatewayTxId
            );

            // Add audit log
            await client.query(
              `INSERT INTO audit_logs (actor_id, entity_type, entity_id, action, details)
               VALUES ($1, 'PAYMENT', $2, 'RECONCILED_FROM_GATEWAY', $3)`,
              [
                actorId || null,
                tx.id,
                JSON.stringify({
                  reason: 'AUTO_RECONCILED_POST_CRASH',
                  amountMinor: charge.amountMinor,
                  gatewayTxId: charge.gatewayTxId,
                }),
              ]
            );

            recoveredTransactions.push({
              referenceId: tx.reference_id,
              amountMinor: charge.amountMinor,
              action: 'RECONCILED_TO_SUCCESS',
              gatewayTxId: charge.gatewayTxId,
            });
          }
        });
      }
    }

    logger.info(`Reconciliation completed. Matched: ${matchedCount}, Recovered: ${recoveredTransactions.length}`);

    return {
      scannedWindowMinutes: windowMinutes,
      gatewayChargesFound: gatewayCharges.length,
      matchedCount,
      recoveredCount: recoveredTransactions.length,
      recoveredTransactions,
    };
  }

  /**
   * Helper to simulate Task 8 DB Crash Scenario:
   * 1. Creates a ₹10,000 (1,000,000 paise) transaction in PENDING state
   * 2. Settles at Gateway
   * 3. Drops the webhook to simulate DB outage
   */
  async simulateCrashScenario(userId: string) {
    if (config.isProduction) {
      throw new ForbiddenError('Crash simulation helper is disabled in production environment');
    }

    const referenceId = `REF_CRASH_SIM_${Date.now()}`;
    const amountMinor = 1000000; // ₹10,000.00

    // 1. Transaction created in Fedible DB as PENDING
    const tx = await paymentRepository.createTransaction({
      referenceId,
      userId,
      amountMinor,
      currency: 'INR',
      paymentMethod: 'UPI',
      metadata: { scenario: 'TASK_8_CRASH_SIMULATION' },
    });

    // 2. User completes payment at Gateway, Gateway records charge
    const gatewayCharge = mockPaymentGateway.simulateOrphanedGatewayCharge(referenceId, amountMinor, 'INR');

    // 3. Webhook was lost due to DB crash, so DB still has status = 'PENDING'
    return {
      message: 'Simulated DB crash scenario initialized. Payment succeeded at gateway, but Fedible DB still holds PENDING status.',
      transaction: {
        referenceId: tx.reference_id,
        status: tx.status,
        amountMinor: Number(tx.amount_minor),
      },
      gatewayCharge: {
        gatewayTxId: gatewayCharge.gatewayTxId,
        status: gatewayCharge.status,
        settledAt: gatewayCharge.settledAt,
      },
      nextStep: 'Execute POST /api/v1/payments/reconcile to trigger the reconciliation safety net and recover the transaction.',
    };
  }
}

export const reconciliationService = new ReconciliationService();
