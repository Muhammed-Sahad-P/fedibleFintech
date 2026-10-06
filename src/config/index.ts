import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  
  db: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/fedible_db',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'fedible_db',
    poolMax: parseInt(process.env.DB_POOL_MAX || '20', 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },
  
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  
  jwt: {
    secret: process.env.JWT_SECRET || 'fedible_production_grade_super_secret_jwt_key_2026',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  
  webhook: {
    secret: process.env.WEBHOOK_SECRET || 'whsec_fedible_fintech_secure_hmac_signing_key_9988',
  },
  
  storage: {
    uploadDir: process.env.UPLOAD_DIR || './uploads',
    maxSizeBytes: parseInt(process.env.MAX_FILE_SIZE_BYTES || '10485760', 10), // 10MB
  },
  
  ai: {
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    enableMockAi: process.env.ENABLE_MOCK_AI === 'true',
  },
  
  debug: {
    enableBenchmarks: process.env.ENABLE_DEBUG_BENCHMARKS === 'true',
  }
};
