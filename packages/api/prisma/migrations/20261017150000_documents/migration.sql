-- Document Management (Module 20)

CREATE TABLE IF NOT EXISTS "DocFolder" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "parentId" TEXT,
  "module" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DocFolder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DocFolder_parentId_idx" ON "DocFolder"("parentId");
CREATE INDEX IF NOT EXISTS "DocFolder_module_idx" ON "DocFolder"("module");
DO $$ BEGIN
  ALTER TABLE "DocFolder" ADD CONSTRAINT "DocFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "DocFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "Document" (
  "id" TEXT NOT NULL,
  "docNo" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT NOT NULL DEFAULT 'General',
  "tags" TEXT[] NOT NULL DEFAULT '{}',
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL DEFAULT 'application/octet-stream',
  "fileSize" INTEGER NOT NULL DEFAULT 0,
  "storagePath" TEXT,
  "folderId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "version" TEXT NOT NULL DEFAULT '1.0',
  "checkedOutById" TEXT,
  "retentionUntil" DATE,
  "uploadedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Document_docNo_key" ON "Document"("docNo");
CREATE INDEX IF NOT EXISTS "Document_status_idx" ON "Document"("status");
CREATE INDEX IF NOT EXISTS "Document_category_idx" ON "Document"("category");
CREATE INDEX IF NOT EXISTS "Document_folderId_idx" ON "Document"("folderId");
CREATE INDEX IF NOT EXISTS "Document_uploadedById_idx" ON "Document"("uploadedById");
DO $$ BEGIN
  ALTER TABLE "Document" ADD CONSTRAINT "Document_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "DocFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "DocVersion" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL DEFAULT 0,
  "storagePath" TEXT,
  "changeNote" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocVersion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DocVersion_documentId_createdAt_idx" ON "DocVersion"("documentId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "DocVersion" ADD CONSTRAINT "DocVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "DocApproval" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "approverId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "comment" TEXT,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocApproval_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DocApproval_documentId_status_idx" ON "DocApproval"("documentId", "status");
CREATE INDEX IF NOT EXISTS "DocApproval_approverId_idx" ON "DocApproval"("approverId");
DO $$ BEGIN
  ALTER TABLE "DocApproval" ADD CONSTRAINT "DocApproval_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "DocTemplate" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'General',
  "description" TEXT,
  "content" TEXT NOT NULL DEFAULT '',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DocTemplate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DocTemplate_category_idx" ON "DocTemplate"("category");

CREATE TABLE IF NOT EXISTS "DocShare" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "sharedWithId" TEXT,
  "role" TEXT,
  "permission" TEXT NOT NULL DEFAULT 'VIEW',
  "token" TEXT,
  "expiresAt" TIMESTAMP(3),
  "accessCount" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocShare_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DocShare_token_key" ON "DocShare"("token");
CREATE INDEX IF NOT EXISTS "DocShare_documentId_idx" ON "DocShare"("documentId");
CREATE INDEX IF NOT EXISTS "DocShare_token_idx" ON "DocShare"("token");
DO $$ BEGIN
  ALTER TABLE "DocShare" ADD CONSTRAINT "DocShare_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
