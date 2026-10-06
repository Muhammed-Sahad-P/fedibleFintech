import { Request, Response, NextFunction } from 'express';
import { paymentService } from './payment.service';
import { reconciliationService } from './reconciliation.service';
import {
  CreatePaymentDto,
  PaymentWebhookPayloadDto,
  ProcessMockPaymentDto,
  ReconcilePaymentsDto,
} from './payment.dto';
import { sendSuccess } from '../../utils/response';

export class PaymentController {
  /**
   * POST /api/v1/payments/create
   */
  async createPayment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
      const validated = CreatePaymentDto.parse({
        ...req.body,
        idempotencyKey: idempotencyKey || req.body.idempotencyKey,
      });

      const result = await paymentService.createPayment(userId, validated);
      sendSuccess(res, result, 'Payment initiated successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/payments/mock-gateway/process
   */
  async processMockPayment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const validated = ProcessMockPaymentDto.parse(req.body);
      const result = await paymentService.processMockPayment(validated, req.ip);
      sendSuccess(res, result, 'Mock gateway payment processed', 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/webhooks/payment
   */
  async handleWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const signatureHeader = req.headers['x-webhook-signature'] as string | undefined;
      const validated = PaymentWebhookPayloadDto.parse(req.body);
      const result = await paymentService.handlePaymentWebhook(validated, signatureHeader, req.ip);
      sendSuccess(res, result.data, result.message, 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/payments/:referenceId
   */
  async getPaymentStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const referenceId = req.params.referenceId;
      const result = await paymentService.getPaymentStatus(referenceId, userId);
      sendSuccess(res, result, 'Payment status retrieved successfully', 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/payments/reconcile (Admin only)
   */
  async reconcilePayments(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const actorId = req.user?.id;
      const validated = ReconcilePaymentsDto.parse(req.body);
      const result = await reconciliationService.reconcileOrphanedPayments(validated.windowMinutes, actorId);
      sendSuccess(res, result, 'Payment reconciliation completed successfully', 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/payments/simulate-crash (Simulation Helper for Task 8)
   */
  async simulateCrashScenario(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const result = await reconciliationService.simulateCrashScenario(userId);
      sendSuccess(res, result, 'Crash scenario initialized', 201);
    } catch (error) {
      next(error);
    }
  }
}

export const paymentController = new PaymentController();
