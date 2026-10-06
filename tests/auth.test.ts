import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { db, pool } from '../src/database/pool';
import { runMigrations } from '../src/database/migrate';

describe('Auth Module Integration Tests', () => {
  beforeAll(async () => {
    try {
      await runMigrations();
    } catch {
      // Migrations may already be applied
    }
  });

  const testEmail = `test.user.${Date.now()}@example.com`;
  let authToken: string;

  it('should register a new user successfully (201 Created)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: testEmail,
        password: 'Password@123',
        fullName: 'Test User',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe(testEmail);
    expect(res.body.data.token).toBeDefined();
    authToken = res.body.data.token;
  });

  it('should reject registration with duplicate email (409 Conflict)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: testEmail,
        password: 'Password@123',
        fullName: 'Test User 2',
      });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it('should login an existing user with valid credentials (200 OK)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: testEmail,
        password: 'Password@123',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
  });

  it('should reject login with invalid password (401 Unauthorized)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: testEmail,
        password: 'WrongPassword@123',
      });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('should access protected /me endpoint with valid JWT', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(testEmail);
  });
});
