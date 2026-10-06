import { Request, Response, NextFunction } from 'express';
import { redis } from '../redis/client';
import { RateLimitError } from '../utils/errors';
import { logger } from '../utils/logger';

export interface RateLimiterOptions {
  windowSeconds?: number;
  maxRequests?: number;
  keyPrefix?: string;
}

// Atomic Redis Lua Script: executes INCR and conditional EXPIRE in a single atomic server step
const ATOMIC_RATE_LIMIT_LUA = `
  local current = redis.call('INCR', KEYS[1])
  if current == 1 then
    redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
  end
  return current
`;

export const rateLimiter = (options: RateLimiterOptions = {}) => {
  const windowSeconds = options.windowSeconds || 60;
  const maxRequests = options.maxRequests || 100;
  const keyPrefix = options.keyPrefix || 'ratelimit';

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const client = redis.getClient();
      if (!client) {
        // Fail open to preserve service availability when Redis is disconnected
        return next();
      }

      const identifier = req.user?.id || req.ip || req.socket.remoteAddress || 'anonymous';
      const key = `${keyPrefix}:${identifier}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;

      // Atomic execution prevents unexpired orphaned keys on connection interruption
      const currentCount = await client.eval(ATOMIC_RATE_LIMIT_LUA, 1, key, windowSeconds) as number;

      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - currentCount));

      if (currentCount > maxRequests) {
        logger.warn('Rate limit exceeded', { ip: req.ip, user: req.user?.id, path: req.path });
        return next(new RateLimitError(`Rate limit exceeded. Maximum ${maxRequests} requests per ${windowSeconds}s.`));
      }

      next();
    } catch (err: any) {
      // Fail open to maintain high availability if Redis throws during rate limit check
      logger.warn('Rate limiter check error (failing open to preserve availability)', { error: err.message });
      next();
    }
  };
};
