import bcrypt from 'bcrypt';
import { db, pool } from './pool';
import { logger } from '../utils/logger';

export async function seedDatabase() {
  logger.info('Seeding database with initial questions and users...');
  try {
    // 1. Seed Users (1 Admin, 1 Demo User)
    const saltRounds = 10;
    const adminPasswordHash = await bcrypt.hash('AdminPassword@123', saltRounds);
    const userPasswordHash = await bcrypt.hash('UserPassword@123', saltRounds);

    await db.query(`
      INSERT INTO users (email, password_hash, full_name, role)
      VALUES 
        ('admin@fedible.io', $1, 'Fedible Admin', 'ADMIN'),
        ('alex.rivera@example.com', $2, 'Alex Rivera', 'USER')
      ON CONFLICT (email) DO NOTHING;
    `, [adminPasswordHash, userPasswordHash]);

    // 2. Seed Financial Assessment Questions
    const questions = [
      {
        code: 'DEBT_TO_INCOME',
        prompt: 'What percentage of your total monthly income is committed to debt repayments (EMIs, credit card minimums)?',
        category: 'DEBT',
        weight: 100,
        options: JSON.stringify([
          { key: 'A', label: 'Less than 20% of monthly income', score: 100 },
          { key: 'B', label: 'Between 20% and 35% of monthly income', score: 80 },
          { key: 'C', label: 'Between 35% and 50% of monthly income', score: 50 },
          { key: 'D', label: 'Over 50% of monthly income', score: 20 },
        ]),
      },
      {
        code: 'EMERGENCY_SAVINGS_BUFFER',
        prompt: 'How many months of essential living expenses do you currently hold in liquid cash or savings accounts?',
        category: 'LIQUIDITY',
        weight: 100,
        options: JSON.stringify([
          { key: 'A', label: '6 months or more', score: 100 },
          { key: 'B', label: '3 to 6 months', score: 80 },
          { key: 'C', label: '1 to 3 months', score: 50 },
          { key: 'D', label: 'Less than 1 month', score: 15 },
        ]),
      },
      {
        code: 'MONTHLY_SAVINGS_RATE',
        prompt: 'What percentage of your net monthly earnings do you consistently save or invest each month?',
        category: 'SAVINGS',
        weight: 100,
        options: JSON.stringify([
          { key: 'A', label: 'More than 30%', score: 100 },
          { key: 'B', label: '15% to 30%', score: 80 },
          { key: 'C', label: '5% to 15%', score: 50 },
          { key: 'D', label: '0% to 5% (or living paycheck to paycheck)', score: 20 },
        ]),
      },
      {
        code: 'CREDIT_CARD_UTILIZATION',
        prompt: 'On average, what percentage of your total credit card limits do you utilize across all revolving lines?',
        category: 'DEBT',
        weight: 100,
        options: JSON.stringify([
          { key: 'A', label: 'Under 10% (paid in full monthly)', score: 100 },
          { key: 'B', label: '10% to 30%', score: 80 },
          { key: 'C', label: '30% to 60%', score: 50 },
          { key: 'D', label: 'Over 60% or maxing out cards', score: 15 },
        ]),
      },
      {
        code: 'INCOME_STABILITY',
        prompt: 'How consistent has your primary source of income been over the past 24 months?',
        category: 'INCOME_STABILITY',
        weight: 100,
        options: JSON.stringify([
          { key: 'A', label: 'Stable permanent employment / consistent salaried stream', score: 100 },
          { key: 'B', label: 'Self-employed / business with stable multi-year cash flow', score: 80 },
          { key: 'C', label: 'Freelancer / variable contract income', score: 55 },
          { key: 'D', label: 'Irregular income or recent employment gap', score: 25 },
        ]),
      },
      {
        code: 'FIXED_OBLIGATION_RATIO',
        prompt: 'What proportion of your net income is locked into mandatory fixed obligations (rent/mortgage, utilities, insurance)?',
        category: 'EXPENSES',
        weight: 100,
        options: JSON.stringify([
          { key: 'A', label: 'Less than 30%', score: 100 },
          { key: 'B', label: '30% to 50%', score: 80 },
          { key: 'C', label: '50% to 70%', score: 50 },
          { key: 'D', label: 'Greater than 70%', score: 20 },
        ]),
      },
    ];

    for (const q of questions) {
      await db.query(`
        INSERT INTO questions (code, prompt, category, weight, options, is_active)
        VALUES ($1, $2, $3, $4, $5, TRUE)
        ON CONFLICT (code) DO UPDATE
        SET prompt = EXCLUDED.prompt,
            category = EXCLUDED.category,
            weight = EXCLUDED.weight,
            options = EXCLUDED.options;
      `, [q.code, q.prompt, q.category, q.weight, q.options]);
    }

    logger.info('Database seeded successfully.');
  } catch (error: any) {
    logger.error('Database seeding failed', { error: error.message, stack: error.stack });
    throw error;
  }
}

if (require.main === module) {
  seedDatabase()
    .then(() => {
      logger.info('Seed process finished.');
      process.exit(0);
    })
    .catch(() => {
      process.exit(1);
    });
}
