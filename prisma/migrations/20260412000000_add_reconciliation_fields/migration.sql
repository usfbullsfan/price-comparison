-- AlterEnum
ALTER TYPE "ReceiptSource" ADD VALUE 'RECONCILED';

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN "reconciledFromId" TEXT,
ADD COLUMN "parseMethod" TEXT;
