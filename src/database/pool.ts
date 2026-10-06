import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { config } from '../config';
import { logger } from '../utils/logger';

export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  max: config.db.poolMax,
  idleTimeoutMillis: config.db.idleTimeoutMillis,
  connectionTimeoutMillis: config.db.connectionTimeoutMillis,
});

pool.on('error', (err: Error) => {
  logger.error('Unexpected PostgreSQL pool error', { error: err.message, stack: err.stack });
});

export const db = {
  query: async <T extends QueryResultRow = any>(
    text: string,
    params?: any[]
  ): Promise<QueryResult<T>> => {
    const start = Date.now();
    try {
      const res = await pool.query<T>(text, params);
      const duration = Date.now() - start;
      if (duration > 1000) {
        logger.warn('Slow SQL query detected', { text, durationMs: duration, rows: res.rowCount });
      }
      return res;
    } catch (error: any) {
      logger.error('Database query failed', { text, params, error: error.message });
      throw error;
    }
  },

  getClient: async (): Promise<PoolClient> => {
    return await pool.connect();
  },

  transaction: async <T>(callback: (client: PoolClient) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  healthCheck: async (): Promise<boolean> => {
    try {
      const result = await pool.query('SELECT 1 AS healthy');
      return result.rows[0]?.healthy === 1;
    } catch (error) {
      return false;
    }
  }
};
