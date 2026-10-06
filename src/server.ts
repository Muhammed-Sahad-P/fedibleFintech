import app from './app';
import { config } from './config';
import { logger } from './utils/logger';
import { runMigrations } from './database/migrate';
import { seedDatabase } from './database/seed';
import { pool } from './database/pool';

async function bootstrap() {
  try {
    // 1. Run migrations and seed data
    logger.info('Initializing Fedible Fintech database...');
    try {
      await runMigrations();
      if (config.nodeEnv !== 'production') {
        await seedDatabase();
      } else {
        logger.info('Production environment detected: skipping automated database seeding.');
      }
    } catch (dbErr: any) {
      logger.warn('Database initialization warning (will retry on next request)', { error: dbErr.message });
    }

    // 2. Start HTTP Server
    const server = app.listen(config.port, () => {
      logger.info(`Fedible Fintech Backend running on port ${config.port} [${config.nodeEnv}]`);
      logger.info(`Health check available at http://localhost:${config.port}/health`);
    });

    // 3. Graceful Shutdown Handlers
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}. Starting graceful shutdown...`);
      server.close(async () => {
        logger.info('HTTP server closed.');
        try {
          await pool.end();
          logger.info('PostgreSQL pool drained.');
          process.exit(0);
        } catch (err: any) {
          logger.error('Error during shutdown', { error: err.message });
          process.exit(1);
        }
      });

      // Force shutdown after 10s
      setTimeout(() => {
        logger.error('Forced shutdown due to timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error: any) {
    logger.error('Fatal bootstrap error', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

bootstrap();
