-- CreateTable
CREATE TABLE "BusinessAvatar" (
    "businessId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessAvatar_pkey" PRIMARY KEY ("businessId")
);

-- AddForeignKey
ALTER TABLE "BusinessAvatar" ADD CONSTRAINT "BusinessAvatar_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
