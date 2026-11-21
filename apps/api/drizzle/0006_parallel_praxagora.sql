CREATE TABLE "roster_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"teamId" text NOT NULL,
	"userId" text NOT NULL,
	"note" text,
	"roleOverride" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "roster_entry_teamId_userId_idx" UNIQUE("teamId","userId")
);
--> statement-breakpoint
ALTER TABLE "roster_entry" ADD CONSTRAINT "roster_entry_teamId_team_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_entry" ADD CONSTRAINT "roster_entry_membership_fk" FOREIGN KEY ("teamId","userId") REFERENCES "public"."membership"("teamId","userId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "roster_entry_teamId_idx" ON "roster_entry" USING btree ("teamId");--> statement-breakpoint
-- 1) Every old roster row becomes a roster entry — but only where the person is actually a member
--    of that team, because `roster_entry` now says so in the database (composite FK on membership).
--    A captain-typed name that never joined has no member to point at: it is NOT carried over and
--    stays in `player` (which is still here) until that table is dropped in its own migration.
INSERT INTO "roster_entry" ("id", "teamId", "userId", "note", "roleOverride", "isActive", "createdAt", "updatedAt")
SELECT p."id", p."teamId", p."userId", p."note", p."role", p."isActive", p."createdAt", p."updatedAt"
FROM "player" p
JOIN "membership" m ON m."teamId" = p."teamId" AND m."userId" = p."userId"
ON CONFLICT ("teamId", "userId") DO NOTHING;
--> statement-breakpoint
-- 2) What the player owns is lifted into `profile` — same set of people, so the three statements
--    agree on who "a roster member" is. An existing profile always wins: DO NOTHING, never overwrite.
INSERT INTO "profile" ("id", "userId", "displayName", "preferredRole", "birthday", "updatedAt")
SELECT 'profile-' || p."userId", p."userId", p."displayName", p."role", NULL, p."updatedAt"
FROM "player" p
JOIN "membership" m ON m."teamId" = p."teamId" AND m."userId" = p."userId"
ON CONFLICT ("userId") DO NOTHING;
--> statement-breakpoint
-- 3) The Riot ID becomes an account. `isMain` is claimed only when the player has no main yet, and
--    only for their first account — two mains would be refused by the partial unique index. The
--    migration cannot call Riot, so `verifiedAt` stays NULL: exactly the "unverified" state.
INSERT INTO "riot_account" ("id", "userId", "gameName", "tagLine", "platform", "puuid", "isMain", "verifiedAt", "fetchedAt", "createdAt")
SELECT
  'riot-' || p."id",
  p."userId",
  p."riotGameName",
  p."riotTagLine",
  'euw1',
  NULL,
  row_number() OVER (PARTITION BY p."userId" ORDER BY p."createdAt", p."id") = 1
    AND NOT EXISTS (SELECT 1 FROM "riot_account" m2 WHERE m2."userId" = p."userId" AND m2."isMain"),
  NULL,
  NULL,
  p."createdAt"
FROM "player" p
JOIN "membership" m ON m."teamId" = p."teamId" AND m."userId" = p."userId"
WHERE p."riotGameName" IS NOT NULL AND p."riotTagLine" IS NOT NULL
ON CONFLICT ("userId", "gameName", "tagLine") DO NOTHING;
