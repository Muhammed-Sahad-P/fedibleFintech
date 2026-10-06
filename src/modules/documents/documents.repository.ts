import { db } from '../../database/pool';

export interface DocumentEntity {
  id: string;
  user_id: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: string | number;
  storage_path: string;
  file_hash_sha256: string;
  created_at: Date;
  updated_at: Date;
}

export class DocumentsRepository {
  async createDocument(data: {
    userId: string;
    fileName: string;
    mimeType: string;
    fileSizeBytes: number;
    storagePath: string;
    fileHashSha256: string;
  }): Promise<DocumentEntity> {
    const result = await db.query<DocumentEntity>(
      `INSERT INTO documents (user_id, file_name, mime_type, file_size_bytes, storage_path, file_hash_sha256)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        data.userId,
        data.fileName,
        data.mimeType,
        data.fileSizeBytes,
        data.storagePath,
        data.fileHashSha256,
      ]
    );
    return result.rows[0];
  }

  async listUserDocuments(userId: string): Promise<DocumentEntity[]> {
    const result = await db.query<DocumentEntity>(
      `SELECT id, user_id, file_name, mime_type, file_size_bytes, file_hash_sha256, created_at, updated_at
       FROM documents 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows;
  }

  async findDocumentById(id: string): Promise<DocumentEntity | null> {
    const result = await db.query<DocumentEntity>(
      'SELECT * FROM documents WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  async deleteDocument(id: string): Promise<boolean> {
    const result = await db.query(
      'DELETE FROM documents WHERE id = $1',
      [id]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async recordSecurityAudit(actorId: string, documentId: string, action: string, details: Record<string, any>, ipAddress?: string) {
    await db.query(
      `INSERT INTO audit_logs (actor_id, entity_type, entity_id, action, details, ip_address)
       VALUES ($1, 'DOCUMENT', $2, $3, $4, $5)`,
      [actorId, documentId, action, JSON.stringify(details), ipAddress || null]
    );
  }
}

export const documentsRepository = new DocumentsRepository();
