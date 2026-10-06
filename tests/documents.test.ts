import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { db } from '../src/database/pool';
import { runMigrations } from '../src/database/migrate';

describe('FEFF Document Vault Security & Tenant Isolation Tests', () => {
  let userAToken: string;
  let userBToken: string;
  let documentId: string;

  beforeAll(async () => {
    try {
      await runMigrations();
    } catch {}

    // Register User A
    const userARes = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: `usera.${Date.now()}@example.com`, password: 'Password@123', fullName: 'User A' });
    userAToken = userARes.body.data.token;

    // Register User B
    const userBRes = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: `userb.${Date.now()}@example.com`, password: 'Password@123', fullName: 'User B' });
    userBToken = userBRes.body.data.token;
  });

  it('should upload a valid PDF document and return metadata (201 Created)', async () => {
    // Valid PDF magic bytes: %PDF-1.4
    const validPdfBuffer = Buffer.from('%PDF-1.4 sample content for bank statement audit', 'utf8');

    const res = await request(app)
      .post('/api/v1/documents/upload')
      .set('Authorization', `Bearer ${userAToken}`)
      .attach('file', validPdfBuffer, 'bank_statement_2026.pdf');

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.documentId).toBeDefined();
    expect(res.body.data.mimeType).toBe('application/pdf');
    expect(res.body.data.fileHashSha256).toBeDefined();

    documentId = res.body.data.documentId;
  });

  it('should reject file upload with invalid magic bytes (400 Bad Request)', async () => {
    // Invalid buffer pretending to be a PDF
    const fakeExecutableBuffer = Buffer.from('MZ\x90\x00 fake executable header', 'utf8');

    const res = await request(app)
      .post('/api/v1/documents/upload')
      .set('Authorization', `Bearer ${userAToken}`)
      .attach('file', fakeExecutableBuffer, 'malicious.pdf');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should list documents belonging exclusively to User A (200 OK)', async () => {
    const res = await request(app)
      .get('/api/v1/documents')
      .set('Authorization', `Bearer ${userAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].documentId).toBe(documentId);
  });

  it('SECURITY TEST (IDOR): User B should receive 404 Not Found when accessing User A document', async () => {
    const res = await request(app)
      .get(`/api/v1/documents/${documentId}`)
      .set('Authorization', `Bearer ${userBToken}`);

    // Must return 404 (not 403) to prevent ID enumeration
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);

    // Verify security audit log was created for unauthorized attempt
    const auditRes = await db.query(
      "SELECT * FROM audit_logs WHERE action = 'UNAUTHORIZED_DOCUMENT_ACCESS_ATTEMPT' AND entity_id = $1",
      [documentId]
    );
    expect(auditRes.rows.length).toBeGreaterThan(0);
  });

  it('SECURITY TEST (IDOR): User B should receive 404 Not Found when attempting to download User A document', async () => {
    const res = await request(app)
      .get(`/api/v1/documents/${documentId}/download`)
      .set('Authorization', `Bearer ${userBToken}`);

    expect(res.status).toBe(404);
  });

  it('should allow User A to download their own document (200 OK)', async () => {
    const res = await request(app)
      .get(`/api/v1/documents/${documentId}/download`)
      .set('Authorization', `Bearer ${userAToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
  });

  it('should allow User A to delete their document (200 OK)', async () => {
    const res = await request(app)
      .delete(`/api/v1/documents/${documentId}`)
      .set('Authorization', `Bearer ${userAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Subsequent retrieval by User A should now return 404
    const getRes = await request(app)
      .get(`/api/v1/documents/${documentId}`)
      .set('Authorization', `Bearer ${userAToken}`);

    expect(getRes.status).toBe(404);
  });
});
