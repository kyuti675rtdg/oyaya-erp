import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AppError } from './errorHandler';
import type { PermissionCode } from '../lib/permissions';

/**
 * Require a "module:action" claim on the caller's role.
 * Matches stored codes "module:action:scope" by prefix.
 */
export function requirePermission(code: PermissionCode) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user;
      if (!user) throw new AppError(401, 'Unauthenticated');
      const grants = await prisma.rolePermission.findMany({
        where: { roleId: user.roleId },
        include: { permission: true },
      });
      const ok = grants.some(
        (g) => g.permission.code === code || g.permission.code.startsWith(`${code}:`),
      );
      if (!ok) throw new AppError(403, `Forbidden: requires permission ${code}`);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Require the caller's role name to be one of the given names. */
export function requireRoles(...roleNames: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      next(new AppError(401, 'Unauthenticated'));
      return;
    }
    if (!roleNames.includes(user.roleName)) {
      next(new AppError(403, `Forbidden: requires one of roles: ${roleNames.join(' | ')}`));
      return;
    }
    next();
  };
}
