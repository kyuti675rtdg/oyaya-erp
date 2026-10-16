import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { AppError } from './errorHandler';
import type { AuthUser } from '../types/express';

interface JwtPayload {
  sub: string;
}

/** Verify Bearer JWT, load the user + role, attach req.user. */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new AppError(401, 'Missing bearer token');
    }
    const token = header.slice('Bearer '.length);
    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
    } catch {
      throw new AppError(401, 'Invalid or expired token');
    }
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { role: true },
    });
    if (!user || !user.isActive) {
      throw new AppError(401, 'User not found or inactive');
    }
    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      roleId: user.roleId,
      roleName: user.role.name,
      companyId: user.companyId,
    };
    req.user = authUser;
    next();
  } catch (err) {
    next(err);
  }
}
