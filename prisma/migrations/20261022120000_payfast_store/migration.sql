-- Per-store PayFast merchant credentials (platform operator configures after the shop signs up).
ALTER TABLE "stores" ADD COLUMN "payfastMerchantId" TEXT;
ALTER TABLE "stores" ADD COLUMN "payfastMerchantKeyEnc" TEXT;
ALTER TABLE "stores" ADD COLUMN "payfastPassphraseEnc" TEXT;
ALTER TABLE "stores" ADD COLUMN "payfastMode" TEXT NOT NULL DEFAULT 'sandbox';
ALTER TABLE "stores" ADD COLUMN "payfastEnabled" BOOLEAN NOT NULL DEFAULT false;
