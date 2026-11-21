CREATE TABLE "idempotency_key" (
	"key" text PRIMARY KEY NOT NULL,
	"request_hash" text NOT NULL,
	"status" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_key_status_check" CHECK ("idempotency_key"."status" IN ('IN_PROGRESS', 'COMPLETED')),
	CONSTRAINT "idempotency_key_completed_payload_check" CHECK (("idempotency_key"."status" = 'IN_PROGRESS') OR ("idempotency_key"."status" = 'COMPLETED' AND "idempotency_key"."response_status" IS NOT NULL AND "idempotency_key"."response_body" IS NOT NULL AND "idempotency_key"."order_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "inventory_ledger" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "inventory_ledger_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"sku" text NOT NULL,
	"order_id" uuid,
	"idempotency_key" text,
	"event_type" text NOT NULL,
	"delta" integer NOT NULL,
	"available_after" integer NOT NULL,
	"reserved_after" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_ledger_event_type_check" CHECK ("inventory_ledger"."event_type" IN ('SEED', 'RESERVE', 'RELEASE')),
	CONSTRAINT "inventory_ledger_available_after_check" CHECK ("inventory_ledger"."available_after" >= 0),
	CONSTRAINT "inventory_ledger_reserved_after_check" CHECK ("inventory_ledger"."reserved_after" >= 0),
	CONSTRAINT "inventory_ledger_delta_sign_check" CHECK (("inventory_ledger"."event_type" = 'RESERVE' AND "inventory_ledger"."delta" < 0) OR ("inventory_ledger"."event_type" = 'RELEASE' AND "inventory_ledger"."delta" > 0) OR ("inventory_ledger"."event_type" = 'SEED' AND "inventory_ledger"."delta" >= 0))
);
--> statement-breakpoint
CREATE TABLE "order_item" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "order_item_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_item_quantity_check" CHECK ("order_item"."quantity" > 0),
	CONSTRAINT "order_item_unit_price_cents_check" CHECK ("order_item"."unit_price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "product" (
	"sku" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"price_cents" integer NOT NULL,
	"total_stock" integer NOT NULL,
	"available_stock" integer NOT NULL,
	"reserved_stock" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_price_cents_check" CHECK ("product"."price_cents" >= 0),
	CONSTRAINT "product_total_stock_check" CHECK ("product"."total_stock" >= 0),
	CONSTRAINT "product_available_stock_check" CHECK ("product"."available_stock" >= 0),
	CONSTRAINT "product_reserved_stock_check" CHECK ("product"."reserved_stock" >= 0),
	CONSTRAINT "product_stock_conservation_check" CHECK ("product"."available_stock" + "product"."reserved_stock" = "product"."total_stock")
);
--> statement-breakpoint
CREATE TABLE "reservation_order" (
	"id" uuid PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"customer_id" text NOT NULL,
	"status" text NOT NULL,
	"total_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "reservation_order_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "reservation_order_status_check" CHECK ("reservation_order"."status" IN ('RESERVED', 'CANCELLED')),
	CONSTRAINT "reservation_order_total_cents_check" CHECK ("reservation_order"."total_cents" >= 0),
	CONSTRAINT "reservation_order_cancelled_at_check" CHECK (("reservation_order"."status" = 'CANCELLED' AND "reservation_order"."cancelled_at" IS NOT NULL) OR ("reservation_order"."status" = 'RESERVED' AND "reservation_order"."cancelled_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "idempotency_key" ADD CONSTRAINT "idempotency_key_order_id_reservation_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."reservation_order"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_sku_product_sku_fk" FOREIGN KEY ("sku") REFERENCES "public"."product"("sku") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_order_id_reservation_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."reservation_order"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_order_id_reservation_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."reservation_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_sku_product_sku_fk" FOREIGN KEY ("sku") REFERENCES "public"."product"("sku") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idempotency_key_order_id_idx" ON "idempotency_key" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "inventory_ledger_order_id_idx" ON "inventory_ledger" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "inventory_ledger_sku_created_id_idx" ON "inventory_ledger" USING btree ("sku","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "order_item_order_id_sku_unique" ON "order_item" USING btree ("order_id","sku");--> statement-breakpoint
CREATE INDEX "order_item_sku_idx" ON "order_item" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "reservation_order_status_created_id_idx" ON "reservation_order" USING btree ("status","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reservation_order_created_id_idx" ON "reservation_order" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reservation_order_customer_id_idx" ON "reservation_order" USING btree ("customer_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);