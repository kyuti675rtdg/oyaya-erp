-- Rocket.Chat integration tables

CREATE TABLE "ChatConfig" (
    "id" TEXT NOT NULL,
    "serverUrl" TEXT NOT NULL,
    "adminUsername" TEXT NOT NULL,
    "adminUserId" TEXT,
    "adminToken" TEXT,
    "adminTokenExp" TIMESTAMP(3),
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChatConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatUserMap" (
    "id" TEXT NOT NULL,
    "erpUserId" TEXT NOT NULL,
    "rcUserId" TEXT NOT NULL,
    "rcUsername" TEXT NOT NULL,
    "lastSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatUserMap_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChatUserMap_erpUserId_key" ON "ChatUserMap"("erpUserId");
CREATE UNIQUE INDEX "ChatUserMap_rcUserId_key" ON "ChatUserMap"("rcUserId");
CREATE UNIQUE INDEX "ChatUserMap_rcUsername_key" ON "ChatUserMap"("rcUsername");
CREATE INDEX "ChatUserMap_rcUsername_idx" ON "ChatUserMap"("rcUsername");

CREATE TABLE "ChatChannelMap" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT,
    "rcRoomId" TEXT NOT NULL,
    "rcRoomName" TEXT NOT NULL,
    "roomType" TEXT NOT NULL DEFAULT 'private',
    "purpose" TEXT NOT NULL DEFAULT 'department',
    "lastSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatChannelMap_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChatChannelMap_departmentId_key" ON "ChatChannelMap"("departmentId");
CREATE UNIQUE INDEX "ChatChannelMap_rcRoomId_key" ON "ChatChannelMap"("rcRoomId");
CREATE INDEX "ChatChannelMap_purpose_idx" ON "ChatChannelMap"("purpose");

CREATE TABLE "ChatAnnouncement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "rcMessageId" TEXT,
    "publishedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatAnnouncement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChatAnnouncement_createdAt_idx" ON "ChatAnnouncement"("createdAt");

-- Foreign keys
ALTER TABLE "ChatUserMap" ADD CONSTRAINT "ChatUserMap_erpUserId_fkey" FOREIGN KEY ("erpUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatChannelMap" ADD CONSTRAINT "ChatChannelMap_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChatAnnouncement" ADD CONSTRAINT "ChatAnnouncement_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
