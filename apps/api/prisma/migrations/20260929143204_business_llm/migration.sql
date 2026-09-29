-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "llmApiKeyLast4" TEXT,
ADD COLUMN     "llmApiKeySealed" TEXT,
ADD COLUMN     "llmProvider" TEXT NOT NULL DEFAULT 'default';
