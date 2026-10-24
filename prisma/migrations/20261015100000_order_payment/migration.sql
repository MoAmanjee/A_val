-- Online payment tracking for the /order mini-site (Apple Pay, Samsung Pay, card).

CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PENDING', 'PAID', 'FAILED');

ALTER TABLE "orders" ADD COLUMN "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID';
ALTER TABLE "orders" ADD COLUMN "paymentMethod" TEXT;
ALTER TABLE "orders" ADD COLUMN "stripePaymentIntentId" TEXT;

CREATE UNIQUE INDEX "orders_stripePaymentIntentId_key" ON "orders"("stripePaymentIntentId");
