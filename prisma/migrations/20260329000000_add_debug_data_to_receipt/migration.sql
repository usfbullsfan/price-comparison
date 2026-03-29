-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN "debugData" JSONB,
ADD COLUMN "debugExpiresAt" TIMESTAMP(3);
