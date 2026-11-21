ALTER TABLE "roster_entry" ADD COLUMN "accountId" text;--> statement-breakpoint
ALTER TABLE "roster_entry" ADD CONSTRAINT "roster_entry_accountId_riot_account_id_fk" FOREIGN KEY ("accountId") REFERENCES "public"."riot_account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- The account for a team starts as the player's main one, so a deploy changes nothing visible.
-- Entries whose member has no account stay null: the roster still renders them, and the captain
-- can pick an account once the player adds one.
UPDATE "roster_entry" r
SET "accountId" = a."id"
FROM "riot_account" a
WHERE a."userId" = r."userId" AND a."isMain" = true AND r."accountId" IS NULL;
