import { Request, Response, NextFunction } from 'express';
import { redis } from '../redis/client';
import { RateLimitError } from '../utils/errors';
import { logger } from '../utils/logger';

export interface RateLimiterOptions {
  windowSeconds?: number;
  maxRequests?: number;
  keyPrefix?: string;
}

export const rateLimiter = (options: RateLimiterOptions = {}) => {
  const windowSeconds = options.windowSeconds || 60;
  const maxRequests = options.maxRequests || 100;
  const keyPrefix = options.keyPrefix || 'ratelimit';

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const client = redis.getClient();
      if (!client) {
        // Degrade gracefully if Redis is unavailable
        return next();
      }

      const identifier = req.user?.id || req.ip || req.socket.remoteAddress || 'anonymous';
      const key = `${keyPrefix}:${identifier}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;

      const currentCount = await client.incr(key);
      if (currentCount === 1) {
        await client.expire(key, windowSeconds);
      }

      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - currentCount));

      if (currentCount > maxRequests) {
        logger.warn('Rate limit exceeded', { ip: req.ip, user: req.user?.id, path: req.path });
        return next(new RateLimitError(`Rate limit exceeded. Maximum ${maxRequests} requests per ${windowSeconds}s.`));
      }

      next();
    } catch (err: any) {
      logger.warn('Rate limiter check error, bypassing limit', { error: err.message });
      next();
    }
  };
};
