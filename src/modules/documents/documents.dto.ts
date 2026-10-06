import { z } from 'zod';

export const DocumentMetadataResponseDto = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  fileName: z.string(),
  mimeType: z.string(),
  fileSizeBytes: z.number(),
  fileHashSha256: z.string(),
  createdAt: z.date().or(z.string()),
});
