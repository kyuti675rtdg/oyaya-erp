// ZKTeco attendance read API — mounted at /api/v1/attendance (authenticated).
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middleware/rbac';
import { validateQuery } from '../../middleware/validate';
import { prisma } from '../../lib/prisma';

export const router = Router();

const punchesQuerySchema = z.object({
  zkPin: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

router.get(
  '/punches',
  requirePermission('attendance:view'),
  validateQuery(punchesQuerySchema),
  async (req, res, next) => {
    try {
      const q = req.query as z.infer<typeof punchesQuerySchema>;
      const punches = await prisma.attendancePunch.findMany({
        where: {
          ...(q.zkPin ? { zkPin: q.zkPin } : {}),
          ...(q.from || q.to
            ? {
                punchTime: {
                  ...(q.from ? { gte: q.from } : {}),
                  ...(q.to ? { lte: q.to } : {}),
                },
              }
            : {}),
        },
        orderBy: { punchTime: 'desc' },
        take: 200,
      });
      res.json(punches);
    } catch (err) {
      next(err);
    }
  },
);

const dailyQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
});

router.get(
  '/daily',
  requirePermission('attendance:view'),
  validateQuery(dailyQuerySchema),
  async (req, res, next) => {
    try {
      const q = req.query as z.infer<typeof dailyQuerySchema>;
      const dayStart = new Date(`${q.date}T00:00:00`);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const punches = await prisma.attendancePunch.findMany({
        where: { punchTime: { gte: dayStart, lt: dayEnd } },
        orderBy: { punchTime: 'asc' },
      });

      const pins = [...new Set(punches.map((p) => p.zkPin))];
      const employees = await prisma.employee.findMany({ where: { zkPin: { in: pins } } });
      const nameByPin = new Map(employees.map((e) => [e.zkPin as string, e.name]));

      const byPin = new Map<string, typeof punches>();
      for (const p of punches) {
        const arr = byPin.get(p.zkPin) ?? [];
        arr.push(p);
        byPin.set(p.zkPin, arr);
      }

      const result = [...byPin.entries()].map(([zkPin, list]) => {
        const ins = list.filter((p) => p.status === 'CHECK_IN');
        const outs = list.filter((p) => p.status === 'CHECK_OUT');
        const checkIn = ins.length > 0 ? ins[0].punchTime.toISOString() : null;
        const checkOut = outs.length > 0 ? outs[outs.length - 1].punchTime.toISOString() : null;
        let hours = 0;
        if (checkIn && checkOut) {
          const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
          hours = Math.round((ms / 3600000) * 100) / 100;
        }
        return {
          zkPin,
          employeeName: nameByPin.get(zkPin) ?? zkPin,
          checkIn,
          checkOut,
          hours,
        };
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);
