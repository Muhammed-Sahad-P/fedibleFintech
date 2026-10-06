import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { documentsService } from './documents.service';
import { sendSuccess } from '../../utils/response';
import { BadRequestError, NotFoundError } from '../../utils/errors';

export class DocumentsController {
  async upload(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      if (!req.file) {
        throw new BadRequestError('No file uploaded. Use form-data field "file".');
      }

      const result = await documentsService.uploadDocument(userId, req.file, req.ip);
      sendSuccess(res, result, 'Document uploaded and verified successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const result = await documentsService.listDocuments(userId);
      sendSuccess(res, result, 'Documents retrieved successfully', 200);
    } catch (error) {
      next(error);
    }
  }

  async getMetadata(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const documentId = req.params.id;
      const result = await documentsService.getDocumentMetadata(documentId, userId, req.ip);
      sendSuccess(res, result, 'Document metadata retrieved successfully', 200);
    } catch (error) {
      next(error);
    }
  }

  async download(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const documentId = req.params.id;
      const doc = await documentsService.getDocumentForDownload(documentId, userId, req.ip);

      const absolutePath = path.resolve(doc.filePath);
      if (!fs.existsSync(absolutePath)) {
        throw new NotFoundError('Document physical file missing from storage');
      }

      const fileBuffer = fs.readFileSync(absolutePath);

      // If client requests raw binary file (e.g. ?raw=true or browser download link)
      if (req.query.raw === 'true' || req.query.stream === 'true') {
        res.status(200);
        res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
        res.setHeader('Content-Length', fileBuffer.length);
        res.setHeader('Content-Disposition', `attachment; filename="${doc.fileName}"`);
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length, Content-Type');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        return void res.end(fileBuffer);
      }

      // Default API/Swagger response: Return clean download descriptor with direct download URL
      sendSuccess(res, {
        documentId: doc.id,
        fileName: doc.fileName,
        mimeType: doc.mimeType,
        fileSizeBytes: fileBuffer.length,
        fileHashSha256: doc.fileHashSha256,
        downloadUrl: `http://localhost:${process.env.PORT || 4000}/api/v1/documents/${documentId}/download?raw=true`,
        message: 'Click downloadUrl or open it in a browser to download the raw binary file',
      }, 'Document ready for download', 200);
    } catch (error) {
      next(error);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const documentId = req.params.id;
      const result = await documentsService.deleteDocument(documentId, userId, req.ip);
      sendSuccess(res, result, 'Document deleted successfully', 200);
    } catch (error) {
      next(error);
    }
  }
}

export const documentsController = new DocumentsController();
