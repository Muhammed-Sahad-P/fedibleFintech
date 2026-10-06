import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { documentsController } from './documents.controller';
import { documentsService } from './documents.service';
import { authenticateJwt } from '../../middlewares/auth.middleware';
import { rateLimiter } from '../../middlewares/rate-limiter.middleware';
import { UnauthorizedError } from '../../utils/errors';
import { config } from '../../config';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.storage.maxSizeBytes, // 10MB
  },
});

/**
 * Custom auth middleware for document download:
 * Supports standard Bearer JWT or 5-minute HMAC signed query token (?token=...&expires=...&uid=...)
 */
const authenticateDocumentDownload = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authenticateJwt(req, res, next);
  }

  const { token, expires, uid } = req.query;
  if (token && expires && uid) {
    const isValid = documentsService.verifyDownloadToken(
      req.params.id,
      String(uid),
      String(token),
      parseInt(String(expires), 10)
    );

    if (!isValid) {
      return next(new UnauthorizedError('Invalid, expired, or tampered download signature'));
    }

    req.user = { id: String(uid), email: '', role: 'USER' };
    return next();
  }

  return authenticateJwt(req, res, next);
};

// 1. Upload Financial Document
router.post(
  '/upload',
  authenticateJwt,
  rateLimiter({ maxRequests: 20, windowSeconds: 60, keyPrefix: 'doc_upload' }),
  upload.single('file'),
  (req, res, next) => documentsController.upload(req, res, next)
);

// 2. List Documents
router.get(
  '/',
  authenticateJwt,
  (req, res, next) => documentsController.list(req, res, next)
);

// 3. Download Document Stream (Bearer JWT or Signed HMAC Link)
router.get(
  '/:id/download',
  authenticateDocumentDownload,
  (req, res, next) => documentsController.download(req, res, next)
);

// 4. Get Document Metadata
router.get(
  '/:id',
  authenticateJwt,
  (req, res, next) => documentsController.getMetadata(req, res, next)
);

// 5. Delete Document
router.delete(
  '/:id',
  authenticateJwt,
  (req, res, next) => documentsController.delete(req, res, next)
);

export const documentsRoutes = router;
