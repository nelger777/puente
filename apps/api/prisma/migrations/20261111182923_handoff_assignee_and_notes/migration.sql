-- AlterTable
ALTER TABLE "Handoff" ADD COLUMN     "assignedToId" TEXT;

-- CreateTable
CREATE TABLE "HandoffNote" (
    "id" TEXT NOT NULL,
    "handoffId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandoffNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HandoffNote_handoffId_createdAt_idx" ON "HandoffNote"("handoffId", "createdAt");

-- AddForeignKey
ALTER TABLE "Handoff" ADD CONSTRAINT "Handoff_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoffNote" ADD CONSTRAINT "HandoffNote_handoffId_fkey" FOREIGN KEY ("handoffId") REFERENCES "Handoff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoffNote" ADD CONSTRAINT "HandoffNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
