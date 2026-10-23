-- Leave-out notes are asked once per item. Delivery stays in the schema.
ALTER TYPE "PendingQuestion" ADD VALUE 'ITEM_NOTES';

ALTER TABLE "order_items" ADD COLUMN "notesOffered" BOOLEAN NOT NULL DEFAULT false;
