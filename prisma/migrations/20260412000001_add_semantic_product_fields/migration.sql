-- AlterTable
ALTER TABLE "Product" ADD COLUMN "productType" TEXT,
ADD COLUMN "variety" TEXT,
ADD COLUMN "isStoreGeneric" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "canonicalProductId" TEXT;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Product_productType_category_idx" ON "Product"("productType", "category");

-- CreateIndex
CREATE INDEX "Product_canonicalProductId_idx" ON "Product"("canonicalProductId");
