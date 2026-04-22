-- Notion Service Schema Migration

-- CreateEnum: NotionOpStatus
DO $$ BEGIN
    CREATE TYPE "NotionOpStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable: NotionOperation
CREATE TABLE "NotionOperation" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "metadata" JSONB,
    "status" "NotionOpStatus" NOT NULL DEFAULT 'PENDING',
    "notionId" TEXT,
    "errorReason" TEXT,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotionOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: NotionOperation.messageId
CREATE UNIQUE INDEX "NotionOperation_messageId_key" ON "NotionOperation" ("messageId");

-- CreateIndex: NotionOperation.status
CREATE INDEX "NotionOperation_status_idx" ON "NotionOperation" ("status");

-- CreateIndex: NotionOperation.createdAt
CREATE INDEX "NotionOperation_createdAt_idx" ON "NotionOperation" ("createdAt");
