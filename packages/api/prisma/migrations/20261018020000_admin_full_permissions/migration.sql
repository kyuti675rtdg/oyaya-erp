-- Ensure System Administrator and Owner roles have ALL permissions (full CRUD)
-- This grants every permission code to admin roles

-- Get all permission IDs and grant them to System Administrator
INSERT INTO "RolePermission" ("roleId", "permissionId", "createdAt")
SELECT r.id, p.id, NOW()
FROM "Role" r
CROSS JOIN "Permission" p
WHERE r.name IN ('System Administrator', 'Owner / CEO')
AND NOT EXISTS (
  SELECT 1 FROM "RolePermission" rp
  WHERE rp."roleId" = r.id AND rp."permissionId" = p.id
);
