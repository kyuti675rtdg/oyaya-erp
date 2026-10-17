-- Module 19: Support & Documentation Center

CREATE TABLE IF NOT EXISTS "SopDocument" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "docNo" TEXT NOT NULL UNIQUE,
  "docType" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "module" TEXT,
  "version" TEXT NOT NULL DEFAULT '1.0',
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "effectiveDate" DATE,
  "reviewDate" DATE,
  "summary" TEXT,
  "content" TEXT NOT NULL,
  "approverId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "supersedesId" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "SopDocument_docType_status_idx" ON "SopDocument"("docType", "status");
CREATE INDEX IF NOT EXISTS "SopDocument_module_idx" ON "SopDocument"("module");

CREATE TABLE IF NOT EXISTS "KbArticle" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "tags" TEXT[] NOT NULL DEFAULT '{}',
  "content" TEXT NOT NULL,
  "faq" BOOLEAN NOT NULL DEFAULT false,
  "pinned" BOOLEAN NOT NULL DEFAULT false,
  "views" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "KbArticle_category_idx" ON "KbArticle"("category");

CREATE TABLE IF NOT EXISTS "Announcement" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "targetRoles" TEXT[] NOT NULL DEFAULT '{}',
  "urgent" BOOLEAN NOT NULL DEFAULT false,
  "publishedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "authorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "Announcement_publishedAt_idx" ON "Announcement"("publishedAt");

CREATE TABLE IF NOT EXISTS "AnnouncementRead" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "announcementId" TEXT NOT NULL REFERENCES "Announcement"("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL,
  "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("announcementId", "userId")
);
CREATE INDEX IF NOT EXISTS "AnnouncementRead_userId_idx" ON "AnnouncementRead"("userId");

CREATE TABLE IF NOT EXISTS "TechSupportRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "recordNo" TEXT NOT NULL UNIQUE,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "resolution" TEXT,
  "durationMins" INTEGER,
  "technicianId" TEXT NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "TechSupportRecord_category_idx" ON "TechSupportRecord"("category");

CREATE TABLE IF NOT EXISTS "AppNotification" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "type" TEXT NOT NULL DEFAULT 'info',
  "link" TEXT,
  "read" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "AppNotification_userId_read_idx" ON "AppNotification"("userId", "read");
CREATE INDEX IF NOT EXISTS "AppNotification_createdAt_idx" ON "AppNotification"("createdAt");
