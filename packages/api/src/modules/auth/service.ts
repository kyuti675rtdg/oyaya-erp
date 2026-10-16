import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../../config';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../middleware/errorHandler';

export interface LoginResult {
  token: string;
  user: {
    id: string;
    email: string;
    name: string;
    roleName: string;
    companyId: string;
  };
}

export interface MeResult {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  isActive: boolean;
  companyId: string;
  role: { id: string; name: string };
  permissions: string[];
}

/** Verify credentials and issue a signed JWT. */
export async function login(email: string, password: string): Promise<LoginResult> {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { role: true },
  });
  if (!user || !user.isActive) {
    throw new AppError(401, 'Invalid email or password');
  }
  const ok = bcrypt.compareSync(password, user.passwordHash);
  if (!ok) {
    throw new AppError(401, 'Invalid email or password');
  }
  const token = jwt.sign({ sub: user.id }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      roleName: user.role.name,
      companyId: user.companyId,
    },
  };
}

/** Current user profile with role and flattened permission codes. */
export async function getMe(userId: string): Promise<MeResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      role: {
        include: {
          permissions: { include: { permission: true } },
        },
      },
    },
  });
  if (!user) {
    throw new AppError(404, 'User not found');
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    isActive: user.isActive,
    companyId: user.companyId,
    role: { id: user.role.id, name: user.role.name },
    permissions: user.role.permissions.map((rp) => rp.permission.code),
  };
}
