-- AlterEnum
ALTER TYPE "PendingQuestion" ADD VALUE 'FULFILMENT';
ALTER TYPE "PendingQuestion" ADD VALUE 'DELIVERY_ADDRESS';

-- CreateEnum
CREATE TYPE "Fulfilment" AS ENUM ('COLLECTION', 'DELIVERY');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "fulfilment" "Fulfilment";
ALTER TABLE "orders" ADD COLUMN "deliveryAddress" TEXT;
