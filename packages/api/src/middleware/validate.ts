import type { NextFunction, Request, Response } from 'express';
import type { ZodSchema } from 'zod';
import { AppError } from './errorHandler';

function formatIssues(schema: ZodSchema, data: unknown): string | null {
  const result = schema.safeParse(data);
  if (result.success) return null;
  return result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
}

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const issues = formatIssues(schema, req.body);
    if (issues) {
      next(new AppError(400, issues));
      return;
    }
    req.body = schema.parse(req.body) as unknown;
    next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const issues = formatIssues(schema, req.query);
    if (issues) {
      next(new AppError(400, issues));
      return;
    }
    req.query = schema.parse(req.query) as unknown as Request['query'];
    next();
  };
}

export function validateParams<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const issues = formatIssues(schema, req.params);
    if (issues) {
      next(new AppError(400, issues));
      return;
    }
    req.params = schema.parse(req.params) as unknown as Request['params'];
    next();
  };
}
