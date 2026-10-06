import { db } from '../../database/pool';

export interface UserEntity {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  role: 'USER' | 'ADMIN';
  created_at: Date;
  updated_at: Date;
}

export class AuthRepository {
  async findByEmail(email: string): Promise<UserEntity | null> {
    const result = await db.query<UserEntity>(
      'SELECT id, email, password_hash, full_name, role, created_at, updated_at FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    return result.rows[0] || null;
  }

  async findById(id: string): Promise<UserEntity | null> {
    const result = await db.query<UserEntity>(
      'SELECT id, email, password_hash, full_name, role, created_at, updated_at FROM users WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  async createUser(data: {
    email: string;
    passwordHash: string;
    fullName: string;
    role: 'USER' | 'ADMIN';
  }): Promise<UserEntity> {
    const result = await db.query<UserEntity>(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, password_hash, full_name, role, created_at, updated_at`,
      [data.email.toLowerCase().trim(), data.passwordHash, data.fullName.trim(), data.role]
    );
    return result.rows[0];
  }
}

export const authRepository = new AuthRepository();
