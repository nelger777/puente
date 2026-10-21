-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "actingBusinessId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_actingBusinessId_fkey" FOREIGN KEY ("actingBusinessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;
