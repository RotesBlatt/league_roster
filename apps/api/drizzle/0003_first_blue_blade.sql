-- 'pending' is gone: an existing row was waiting for an approval that no longer exists.
-- A row that exists means the person is (or was) a member, so pending becomes active.
UPDATE "membership" SET "status" = 'active' WHERE "status" = 'pending';
--> statement-breakpoint
ALTER TABLE "membership" ALTER COLUMN "status" SET DEFAULT 'active';
