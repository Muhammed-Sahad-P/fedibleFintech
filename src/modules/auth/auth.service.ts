import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { config } from '../../config';
import { authRepository, UserEntity } from './auth.repository';
import { RegisterInput, LoginInput } from './auth.dto';
import { ConflictError, UnauthorizedError, NotFoundError } from '../../utils/errors';
import { AuthenticatedUser } from '../../middlewares/auth.middleware';

export class AuthService {
  private readonly saltRounds = 10;

  async register(input: RegisterInput) {
    const existing = await authRepository.findByEmail(input.email);
    if (existing) {
      throw new ConflictError('A user with this email address already exists');
    }

    const passwordHash = await bcrypt.hash(input.password, this.saltRounds);
    const user = await authRepository.createUser({
      email: input.email,
      passwordHash,
      fullName: input.fullName,
      role: input.role || 'USER',
    });

    const token = this.generateToken(user);

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        createdAt: user.created_at,
      },
      token,
    };
  }

  async login(input: LoginInput) {
    const user = await authRepository.findByEmail(input.email);
    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const isMatch = await bcrypt.compare(input.password, user.password_hash);
    if (!isMatch) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const token = this.generateToken(user);

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        createdAt: user.created_at,
      },
      token,
    };
  }

  async getProfile(userId: string) {
    const user = await authRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('User profile not found');
    }

    return {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      createdAt: user.created_at,
    };
  }

  private generateToken(user: UserEntity): string {
    const payload: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      role: user.role,
    };

    return jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn as any,
    });
  }
}

export const authService = new AuthService();
