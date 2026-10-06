import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../config';
import { documentsRepository, DocumentEntity } from './documents.repository';
import { BadRequestError, NotFoundError } from '../../utils/errors';
import { logger } from '../../utils/logger';

export class DocumentsService {
  constructor() {
    // Ensure upload directory exists
    if (!fs.existsSync(config.storage.uploadDir)) {
      fs.mkdirSync(config.storage.uploadDir, { recursive: true });
    }
  }

  /**
   * Validates file magic-bytes to prevent MIME spoofing
   */
  private validateMagicBytes(buffer: Buffer): { isValid: boolean; verifiedMime: string } {
    if (buffer.length < 4) {
      return { isValid: false, verifiedMime: 'unknown' };
    }

    // PDF: %PDF (0x25, 0x50, 0x44, 0x46)
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
      return { isValid: true, verifiedMime: 'application/pdf' };
    }

    // PNG: \x89PNG (0x89, 0x50, 0x4E, 0x47)
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      return { isValid: true, verifiedMime: 'image/png' };
    }

    // JPEG: 0xFF, 0xD8, 0xFF
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      return { isValid: true, verifiedMime: 'image/jpeg' };
    }

    return { isValid: false, verifiedMime: 'unknown' };
  }

  /**
   * 1. Uploads financial document with magic-byte validation and SHA-256 hash
   */
  async uploadDocument(
    userId: string,
    file: Express.Multer.File,
    ipAddress?: string
  ) {
    if (!file || !file.buffer) {
      throw new BadRequestError('File content is required');
    }

    if (file.size > config.storage.maxSizeBytes) {
      throw new BadRequestError(`File size exceeds the maximum limit of ${config.storage.maxSizeBytes / (1024 * 1024)}MB`);
    }

    // Verify magic bytes
    const { isValid, verifiedMime } = this.validateMagicBytes(file.buffer);
    if (!isValid) {
      throw new BadRequestError('Invalid file format. Only verified PDF, PNG, and JPEG documents are permitted.');
    }

    // Calculate SHA-256 checksum
    const sha256Hash = crypto.createHash('sha256').update(file.buffer).digest('hex');

    // Secure storage filename
    const safeFileExtension = verifiedMime === 'application/pdf' ? '.pdf' : verifiedMime === 'image/png' ? '.png' : '.jpg';
    const storageFileName = `${uuidv4()}${safeFileExtension}`;
    const storagePath = path.join(config.storage.uploadDir, storageFileName);

    // Write file to disk
    fs.writeFileSync(storagePath, file.buffer);

    // Save record to PostgreSQL
    const document = await documentsRepository.createDocument({
      userId,
      fileName: path.basename(file.originalname),
      mimeType: verifiedMime,
      fileSizeBytes: file.size,
      storagePath,
      fileHashSha256: sha256Hash,
    });

    // Record audit log
    await documentsRepository.recordSecurityAudit(
      userId,
      document.id,
      'DOCUMENT_UPLOAD',
      { fileName: document.file_name, mimeType: verifiedMime, sha256: sha256Hash },
      ipAddress
    );

    return {
      documentId: document.id,
      fileName: document.file_name,
      mimeType: document.mime_type,
      fileSizeBytes: Number(document.file_size_bytes),
      fileHashSha256: document.file_hash_sha256,
      createdAt: document.created_at,
    };
  }

  /**
   * 2. Lists documents owned by the current authenticated user
   */
  async listDocuments(userId: string) {
    const docs = await documentsRepository.listUserDocuments(userId);
    return docs.map(d => ({
      documentId: d.id,
      fileName: d.file_name,
      mimeType: d.mime_type,
      fileSizeBytes: Number(d.file_size_bytes),
      fileHashSha256: d.file_hash_sha256,
      createdAt: d.created_at,
    }));
  }

  /**
   * 3. Retrieves document metadata with anti-enumeration 404 & audit log
   */
  async getDocumentMetadata(documentId: string, userId: string, ipAddress?: string) {
    const doc = await documentsRepository.findDocumentById(documentId);

    if (!doc || doc.user_id !== userId) {
      if (doc && doc.user_id !== userId) {
        // Unauthorized cross-tenant attempt: record audit log
        await documentsRepository.recordSecurityAudit(
          userId,
          documentId,
          'UNAUTHORIZED_DOCUMENT_ACCESS_ATTEMPT',
          { targetDocumentId: documentId, ownerId: doc.user_id },
          ipAddress
        );
      }
      // Return 404 (not 403) to prevent resource ID enumeration
      throw new NotFoundError('Document not found');
    }

    return {
      documentId: doc.id,
      fileName: doc.file_name,
      mimeType: doc.mime_type,
      fileSizeBytes: Number(doc.file_size_bytes),
      fileHashSha256: doc.file_hash_sha256,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
    };
  }

  /**
   * 4. Downloads document with ownership validation & streaming
   */
  async getDocumentForDownload(documentId: string, userId: string, ipAddress?: string) {
    const doc = await documentsRepository.findDocumentById(documentId);

    if (!doc || doc.user_id !== userId) {
      if (doc && doc.user_id !== userId) {
        await documentsRepository.recordSecurityAudit(
          userId,
          documentId,
          'UNAUTHORIZED_DOCUMENT_ACCESS_ATTEMPT',
          { targetDocumentId: documentId, ownerId: doc.user_id },
          ipAddress
        );
      }
      throw new NotFoundError('Document not found');
    }

    if (!fs.existsSync(doc.storage_path)) {
      throw new NotFoundError('Document physical file missing from storage');
    }

    return {
      filePath: doc.storage_path,
      fileName: doc.file_name,
      mimeType: doc.mime_type,
    };
  }

  /**
   * 5. Deletes document with ownership validation & audit log
   */
  async deleteDocument(documentId: string, userId: string, ipAddress?: string) {
    const doc = await documentsRepository.findDocumentById(documentId);

    if (!doc || doc.user_id !== userId) {
      if (doc && doc.user_id !== userId) {
        await documentsRepository.recordSecurityAudit(
          userId,
          documentId,
          'UNAUTHORIZED_DOCUMENT_ACCESS_ATTEMPT',
          { targetDocumentId: documentId, ownerId: doc.user_id },
          ipAddress
        );
      }
      throw new NotFoundError('Document not found');
    }

    // Remove physical file
    if (fs.existsSync(doc.storage_path)) {
      fs.unlinkSync(doc.storage_path);
    }

    // Delete database record
    await documentsRepository.deleteDocument(documentId);

    // Record audit log
    await documentsRepository.recordSecurityAudit(
      userId,
      documentId,
      'DOCUMENT_DELETED',
      { fileName: doc.file_name },
      ipAddress
    );

    return { documentId, deleted: true };
  }
}

export const documentsService = new DocumentsService();
