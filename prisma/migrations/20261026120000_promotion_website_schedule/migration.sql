-- CreateEnum
CREATE TYPE "PromotionScheduleKind" AS ENUM ('DAILY', 'WEEKLY', 'CUSTOM');

-- AlterTable
ALTER TABLE "promotions" ADD COLUMN "showOnWebsite" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "promotions" ADD COLUMN "scheduleKind" "PromotionScheduleKind";
ALTER TABLE "promotions" ADD COLUMN "startsAt" TIMESTAMP(3);
ALTER TABLE "promotions" ADD COLUMN "endsAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "promotions_storeId_showOnWebsite_startsAt_endsAt_idx" ON "promotions"("storeId", "showOnWebsite", "startsAt", "endsAt");
