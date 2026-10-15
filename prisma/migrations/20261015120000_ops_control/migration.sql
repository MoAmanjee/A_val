-- CreateEnum
CREATE TYPE "BillingStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'SUSPENDED');

-- AlterTable
ALTER TABLE "stores" ADD COLUMN "slug" TEXT;
ALTER TABLE "stores" ADD COLUMN "variant" TEXT NOT NULL DEFAULT 'mochachos';
ALTER TABLE "stores" ADD COLUMN "whatsappEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "stores" ADD COLUMN "webEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "stores" ADD COLUMN "billingStatus" "BillingStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "stores" ADD COLUMN "suspendedReason" TEXT;
ALTER TABLE "stores" ADD COLUMN "monthlyMessageCap" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "stores_slug_key" ON "stores"("slug");

-- CreateTable
CREATE TABLE "store_usage_days" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "inboundCount" INTEGER NOT NULL DEFAULT 0,
    "outboundCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_usage_days_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_usage_days_day_idx" ON "store_usage_days"("day");

-- CreateIndex
CREATE UNIQUE INDEX "store_usage_days_storeId_day_key" ON "store_usage_days"("storeId", "day");

-- AddForeignKey
ALTER TABLE "store_usage_days" ADD CONSTRAINT "store_usage_days_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill slug for existing stores
UPDATE "stores"
SET "slug" = 'mochachos-potch'
WHERE "slug" IS NULL;
