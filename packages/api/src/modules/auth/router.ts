import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { validateBody } from '../../middleware/validate';
import { authenticate } from '../../middleware/auth';
import { AppError } from '../../middleware/errorHandler';
import { login, getMe } from './service';

export const router = Router();

type AsyncFn = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function ah(fn: AsyncFn) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Public — /auth is mounted outside the global authenticate gate.
router.post(
  '/login',
  validateBody(loginSchema),
  ah(async (req, res) => {
    const body = loginSchema.parse(req.body);
    res.json(await login(body.email, body.password));
  }),
);

// Authenticated explicitly on this route.
router.get(
  '/me',
  authenticate,
  ah(async (req, res) => {
    const uid = req.user?.id;
    if (!uid) throw new AppError(401, 'Unauthenticated');
    res.json(await getMe(uid));
  }),
);
