-- AlterTable
ALTER TABLE "KnowledgeItem" ADD COLUMN     "category" TEXT;

-- CreateTable
CREATE TABLE "KnowledgeVersion" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "replacedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeVersion_businessId_createdAt_idx" ON "KnowledgeVersion"("businessId", "createdAt");

-- AddForeignKey
ALTER TABLE "KnowledgeVersion" ADD CONSTRAINT "KnowledgeVersion_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
