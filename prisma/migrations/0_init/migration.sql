-- CreateEnum
CREATE TYPE "Store" AS ENUM ('PUBLIX', 'WALMART', 'TARGET', 'OTHER');

-- CreateEnum
CREATE TYPE "ReceiptSource" AS ENUM ('EMAIL', 'IMAGE_UPLOAD', 'DEVTOOLS_JSON', 'MANUAL');

-- CreateEnum
CREATE TYPE "ParseStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED', 'NEEDS_REVIEW');

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "brand" TEXT,
    "size" TEXT,
    "unit" TEXT,
    "unitSize" DOUBLE PRECISION,
    "imageUrl" TEXT,
    "upc" TEXT,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Price" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "store" "Store" NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "salePrice" DOUBLE PRECISION,
    "onSale" BOOLEAN NOT NULL DEFAULT false,
    "unitPrice" DOUBLE PRECISION,
    "date" TIMESTAMP(3) NOT NULL,
    "receiptId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "source" "ReceiptSource" NOT NULL,
    "store" "Store" NOT NULL,
    "rawContent" TEXT NOT NULL,
    "rawMetadata" JSONB,
    "status" "ParseStatus" NOT NULL DEFAULT 'PENDING',
    "parseError" TEXT,
    "purchaseDate" TIMESTAMP(3),
    "total" DOUBLE PRECISION,
    "taxAmount" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "parsedAt" TIMESTAMP(3),

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptLineItem" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "rawName" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "weight" DOUBLE PRECISION,
    "onSale" BOOLEAN NOT NULL DEFAULT false,
    "salePrice" DOUBLE PRECISION,
    "upc" TEXT,
    "matched" BOOLEAN NOT NULL DEFAULT false,
    "productId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorScrapeJob" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "store" "Store" NOT NULL,
    "url" TEXT,
    "searchQuery" TEXT,
    "status" "ParseStatus" NOT NULL DEFAULT 'PENDING',
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorScrapeJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_upc_key" ON "Product"("upc");
CREATE INDEX "Product_normalizedName_idx" ON "Product"("normalizedName");
CREATE INDEX "Product_upc_idx" ON "Product"("upc");
CREATE INDEX "Price_productId_store_date_idx" ON "Price"("productId", "store", "date");
CREATE INDEX "Price_store_date_idx" ON "Price"("store", "date");
CREATE INDEX "ReceiptLineItem_receiptId_idx" ON "ReceiptLineItem"("receiptId");
CREATE UNIQUE INDEX "CompetitorScrapeJob_productId_store_key" ON "CompetitorScrapeJob"("productId", "store");

-- AddForeignKey
ALTER TABLE "Price" ADD CONSTRAINT "Price_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Price" ADD CONSTRAINT "Price_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReceiptLineItem" ADD CONSTRAINT "ReceiptLineItem_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
