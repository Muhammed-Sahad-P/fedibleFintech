import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';

class RedisService {
  private client: Redis | null = null;
  private isConnected: boolean = false;

  constructor() {
    this.init();
  }

  private init() {
    try {
      this.client = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        retryStrategy: (times) => {
          const delay = Math.min(times * 100, 3000);
          return delay;
        },
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        logger.info('Connected to Redis');
      });

      this.client.on('error', (err) => {
        this.isConnected = false;
        logger.warn('Redis connection issue (degrading to direct DB if needed)', { error: err.message });
      });

      this.client.on('close', () => {
        this.isConnected = false;
      });

      // Connect asynchronously
      this.client.connect().catch((err) => {
        logger.warn('Initial Redis connection failed, caching degraded', { error: err.message });
      });
    } catch (err: any) {
      logger.error('Failed to initialize Redis client', { error: err.message });
    }
  }

  public getClient(): Redis | null {
    return this.client;
  }

  public async get<T>(key: string): Promise<T | null> {
    if (!this.client || !this.isConnected) return null;
    try {
      const data = await this.client.get(key);
      if (!data) return null;
      return JSON.parse(data) as T;
    } catch (err: any) {
      logger.warn('Redis GET failed', { key, error: err.message });
      return null;
    }
  }

  public async set(key: string, value: any, ttlSeconds?: number): Promise<boolean> {
    if (!this.client || !this.isConnected) return false;
    try {
      const stringified = JSON.stringify(value);
      if (ttlSeconds) {
        await this.client.set(key, stringified, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, stringified);
      }
      return true;
    } catch (err: any) {
      logger.warn('Redis SET failed', { key, error: err.message });
      return false;
    }
  }

  public async del(key: string): Promise<boolean> {
    if (!this.client || !this.isConnected) return false;
    try {
      await this.client.del(key);
      return true;
    } catch (err: any) {
      logger.warn('Redis DEL failed', { key, error: err.message });
      return false;
    }
  }

  public async invalidatePattern(pattern: string): Promise<void> {
    if (!this.client || !this.isConnected) return;
    try {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.client.del(...keys);
        }
      } while (cursor !== '0');
    } catch (err: any) {
      logger.warn('Redis SCAN/DEL pattern invalidation failed', { pattern, error: err.message });
    }
  }

  public async healthCheck(): Promise<boolean> {
    if (!this.client) return false;
    try {
      const pong = await this.client.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }
}

export const redis = new RedisService();
