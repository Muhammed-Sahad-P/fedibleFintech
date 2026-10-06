import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors';
import { sendError } from '../utils/response';
import { logger } from '../utils/logger';

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const correlationId = req.correlationId;

  // 1. Zod Validation Errors
  if (err instanceof ZodError) {
    const formattedErrors = err.errors.map(e => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    logger.warn('Request validation failed', { correlationId, errors: formattedErrors });
    return sendError(res, 'Validation error', 400, formattedErrors, 'VALIDATION_ERROR');
  }

  // 2. Custom Application Errors
  if (err instanceof AppError) {
    logger.warn(`Operational error: ${err.message}`, {
      correlationId,
      statusCode: err.statusCode,
      details: err.details,
    });
    return sendError(res, err.message, err.statusCode, err.details);
  }

  // 3. PostgreSQL Database Errors
  if (err.code === '23505') { // Unique constraint violation
    logger.warn('Database unique constraint violation', { correlationId, detail: err.detail });
    return sendError(res, 'A record with this unique identifier already exists', 409, { detail: err.detail }, 'DUPLICATE_RESOURCE');
  }

  if (err.code === '23503') { // Foreign key violation
    logger.warn('Database foreign key violation', { correlationId, detail: err.detail });
    return sendError(res, 'Referenced resource does not exist', 400, { detail: err.detail }, 'FOREIGN_KEY_VIOLATION');
  }

  // 4. Fallthrough Unhandled Internal Server Errors
  logger.error('Unhandled internal server error', {
    correlationId,
    message: err.message,
    stack: err.stack,
  });

  const message = process.env.NODE_ENV === 'production' 
    ? 'Internal server error' 
    : err.message || 'Internal server error';

  return sendError(res, message, 500, undefined, 'INTERNAL_SERVER_ERROR');
};
