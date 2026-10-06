import { Request, Response, NextFunction } from 'express';
import path from 'path';
import { documentsService } from './documents.service';
import { sendSuccess } from '../../utils/response';
import { BadRequestError } from '../../utils/errors';

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

      res.setHeader('Content-Type', doc.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${doc.fileName}"`);
      const absolutePath = path.resolve(doc.filePath);
      res.sendFile(absolutePath);
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
