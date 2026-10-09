-- A priced promotion becomes a hidden menu item the customer can order.
ALTER TABLE "promotions" ADD COLUMN "priceCents" INTEGER;
ALTER TABLE "promotions" ADD COLUMN "menuItemId" TEXT;

ALTER TABLE "promotions" ADD CONSTRAINT "promotions_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
