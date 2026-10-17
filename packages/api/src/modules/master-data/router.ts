import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { Prisma, SupplierType, StorageKind, PayrollMode } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { validateBody, validateQuery, validateParams } from '../../middleware/validate';
import { requirePermission } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';

export const router = Router();

type AsyncFn = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function ah(fn: AsyncFn) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

function requireUid(req: Request): string {
  const id = req.user?.id;
  if (!id) throw new AppError(401, 'Unauthenticated');
  return id;
}

const view = requirePermission('master:view');
const manage = requirePermission('master:manage');

const idParam = z.object({ id: z.string().min(1) });
const LIST_TAKE = 500;

// ─── Companies ──────────────────────────────────────────────────

const companySchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  taxId: z.string().optional(),
  logoUrl: z.string().url().optional(),
});
const updateCompanySchema = companySchema.partial();

router.get('/companies', view, ah(async (_req, res) => {
  res.json(await prisma.company.findMany({ orderBy: { name: 'asc' }, take: LIST_TAKE }));
}));

router.post(
  '/companies',
  manage,
  validateBody(companySchema),
  ah(async (req, res) => {
    const body = companySchema.parse(req.body);
    const uid = requireUid(req);
    const company = await prisma.$transaction(async (tx) => {
      const created = await tx.company.create({ data: body });
      await audit(tx, { userId: uid, action: 'CREATE', entityType: 'Company', entityId: created.id });
      return created;
    });
    res.status(201).json(company);
  }),
);

router.get(
  '/companies/:id',
  view,
  validateParams(idParam),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const company = await prisma.company.findUnique({ where: { id } });
    if (!company) throw new AppError(404, 'Company not found');
    res.json(company);
  }),
);

router.put(
  '/companies/:id',
  manage,
  validateParams(idParam),
  validateBody(updateCompanySchema),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = updateCompanySchema.parse(req.body);
    const uid = requireUid(req);
    const company = await prisma.$transaction(async (tx) => {
      const updated = await tx.company.update({ where: { id }, data: body });
      await audit(tx, { userId: uid, action: 'UPDATE', entityType: 'Company', entityId: id, changes: body });
      return updated;
    });
    res.json(company);
  }),
);

// ─── Users ──────────────────────────────────────────────────────

const userSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(6),
  phone: z.string().optional(),
  roleId: z.string().min(1),
  companyId: z.string().min(1),
  isActive: z.boolean().optional(),
});
const updateUserSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().min(1).optional(),
  password: z.string().min(6).optional(),
  phone: z.string().optional().nullable(),
  roleId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

router.get('/users', view, ah(async (_req, res) => {
  res.json(
    await prisma.user.findMany({
      include: { role: true },
      orderBy: { name: 'asc' },
      take: LIST_TAKE,
    }),
  );
}));

router.post(
  '/users',
  manage,
  validateBody(userSchema),
  ah(async (req, res) => {
    const body = userSchema.parse(req.body);
    const uid = requireUid(req);
    const user = await prisma.$transaction(async (tx) => {
      const role = await tx.role.findUnique({ where: { id: body.roleId } });
      if (!role) throw new AppError(404, 'Role not found');
      const company = await tx.company.findUnique({ where: { id: body.companyId } });
      if (!company) throw new AppError(404, 'Company not found');
      const created = await tx.user.create({
        data: {
          email: body.email,
          name: body.name,
          passwordHash: bcrypt.hashSync(body.password, 10),
          phone: body.phone,
          roleId: body.roleId,
          companyId: body.companyId,
          isActive: body.isActive ?? true,
        },
        include: { role: true },
      });
      await audit(tx, { userId: uid, action: 'CREATE', entityType: 'User', entityId: created.id });
      return created;
    });
    res.status(201).json(user);
  }),
);

router.put(
  '/users/:id',
  manage,
  validateParams(idParam),
  validateBody(updateUserSchema),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = updateUserSchema.parse(req.body);
    const uid = requireUid(req);
    const user = await prisma.$transaction(async (tx) => {
      if (body.roleId) {
        const role = await tx.role.findUnique({ where: { id: body.roleId } });
        if (!role) throw new AppError(404, 'Role not found');
      }
      if (body.companyId) {
        const company = await tx.company.findUnique({ where: { id: body.companyId } });
        if (!company) throw new AppError(404, 'Company not found');
      }
      const updated = await tx.user.update({
        where: { id },
        data: {
          email: body.email,
          name: body.name,
          ...(body.password ? { passwordHash: bcrypt.hashSync(body.password, 10) } : {}),
          phone: body.phone,
          roleId: body.roleId,
          companyId: body.companyId,
          isActive: body.isActive,
        },
        include: { role: true },
      });
      await audit(tx, {
        userId: uid,
        action: 'UPDATE',
        entityType: 'User',
        entityId: id,
        changes: { ...body, password: body.password ? '***' : undefined },
      });
      return updated;
    });
    res.json(user);
  }),
);

// Soft deactivate only — users are never hard deleted.
router.delete(
  '/users/:id',
  manage,
  validateParams(idParam),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const uid = requireUid(req);
    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id }, data: { isActive: false }, include: { role: true } });
      await audit(tx, { userId: uid, action: 'DELETE', entityType: 'User', entityId: id, changes: { isActive: false } });
      return updated;
    });
    res.json(user);
  }),
);

// ─── Roles ──────────────────────────────────────────────────────

const roleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});
const updateRoleSchema = roleSchema.partial();
const rolePermissionsSchema = z.object({
  permissionIds: z.array(z.string().min(1)),
});

router.get('/roles', view, ah(async (_req, res) => {
  res.json(await prisma.role.findMany({ orderBy: { name: 'asc' }, take: LIST_TAKE }));
}));

router.post(
  '/roles',
  manage,
  validateBody(roleSchema),
  ah(async (req, res) => {
    const body = roleSchema.parse(req.body);
    const uid = requireUid(req);
    const role = await prisma.$transaction(async (tx) => {
      const created = await tx.role.create({ data: body });
      await audit(tx, { userId: uid, action: 'CREATE', entityType: 'Role', entityId: created.id });
      return created;
    });
    res.status(201).json(role);
  }),
);

router.put(
  '/roles/:id',
  manage,
  validateParams(idParam),
  validateBody(updateRoleSchema),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = updateRoleSchema.parse(req.body);
    const uid = requireUid(req);
    const role = await prisma.$transaction(async (tx) => {
      const updated = await tx.role.update({ where: { id }, data: body });
      await audit(tx, { userId: uid, action: 'UPDATE', entityType: 'Role', entityId: id, changes: body });
      return updated;
    });
    res.json(role);
  }),
);

router.get(
  '/roles/:id/permissions',
  view,
  validateParams(idParam),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const role = await prisma.role.findUnique({
      where: { id },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) throw new AppError(404, 'Role not found');
    res.json(role.permissions.map((rp) => rp.permission));
  }),
);

router.post(
  '/roles/:id/permissions',
  manage,
  validateParams(idParam),
  validateBody(rolePermissionsSchema),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = rolePermissionsSchema.parse(req.body);
    const uid = requireUid(req);
    const role = await prisma.role.findUnique({ where: { id } });
    if (!role) throw new AppError(404, 'Role not found');
    if (body.permissionIds.length > 0) {
      const found = await prisma.permission.count({ where: { id: { in: body.permissionIds } } });
      if (found !== body.permissionIds.length) throw new AppError(400, 'One or more permissionIds are invalid');
    }
    await prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      if (body.permissionIds.length > 0) {
        await tx.rolePermission.createMany({
          data: body.permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
        });
      }
      await audit(tx, {
        userId: uid,
        action: 'UPDATE',
        entityType: 'RolePermission',
        entityId: id,
        changes: { permissionIds: body.permissionIds },
      });
    });
    res.json({ roleId: id, permissionIds: body.permissionIds });
  }),
);

// ─── Permissions ────────────────────────────────────────────────

router.get('/permissions', view, ah(async (_req, res) => {
  res.json(
    await prisma.permission.findMany({
      orderBy: [{ module: 'asc' }, { action: 'asc' }],
      take: LIST_TAKE,
    }),
  );
}));

// ─── Suppliers ──────────────────────────────────────────────────

const supplierSchema = z.object({
  name: z.string().min(1),
  type: z.nativeEnum(SupplierType),
  contactPerson: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().optional(),
  region: z.string().optional(),
  tin: z.string().optional(),
  licenseNo: z.string().optional(),
  wheatTypes: z.array(z.string()).optional(),
  paymentTerms: z.string().optional(),
  bankName: z.string().optional(),
  bankAccountNo: z.string().optional(),
  rating: z.number().int().min(1).max(5).optional(),
});
const updateSupplierSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.nativeEnum(SupplierType).optional(),
  contactPerson: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  address: z.string().optional().nullable(),
  region: z.string().optional().nullable(),
  tin: z.string().optional().nullable(),
  licenseNo: z.string().optional().nullable(),
  wheatTypes: z.array(z.string()).optional(),
  paymentTerms: z.string().optional().nullable(),
  bankName: z.string().optional().nullable(),
  bankAccountNo: z.string().optional().nullable(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  isActive: z.boolean().optional(),
});

router.get('/suppliers', view, ah(async (_req, res) => {
  res.json(
    await prisma.supplier.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { intakes: true, purchaseOrders: true } } },
      take: LIST_TAKE,
    }),
  );
}));

router.post(
  '/suppliers',
  manage,
  validateBody(supplierSchema),
  ah(async (req, res) => {
    const body = supplierSchema.parse(req.body);
    const uid = requireUid(req);
    const supplier = await prisma.$transaction(async (tx) => {
      const created = await tx.supplier.create({ data: body });
      await audit(tx, { userId: uid, action: 'CREATE', entityType: 'Supplier', entityId: created.id });
      return created;
    });
    res.status(201).json(supplier);
  }),
);

router.get(
  '/suppliers/:id',
  view,
  validateParams(idParam),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const supplier = await prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw new AppError(404, 'Supplier not found');
    res.json(supplier);
  }),
);

router.put(
  '/suppliers/:id',
  manage,
  validateParams(idParam),
  validateBody(updateSupplierSchema),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = updateSupplierSchema.parse(req.body);
    const uid = requireUid(req);
    const supplier = await prisma.$transaction(async (tx) => {
      const updated = await tx.supplier.update({ where: { id }, data: body });
      await audit(tx, { userId: uid, action: 'UPDATE', entityType: 'Supplier', entityId: id, changes: body });
      return updated;
    });
    res.json(supplier);
  }),
);

// Soft deactivate only.
router.delete(
  '/suppliers/:id',
  manage,
  validateParams(idParam),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const uid = requireUid(req);
    const supplier = await prisma.$transaction(async (tx) => {
      const updated = await tx.supplier.update({ where: { id }, data: { isActive: false } });
      await audit(tx, { userId: uid, action: 'DELETE', entityType: 'Supplier', entityId: id, changes: { isActive: false } });
      return updated;
    });
    res.json(supplier);
  }),
);

// ─── Customers ──────────────────────────────────────────────────

const customerSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  address: z.string().optional(),
});
const updateCustomerSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});
const customerPriceSchema = z.object({
  productId: z.string().min(1),
  priceBirr: z.number().positive(),
});

router.get('/customers', view, ah(async (_req, res) => {
  res.json(await prisma.customer.findMany({ orderBy: { name: 'asc' }, take: LIST_TAKE }));
}));

router.post(
  '/customers',
  manage,
  validateBody(customerSchema),
  ah(async (req, res) => {
    const body = customerSchema.parse(req.body);
    const uid = requireUid(req);
    const customer = await prisma.$transaction(async (tx) => {
      const created = await tx.customer.create({ data: body });
      await audit(tx, { userId: uid, action: 'CREATE', entityType: 'Customer', entityId: created.id });
      return created;
    });
    res.status(201).json(customer);
  }),
);

router.get(
  '/customers/:id',
  view,
  validateParams(idParam),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new AppError(404, 'Customer not found');
    res.json(customer);
  }),
);

router.put(
  '/customers/:id',
  manage,
  validateParams(idParam),
  validateBody(updateCustomerSchema),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = updateCustomerSchema.parse(req.body);
    const uid = requireUid(req);
    const customer = await prisma.$transaction(async (tx) => {
      const updated = await tx.customer.update({ where: { id }, data: body });
      await audit(tx, { userId: uid, action: 'UPDATE', entityType: 'Customer', entityId: id, changes: body });
      return updated;
    });
    res.json(customer);
  }),
);

router.get(
  '/customers/:id/prices',
  view,
  validateParams(idParam),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new AppError(404, 'Customer not found');
    res.json(
      await prisma.customerPrice.findMany({
        where: { customerId: id },
        include: { product: true },
        orderBy: { product: { name: 'asc' } },
      }),
    );
  }),
);

router.post(
  '/customers/:id/prices',
  manage,
  validateParams(idParam),
  validateBody(customerPriceSchema),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = customerPriceSchema.parse(req.body);
    const uid = requireUid(req);
    const price = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id } });
      if (!customer) throw new AppError(404, 'Customer not found');
      const product = await tx.product.findUnique({ where: { id: body.productId } });
      if (!product) throw new AppError(404, 'Product not found');
      const saved = await tx.customerPrice.upsert({
        where: { customerId_productId: { customerId: id, productId: body.productId } },
        update: { priceBirr: new Prisma.Decimal(body.priceBirr) },
        create: {
          customerId: id,
          productId: body.productId,
          priceBirr: new Prisma.Decimal(body.priceBirr),
        },
        include: { product: true },
      });
      await audit(tx, {
        userId: uid,
        action: 'UPDATE',
        entityType: 'CustomerPrice',
        entityId: saved.id,
        changes: { customerId: id, productId: body.productId, priceBirr: body.priceBirr },
      });
      return saved;
    });
    res.status(201).json(price);
  }),
);

const customerPriceParam = z.object({ id: z.string().min(1), productId: z.string().min(1) });

router.delete(
  '/customers/:id/prices/:productId',
  manage,
  validateParams(customerPriceParam),
  ah(async (req, res) => {
    const { id, productId } = customerPriceParam.parse(req.params);
    const uid = requireUid(req);
    await prisma.$transaction(async (tx) => {
      const existing = await tx.customerPrice.findUnique({
        where: { customerId_productId: { customerId: id, productId } },
      });
      if (!existing) throw new AppError(404, 'Customer price not found');
      await tx.customerPrice.delete({
        where: { customerId_productId: { customerId: id, productId } },
      });
      await audit(tx, {
        userId: uid,
        action: 'DELETE',
        entityType: 'CustomerPrice',
        entityId: existing.id,
        changes: { customerId: id, productId },
      });
    });
    res.json({ deleted: true });
  }),
);

// ─── Products ───────────────────────────────────────────────────

const productSchema = z.object({
  name: z.string().min(1),
  kind: z.string().min(1),
  uom: z.string().optional(),
});
const updateProductSchema = z.object({
  name: z.string().min(1).optional(),
  kind: z.string().min(1).optional(),
  uom: z.string().optional(),
  isActive: z.boolean().optional(),
});

router.get('/products', view, ah(async (_req, res) => {
  res.json(await prisma.product.findMany({ orderBy: { name: 'asc' }, take: LIST_TAKE }));
}));

router.post(
  '/products',
  manage,
  validateBody(productSchema),
  ah(async (req, res) => {
    const body = productSchema.parse(req.body);
    const uid = requireUid(req);
    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({ data: body });
      await audit(tx, { userId: uid, action: 'CREATE', entityType: 'Product', entityId: created.id });
      return created;
    });
    res.status(201).json(product);
  }),
);

router.put(
  '/products/:id',
  manage,
  validateParams(idParam),
  validateBody(updateProductSchema),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = updateProductSchema.parse(req.body);
    const uid = requireUid(req);
    const product = await prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({ where: { id }, data: body });
      await audit(tx, { userId: uid, action: 'UPDATE', entityType: 'Product', entityId: id, changes: body });
      return updated;
    });
    res.json(product);
  }),
);

// ─── Packaging sizes ────────────────────────────────────────────

const packagingSizeSchema = z.object({
  label: z.string().min(1),
  kg: z.number().positive(),
});
const updatePackagingSizeSchema = z.object({
  label: z.string().min(1).optional(),
  kg: z.number().positive().optional(),
  isActive: z.boolean().optional(),
});

router.get('/packaging-sizes', view, ah(async (_req, res) => {
  res.json(await prisma.packagingSize.findMany({ orderBy: { kg: 'asc' }, take: LIST_TAKE }));
}));

router.post(
  '/packaging-sizes',
  manage,
  validateBody(packagingSizeSchema),
  ah(async (req, res) => {
    const body = packagingSizeSchema.parse(req.body);
    const uid = requireUid(req);
    const size = await prisma.$transaction(async (tx) => {
      const created = await tx.packagingSize.create({
        data: { label: body.label, kg: new Prisma.Decimal(body.kg) },
      });
      await audit(tx, { userId: uid, action: 'CREATE', entityType: 'PackagingSize', entityId: created.id });
      return created;
    });
    res.status(201).json(size);
  }),
);

router.put(
  '/packaging-sizes/:id',
  manage,
  validateParams(idParam),
  validateBody(updatePackagingSizeSchema),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = updatePackagingSizeSchema.parse(req.body);
    const uid = requireUid(req);
    const size = await prisma.$transaction(async (tx) => {
      const updated = await tx.packagingSize.update({
        where: { id },
        data: {
          label: body.label,
          kg: body.kg === undefined ? undefined : new Prisma.Decimal(body.kg),
          isActive: body.isActive,
        },
      });
      await audit(tx, { userId: uid, action: 'UPDATE', entityType: 'PackagingSize', entityId: id, changes: body });
      return updated;
    });
    res.json(size);
  }),
);

// ─── Storage locations ──────────────────────────────────────────

const storageLocationSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  kind: z.nativeEnum(StorageKind),
  capacityQ: z.number().positive(),
});
const updateStorageLocationSchema = z.object({
  name: z.string().min(1).optional(),
  capacityQ: z.number().positive().optional(),
  isActive: z.boolean().optional(),
});

router.get('/storage-locations', view, ah(async (_req, res) => {
  res.json(await prisma.storageLocation.findMany({ orderBy: { code: 'asc' }, take: LIST_TAKE }));
}));

router.post(
  '/storage-locations',
  manage,
  validateBody(storageLocationSchema),
  ah(async (req, res) => {
    const body = storageLocationSchema.parse(req.body);
    const uid = requireUid(req);
    const location = await prisma.$transaction(async (tx) => {
      const created = await tx.storageLocation.create({
        data: {
          code: body.code,
          name: body.name,
          kind: body.kind,
          capacityQ: new Prisma.Decimal(body.capacityQ),
        },
      });
      await audit(tx, { userId: uid, action: 'CREATE', entityType: 'StorageLocation', entityId: created.id });
      return created;
    });
    res.status(201).json(location);
  }),
);

// Code and kind are immutable — capacity (and name/active flag) are editable.
router.put(
  '/storage-locations/:id',
  manage,
  validateParams(idParam),
  validateBody(updateStorageLocationSchema),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = updateStorageLocationSchema.parse(req.body);
    const uid = requireUid(req);
    const location = await prisma.$transaction(async (tx) => {
      const updated = await tx.storageLocation.update({
        where: { id },
        data: {
          name: body.name,
          capacityQ: body.capacityQ === undefined ? undefined : new Prisma.Decimal(body.capacityQ),
          isActive: body.isActive,
        },
      });
      await audit(tx, { userId: uid, action: 'UPDATE', entityType: 'StorageLocation', entityId: id, changes: body });
      return updated;
    });
    res.json(location);
  }),
);

// ─── Employees ──────────────────────────────────────────────────

const employeeSchema = z.object({
  employeeNo: z.string().min(1).optional(),
  name: z.string().min(1),
  phone: z.string().optional(),
  jobTitle: z.string().min(1),
  department: z.string().optional(),
  payrollMode: z.nativeEnum(PayrollMode).optional(),
  baseSalary: z.number().nonnegative().optional(),
  zkPin: z.string().optional(),
  userId: z.string().min(1).optional(),
});
const updateEmployeeSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional().nullable(),
  jobTitle: z.string().min(1).optional(),
  department: z.string().optional().nullable(),
  payrollMode: z.nativeEnum(PayrollMode).optional(),
  baseSalary: z.number().nonnegative().optional().nullable(),
  zkPin: z.string().optional().nullable(),
  userId: z.string().min(1).optional().nullable(),
  isActive: z.boolean().optional(),
});
const employeeQuerySchema = z.object({
  isActive: z.enum(['true', 'false']).optional(),
});

router.get(
  '/employees',
  view,
  validateQuery(employeeQuerySchema),
  ah(async (req, res) => {
    const q = employeeQuerySchema.parse(req.query);
    res.json(
      await prisma.employee.findMany({
        where: q.isActive === undefined ? undefined : { isActive: q.isActive === 'true' },
        orderBy: { name: 'asc' },
        take: LIST_TAKE,
      }),
    );
  }),
);

router.post(
  '/employees',
  manage,
  validateBody(employeeSchema),
  ah(async (req, res) => {
    const body = employeeSchema.parse(req.body);
    const uid = requireUid(req);
    const employee = await prisma.$transaction(async (tx) => {
      if (body.userId) {
        const user = await tx.user.findUnique({ where: { id: body.userId } });
        if (!user) throw new AppError(404, 'User not found');
      }
      let employeeNo = body.employeeNo;
      if (!employeeNo) {
        const count = await tx.employee.count();
        employeeNo = `EMP-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;
      }
      const created = await tx.employee.create({
        data: {
          employeeNo,
          name: body.name,
          phone: body.phone,
          jobTitle: body.jobTitle,
          department: body.department,
          payrollMode: body.payrollMode ?? PayrollMode.FIXED,
          baseSalary: body.baseSalary == null ? undefined : new Prisma.Decimal(body.baseSalary),
          zkPin: body.zkPin,
          userId: body.userId,
        },
      });
      await audit(tx, { userId: uid, action: 'CREATE', entityType: 'Employee', entityId: created.id });
      return created;
    });
    res.status(201).json(employee);
  }),
);

router.put(
  '/employees/:id',
  manage,
  validateParams(idParam),
  validateBody(updateEmployeeSchema),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = updateEmployeeSchema.parse(req.body);
    const uid = requireUid(req);
    const employee = await prisma.$transaction(async (tx) => {
      if (body.userId) {
        const user = await tx.user.findUnique({ where: { id: body.userId } });
        if (!user) throw new AppError(404, 'User not found');
      }
      const updated = await tx.employee.update({
        where: { id },
        data: {
          name: body.name,
          phone: body.phone,
          jobTitle: body.jobTitle,
          department: body.department,
          payrollMode: body.payrollMode,
          baseSalary: body.baseSalary == null ? undefined : new Prisma.Decimal(body.baseSalary),
          zkPin: body.zkPin,
          userId: body.userId,
          isActive: body.isActive,
        },
      });
      await audit(tx, { userId: uid, action: 'UPDATE', entityType: 'Employee', entityId: id, changes: body });
      return updated;
    });
    res.json(employee);
  }),
);

// Soft deactivate only.
router.delete(
  '/employees/:id',
  manage,
  validateParams(idParam),
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const uid = requireUid(req);
    const employee = await prisma.$transaction(async (tx) => {
      const updated = await tx.employee.update({ where: { id }, data: { isActive: false } });
      await audit(tx, { userId: uid, action: 'DELETE', entityType: 'Employee', entityId: id, changes: { isActive: false } });
      return updated;
    });
    res.json(employee);
  }),
);
