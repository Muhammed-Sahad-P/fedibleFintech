import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { requestLogger } from './middlewares/request-logger.middleware';
import { errorHandler } from './middlewares/error.middleware';
import { authRoutes } from './modules/auth/auth.routes';
import { assessmentRoutes } from './modules/assessment/assessment.routes';
import { paymentRoutes } from './modules/payment/payment.routes';
import { documentsRoutes } from './modules/documents/documents.routes';
import { aiAssistantRoutes } from './modules/ai-assistant/ai-assistant.routes';
import { debuggingRoutes } from './modules/debugging/debugging.routes';
import { swaggerRoutes } from './docs/swagger';
import { db } from './database/pool';
import { redis } from './redis/client';

const app = express();

// Security Middlewares
app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID', 'X-Webhook-Signature', 'Idempotency-Key'],
}));

// Body Parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Correlation ID & Request Logger
app.use(requestLogger);

// Interactive Swagger UI Documentation
app.use('/docs', swaggerRoutes);
app.use('/api-docs', swaggerRoutes);

// Health Check Probe
app.get('/health', async (req, res) => {
  const isDbHealthy = await db.healthCheck();
  const isRedisHealthy = await redis.healthCheck();

  const status = isDbHealthy ? 'HEALTHY' : 'DEGRADED';
  const statusCode = isDbHealthy ? 200 : 503;

  return res.status(statusCode).json({
    status,
    timestamp: new Date().toISOString(),
    services: {
      database: isDbHealthy ? 'UP' : 'DOWN',
      redis: isRedisHealthy ? 'UP' : 'DEGRADED',
    },
    version: '1.0.0',
    docs: 'http://localhost:4000/docs',
  });
});

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/assessment', assessmentRoutes);
app.use('/api/v1/documents', documentsRoutes);
app.use('/api/v1', paymentRoutes);
app.use('/api/v1', aiAssistantRoutes);
app.use('/api/v1/debug', debuggingRoutes);

// Root Welcome Route redirecting to /docs
app.get('/', (req, res) => {
  res.redirect('/docs');
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      message: `Cannot ${req.method} ${req.originalUrl}`,
      code: 'ROUTE_NOT_FOUND',
      documentation: 'http://localhost:4000/docs',
    }
  });
});

// Centralized Error Handler
app.use(errorHandler);

export default app;
