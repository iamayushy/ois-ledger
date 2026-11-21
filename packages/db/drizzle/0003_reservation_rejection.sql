CREATE TABLE "reservation_rejection" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reservation_rejection_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"idempotency_key" text NOT NULL,
	"customer_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"error_code" integer NOT NULL,
	"skus" text[] NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_rejection_error_code_check" CHECK ("reservation_rejection"."error_code" IN (1102, 1201, 1202))
);
CREATE INDEX "reservation_rejection_key_id_idx" ON "reservation_rejection" USING btree ("idempotency_key","id" DESC NULLS LAST);
CREATE INDEX "reservation_rejection_skus_gin_idx" ON "reservation_rejection" USING gin ("skus");
