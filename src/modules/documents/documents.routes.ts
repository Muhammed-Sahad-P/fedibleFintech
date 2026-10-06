import { Router } from 'express';
import multer from 'multer';
import { documentsController } from './documents.controller';
import { authenticateJwt } from '../../middlewares/auth.middleware';
import { rateLimiter } from '../../middlewares/rate-limiter.middleware';
import { config } from '../../config';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.storage.maxSizeBytes, // 10MB
  },
});

// All document operations require authentication
router.use(authenticateJwt);

// 1. Upload Financial Document
router.post(
  '/upload',
  rateLimiter({ maxRequests: 20, windowSeconds: 60, keyPrefix: 'doc_upload' }),
  upload.single('file'),
  (req, res, next) => documentsController.upload(req, res, next)
);

// 2. List Documents
router.get(
  '/',
  (req, res, next) => documentsController.list(req, res, next)
);

// 3. Download Document Stream
router.get(
  '/:id/download',
  (req, res, next) => documentsController.download(req, res, next)
);

// 4. Get Document Metadata
router.get(
  '/:id',
  (req, res, next) => documentsController.getMetadata(req, res, next)
);

// 5. Delete Document
router.delete(
  '/:id',
  (req, res, next) => documentsController.delete(req, res, next)
);

export const documentsRoutes = router;
