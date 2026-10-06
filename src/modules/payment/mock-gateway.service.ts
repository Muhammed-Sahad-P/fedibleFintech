import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../config';
import { PaymentWebhookPayload } from './payment.dto';
import { logger } from '../../utils/logger';

export interface GatewaySettledCharge {
  gatewayTxId: string;
  referenceId: string;
  amountMinor: number;
  currency: string;
  status: 'SUCCESS' | 'FAILED';
  settledAt: Date;
}

export class MockPaymentGatewayService {
  // In-memory gateway settlement ledger for mock external provider
  private settledCharges: Map<string, GatewaySettledCharge> = new Map();

  /**
   * Generates a cryptographic HMAC-SHA256 signature for a raw payload string or buffer
   */
  public generateSignature(payload: string | Buffer | Record<string, any>): string {
    const rawBytes = Buffer.isBuffer(payload)
      ? payload
      : typeof payload === 'string'
      ? Buffer.from(payload, 'utf8')
      : Buffer.from(JSON.stringify(payload), 'utf8');

    return crypto
      .createHmac('sha256', config.webhook.secret)
      .update(rawBytes)
      .digest('hex');
  }

  /**
   * Verifies an incoming webhook signature using timing-safe comparison against exact raw body bytes
   */
  public verifySignature(rawBody: string | Buffer | Record<string, any>, signatureHeader: string | undefined): boolean {
    if (!signatureHeader || !rawBody) return false;

    try {
      const expectedSignature = this.generateSignature(rawBody);

      const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
      const receivedBuffer = Buffer.from(signatureHeader, 'utf8');

      if (expectedBuffer.length !== receivedBuffer.length) {
        return false;
      }

      return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
    } catch (err: any) {
      logger.warn('Error during signature verification', { error: err.message });
      return false;
    }
  }

  /**
   * Simulates customer paying on the gateway checkout and records gateway settlement
   */
  public simulatePayment(referenceId: string, amountMinor: number, currency: string, outcome: 'SUCCESS' | 'FAILED' = 'SUCCESS'): {
    webhookPayload: PaymentWebhookPayload;
    rawPayloadString: string;
    signature: string;
    gatewayTxId: string;
  } {
    const gatewayTxId = `gtx_mock_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const eventId = `evt_${uuidv4().replace(/-/g, '').slice(0, 16)}`;

    const charge: GatewaySettledCharge = {
      gatewayTxId,
      referenceId,
      amountMinor,
      currency,
      status: outcome,
      settledAt: new Date(),
    };

    // Record in gateway ledger
    this.settledCharges.set(referenceId, charge);

    const webhookPayload: PaymentWebhookPayload = {
      eventId,
      eventType: outcome === 'SUCCESS' ? 'payment.succeeded' : 'payment.failed',
      referenceId,
      gatewayTxId,
      amountMinor,
      currency,
      timestamp: new Date().toISOString(),
    };

    // Sign the exact serialized bytes that the gateway emits
    const rawPayloadString = JSON.stringify(webhookPayload);
    const signature = this.generateSignature(rawPayloadString);

    return {
      webhookPayload,
      rawPayloadString,
      signature,
      gatewayTxId,
    };
  }

  /**
   * Simulates the Task 8 DB Crash Scenario:
   * Payment settles at gateway (e.g. ₹10,000 / 1,000,000 paise), but webhook is lost or DB was down.
   */
  public simulateOrphanedGatewayCharge(referenceId: string, amountMinor: number = 1000000, currency: string = 'INR'): GatewaySettledCharge {
    const gatewayTxId = `gtx_crash_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const charge: GatewaySettledCharge = {
      gatewayTxId,
      referenceId,
      amountMinor,
      currency,
      status: 'SUCCESS',
      settledAt: new Date(),
    };
    this.settledCharges.set(referenceId, charge);
    return charge;
  }

  /**
   * Mock Gateway Settlement Query API for the Reconciler Worker
   */
  public async listSettledCharges(sinceMinutes: number = 60): Promise<GatewaySettledCharge[]> {
    const cutoff = new Date(Date.now() - sinceMinutes * 60 * 1000);
    const results: GatewaySettledCharge[] = [];

    for (const charge of this.settledCharges.values()) {
      if (charge.settledAt >= cutoff) {
        results.push({ ...charge });
      }
    }

    return results;
  }
}

export const mockPaymentGateway = new MockPaymentGatewayService();
