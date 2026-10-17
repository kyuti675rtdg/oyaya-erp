-- Grant chat permissions to System Administrator and management roles

-- Insert chat permissions (idempotent)
INSERT INTO "Permission" ("id", "code", "module", "action", "scope")
VALUES
  (gen_random_uuid()::text, 'chat:view:all', 'chat', 'view', 'all'),
  (gen_random_uuid()::text, 'chat:manage:all', 'chat', 'manage', 'all'),
  (gen_random_uuid()::text, 'chat:approve:all', 'chat', 'approve', 'all')
ON CONFLICT ("code") DO NOTHING;

-- Grant all chat permissions to System Administrator role
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
CROSS JOIN "Permission" p
WHERE r."name" = 'System Administrator'
  AND p."code" IN ('chat:view:all', 'chat:manage:all', 'chat:approve:all')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- Grant chat:view to all active roles (everyone can chat)
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
CROSS JOIN "Permission" p
WHERE p."code" = 'chat:view:all'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
