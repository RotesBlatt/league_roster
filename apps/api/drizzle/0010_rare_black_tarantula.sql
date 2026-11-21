-- An unverified row is a Riot ID we never resolved: it has no puuid and cannot get one.
-- `puuid` becomes the identity, so those rows are deleted here — a deliberate data loss
-- (decided 2026-11-21, reverses `degrade, never block` for adding an account).
DELETE FROM "riot_account" WHERE "puuid" IS NULL;--> statement-breakpoint
ALTER TABLE "riot_account" ALTER COLUMN "puuid" SET NOT NULL;