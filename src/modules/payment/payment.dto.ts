import { z } from 'zod';

export const CreatePaymentDto = z.object({
  amountMinor: z.number().int().positive('Amount must be a positive integer in minor units (e.g. paise/cents)'),
  currency: z.string().min(3).max(3).default('INR'),
  paymentMethod: z.enum(['UPI', 'CARD', 'NETBANKING', 'WALLET']).default('UPI'),
  idempotencyKey: z.string().min(8).max(255).optional(),
  metadata: z.record(z.any()).optional().default({}),
}).strict();

export type CreatePaymentInput = z.infer<typeof CreatePaymentDto>;

export const ProcessMockPaymentDto = z.object({
  referenceId: z.string().min(1, 'Reference ID is required'),
  simulateOutcome: z.enum(['SUCCESS', 'FAILED']).default('SUCCESS'),
}).strict();

export type ProcessMockPaymentInput = z.infer<typeof ProcessMockPaymentDto>;

export const PaymentWebhookPayloadDto = z.object({
  eventId: z.string().min(1, 'Event ID is required'),
  eventType: z.enum(['payment.succeeded', 'payment.failed']),
  referenceId: z.string().min(1, 'Reference ID is required'),
  gatewayTxId: z.string().min(1, 'Gateway Transaction ID is required'),
  amountMinor: z.number().int().positive(),
  currency: z.string().min(3).max(3),
  timestamp: z.string().datetime().or(z.string()),
}).strict();

export type PaymentWebhookPayload = z.infer<typeof PaymentWebhookPayloadDto>;

export const ReconcilePaymentsDto = z.object({
  windowMinutes: z.number().int().positive().max(1440).optional().default(60),
}).strict();

export type ReconcilePaymentsInput = z.infer<typeof ReconcilePaymentsDto>;
