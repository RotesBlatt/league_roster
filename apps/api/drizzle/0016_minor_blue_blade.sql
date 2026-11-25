-- HAND-EDITED: the position constraint is DEFERRABLE INITIALLY DEFERRED (drizzle cannot express it,
-- see the comment on `poolEntries` in schema.ts). Without the qualifier a row-by-row reorder
-- violates it halfway through; the integration test "a reorder in both directions" is what notices.
CREATE TABLE "pool_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"kind" text NOT NULL,
	"championId" integer NOT NULL,
	"position" integer NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "pool_entry_owner_kind_champion_idx" UNIQUE("ownerId","kind","championId"),
	CONSTRAINT "pool_entry_owner_kind_position_idx" UNIQUE("ownerId","kind","position") DEFERRABLE INITIALLY DEFERRED,
	CONSTRAINT "pool_entry_kind_check" CHECK ("pool_entry"."kind" in ('main', 'situational', 'blind')),
	CONSTRAINT "pool_entry_position_check" CHECK ("pool_entry"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pool" (
	"ownerId" text PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pool_entry" ADD CONSTRAINT "pool_entry_ownerId_pool_ownerId_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."pool"("ownerId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool" ADD CONSTRAINT "pool_ownerId_user_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pool_entry_ownerId_idx" ON "pool_entry" USING btree ("ownerId");