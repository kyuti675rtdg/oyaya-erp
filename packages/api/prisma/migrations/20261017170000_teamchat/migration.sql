-- Native Team Chat tables

CREATE TABLE "ChatChannel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'department',
    "departmentId" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChatChannel_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChatChannel_type_idx" ON "ChatChannel"("type");
CREATE INDEX "ChatChannel_departmentId_idx" ON "ChatChannel"("departmentId");

CREATE TABLE "ChatChannelMember" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadAt" TIMESTAMP(3),
    CONSTRAINT "ChatChannelMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChatChannelMember_channelId_userId_key" ON "ChatChannelMember"("channelId", "userId");
CREATE INDEX "ChatChannelMember_userId_idx" ON "ChatChannelMember"("userId");

CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChatMessage_channelId_createdAt_idx" ON "ChatMessage"("channelId", "createdAt");
CREATE INDEX "ChatMessage_senderId_idx" ON "ChatMessage"("senderId");

CREATE TABLE "ChatAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "documentId" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'application/octet-stream',
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatAttachment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChatAttachment_messageId_idx" ON "ChatAttachment"("messageId");

-- Foreign keys
ALTER TABLE "ChatChannel" ADD CONSTRAINT "ChatChannel_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChatChannelMember" ADD CONSTRAINT "ChatChannelMember_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatChannelMember" ADD CONSTRAINT "ChatChannelMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatAttachment" ADD CONSTRAINT "ChatAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatAttachment" ADD CONSTRAINT "ChatAttachment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
