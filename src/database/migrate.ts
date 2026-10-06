import fs from 'fs';
import path from 'path';
import { db, pool } from './pool';
import { logger } from '../utils/logger';

export async function runMigrations() {
  logger.info('Starting PostgreSQL schema migrations...');
  try {
    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      logger.info(`Applying migration: ${file}`);
      await db.query(sql);
      logger.info(`Successfully applied migration: ${file}`);
    }

    logger.info('All database migrations completed successfully.');
  } catch (error: any) {
    logger.error('Database migration failed', { error: error.message, stack: error.stack });
    throw error;
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => {
      logger.info('Migration process finished.');
      process.exit(0);
    })
    .catch(() => {
      process.exit(1);
    });
}
