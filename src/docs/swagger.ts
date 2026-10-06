import swaggerUi from 'swagger-ui-express';
import { Router } from 'express';

export const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Fedible Fintech Backend API',
    version: '1.0.0',
    description: 'Production-grade financial engineering engine with Feditscore, Idempotent Payments, FEFF Document Vault, and AI Financial Assistant.',
  },
  servers: [
    {
      url: 'http://localhost:4000',
      description: 'Local Development Server',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter your JWT token obtained from /api/v1/auth/login',
      },
    },
  },
  paths: {
    '/health': {
      get: {
        summary: 'System Health Check Probe',
        tags: ['System'],
        responses: {
          200: { description: 'System healthy' },
          503: { description: 'System degraded' },
        },
      },
    },
    '/api/v1/auth/register': {
      post: {
        summary: 'Register a new user',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password', 'fullName'],
                properties: {
                  email: { type: 'string', example: 'alex.rivera@example.com' },
                  password: { type: 'string', example: 'UserPassword@123' },
                  fullName: { type: 'string', example: 'Alex Rivera' },
                  role: { type: 'string', enum: ['USER', 'ADMIN'], default: 'USER' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'User registered successfully' },
          409: { description: 'Email already exists' },
        },
      },
    },
    '/api/v1/auth/login': {
      post: {
        summary: 'Login user & receive JWT token',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', example: 'alex.rivera@example.com' },
                  password: { type: 'string', example: 'UserPassword@123' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Login successful' },
          401: { description: 'Invalid credentials' },
        },
      },
    },
    '/api/v1/auth/me': {
      get: {
        summary: 'Get current user profile',
        tags: ['Authentication'],
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: 'User profile retrieved' },
          401: { description: 'Unauthorized' },
        },
      },
    },
    '/api/v1/assessment': {
      post: {
        summary: 'Start new assessment & get active questions',
        tags: ['Feditscore Scoring Engine'],
        security: [{ bearerAuth: [] }],
        responses: {
          201: { description: 'Assessment initialized' },
        },
      },
    },
    '/api/v1/assessment/{id}/answers': {
      post: {
        summary: 'Submit answers and calculate Feditscore',
        tags: ['Feditscore Scoring Engine'],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['answers'],
                properties: {
                  answers: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['questionId', 'selectedOptionKey'],
                      properties: {
                        questionId: { type: 'string', format: 'uuid' },
                        selectedOptionKey: { type: 'string', example: 'A' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Answers evaluated and score calculated' },
        },
      },
    },
    '/api/v1/assessment/{id}/result': {
      get: {
        summary: 'Retrieve score result with Redis cache header (X-Cache)',
        tags: ['Feditscore Scoring Engine'],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: { description: 'Score breakdown retrieved' },
        },
      },
    },
    '/api/v1/payments/create': {
      post: {
        summary: 'Create a payment order (Status: PENDING)',
        tags: ['Payments & Webhooks'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['amountMinor'],
                properties: {
                  amountMinor: { type: 'integer', example: 1000000, description: 'Amount in paise/cents (₹10,000 = 1000000)' },
                  currency: { type: 'string', example: 'INR' },
                  paymentMethod: { type: 'string', enum: ['UPI', 'CARD', 'NETBANKING', 'WALLET'], default: 'UPI' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Payment order created' },
        },
      },
    },
    '/api/v1/payments/mock-gateway/process': {
      post: {
        summary: 'Simulate mock gateway settlement & signed webhook trigger',
        tags: ['Payments & Webhooks'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['referenceId'],
                properties: {
                  referenceId: { type: 'string', example: 'REF_...' },
                  simulateOutcome: { type: 'string', enum: ['SUCCESS', 'FAILED'], default: 'SUCCESS' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Mock payment processed and webhook delivered' },
        },
      },
    },
    '/api/v1/webhooks/payment': {
      post: {
        summary: 'Payment gateway webhook ingress (HMAC-SHA256 verified)',
        tags: ['Payments & Webhooks'],
        parameters: [
          { name: 'X-Webhook-Signature', in: 'header', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['eventId', 'eventType', 'referenceId', 'gatewayTxId', 'amountMinor', 'currency', 'timestamp'],
                properties: {
                  eventId: { type: 'string' },
                  eventType: { type: 'string', enum: ['payment.succeeded', 'payment.failed'] },
                  referenceId: { type: 'string' },
                  gatewayTxId: { type: 'string' },
                  amountMinor: { type: 'integer' },
                  currency: { type: 'string' },
                  timestamp: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Webhook processed (or duplicate recognized)' },
          401: { description: 'Invalid HMAC signature' },
        },
      },
    },
    '/api/v1/payments/{referenceId}': {
      get: {
        summary: 'Get verified payment status',
        tags: ['Payments & Webhooks'],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'referenceId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Payment status' },
          404: { description: 'Not found' },
        },
      },
    },
    '/api/v1/payments/simulate-crash': {
      post: {
        summary: 'Task 8: Simulate DB crash scenario (Charge settled at gateway, PENDING in DB)',
        tags: ['Payments & Webhooks'],
        security: [{ bearerAuth: [] }],
        responses: {
          201: { description: 'Crash scenario initialized' },
        },
      },
    },
    '/api/v1/payments/reconcile': {
      post: {
        summary: 'Task 8: Trigger payment reconciliation worker (ADMIN only)',
        tags: ['Payments & Webhooks'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  windowMinutes: { type: 'integer', default: 60 },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Reconciliation completed and orphaned charges recovered' },
          403: { description: 'Admin role required' },
        },
      },
    },
    '/api/v1/documents/upload': {
      post: {
        summary: 'Upload financial document (Magic-byte check + SHA-256 hash)',
        tags: ['FEFF Document Vault'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: {
                  file: { type: 'string', format: 'binary' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Document uploaded' },
          400: { description: 'Invalid file format' },
        },
      },
    },
    '/api/v1/documents': {
      get: {
        summary: 'List current user documents',
        tags: ['FEFF Document Vault'],
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: 'Document list' },
        },
      },
    },
    '/api/v1/documents/{id}/download': {
      get: {
        summary: 'Download document (Returns 404 for unauthorized access + audit log)',
        tags: ['FEFF Document Vault'],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: { description: 'File stream' },
          404: { description: 'Not found (Anti-enumeration)' },
        },
      },
    },
    '/api/v1/financial-assistant': {
      post: {
        summary: 'Task 9: AI Financial Advisor (Strict Data Minimisation)',
        tags: ['AI Financial Assistant'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['income', 'expenses', 'savings', 'debt', 'financialGoals'],
                properties: {
                  income: { type: 'number', example: 150000 },
                  expenses: { type: 'number', example: 65000 },
                  savings: { type: 'number', example: 400000 },
                  debt: { type: 'number', example: 120000 },
                  currency: { type: 'string', enum: ['INR', 'USD', 'EUR', 'GBP'], default: 'INR' },
                  financialGoals: {
                    type: 'array',
                    items: {
                      type: 'string',
                      enum: ['EMERGENCY_FUND', 'HOME_PURCHASE', 'DEBT_FREEDOM', 'RETIREMENT_PLANNING', 'WEALTH_CREATION', 'EDUCATION'],
                    },
                    example: ['EMERGENCY_FUND', 'HOME_PURCHASE'],
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Financial diagnostics generated' },
        },
      },
    },
    '/api/v1/debug/slow-assessment-report': {
      get: {
        summary: 'Task 10: Buggy N+1 Query & Unindexed Scan Endpoint',
        tags: ['Production Debugging Challenge'],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: {
          200: { description: 'Slow report performance profile' },
        },
      },
    },
    '/api/v1/debug/optimized-assessment-report': {
      get: {
        summary: 'Task 10: Optimized Single-Query & Composite Index Endpoint',
        tags: ['Production Debugging Challenge'],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: {
          200: { description: 'Optimized report performance profile' },
        },
      },
    },
  },
};

const router = Router();
router.use('/', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

export const swaggerRoutes = router;
