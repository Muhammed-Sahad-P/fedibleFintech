import { Request, Response, NextFunction } from 'express';
import { authService } from './auth.service';
import { RegisterDto, LoginDto } from './auth.dto';
import { sendSuccess } from '../../utils/response';

export class AuthController {
  async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const validated = RegisterDto.parse(req.body);
      const result = await authService.register(validated);
      sendSuccess(res, result, 'User registered successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const validated = LoginDto.parse(req.body);
      const result = await authService.login(validated);
      sendSuccess(res, result, 'Login successful', 200);
    } catch (error) {
      next(error);
    }
  }

  async getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const profile = await authService.getProfile(userId);
      sendSuccess(res, profile, 'Profile retrieved successfully', 200);
    } catch (error) {
      next(error);
    }
  }
}

export const authController = new AuthController();
