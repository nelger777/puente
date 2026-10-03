-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "monthlyConversationQuota" INTEGER;

-- CreateTable
CREATE TABLE "UsageMonth" (
    "businessId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "conversations" INTEGER NOT NULL DEFAULT 0,
    "alert80SentAt" TIMESTAMP(3),
    "alert100SentAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageMonth_pkey" PRIMARY KEY ("businessId","month")
);

-- AddForeignKey
ALTER TABLE "UsageMonth" ADD CONSTRAINT "UsageMonth_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill from the conversations still in the database (older ones were removed by retention).
-- Same rule as the live counter: real conversations with at least one customer message, by the
-- month they started in the business timezone ("startedAt" is stored as UTC).
INSERT INTO "UsageMonth" ("businessId", "month", "conversations", "updatedAt")
SELECT c."businessId",
       to_char((c."startedAt" AT TIME ZONE 'UTC') AT TIME ZONE b."timezone", 'YYYY-MM'),
       count(*)::int,
       CURRENT_TIMESTAMP
FROM "Conversation" c
JOIN "Business" b ON b."id" = c."businessId"
WHERE NOT c."isPreview" AND c."userMessageCount" > 0
GROUP BY 1, 2;
