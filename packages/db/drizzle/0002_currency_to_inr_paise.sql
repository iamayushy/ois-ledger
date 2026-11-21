ALTER TABLE "product" RENAME COLUMN "price_cents" TO "price_paise";
--> statement-breakpoint
ALTER TABLE "product" RENAME CONSTRAINT "product_price_cents_check" TO "product_price_paise_check";
--> statement-breakpoint
ALTER TABLE "reservation_order" RENAME COLUMN "total_cents" TO "total_paise";
--> statement-breakpoint
ALTER TABLE "reservation_order" ALTER COLUMN "total_paise" TYPE bigint;
--> statement-breakpoint
ALTER TABLE "reservation_order" RENAME CONSTRAINT "reservation_order_total_cents_check" TO "reservation_order_total_paise_check";
--> statement-breakpoint
ALTER TABLE "order_item" RENAME COLUMN "unit_price_cents" TO "unit_price_paise";
--> statement-breakpoint
ALTER TABLE "order_item" RENAME CONSTRAINT "order_item_unit_price_cents_check" TO "order_item_unit_price_paise_check";
