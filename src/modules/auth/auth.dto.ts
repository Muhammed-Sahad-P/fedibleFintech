import { z } from 'zod';

export const RegisterDto = z.object({
  email: z.string().email('Invalid email address format'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  fullName: z.string().min(2, 'Full name must be at least 2 characters long'),
  role: z.enum(['USER', 'ADMIN']).optional().default('USER'),
}).strict();

export type RegisterInput = z.infer<typeof RegisterDto>;

export const LoginDto = z.object({
  email: z.string().email('Invalid email address format'),
  password: z.string().min(1, 'Password is required'),
}).strict();

export type LoginInput = z.infer<typeof LoginDto>;
