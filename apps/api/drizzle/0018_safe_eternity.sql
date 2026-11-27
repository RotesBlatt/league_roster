CREATE TABLE "account_sync" (
	"riotAccountId" text PRIMARY KEY NOT NULL,
	"lastAttemptAt" timestamp with time zone,
	"lastSuccessAt" timestamp with time zone,
	"newestMatchStartAt" timestamp with time zone,
	"consecutiveFailures" integer DEFAULT 0 NOT NULL,
	"lastError" text
);
--> statement-breakpoint
CREATE TABLE "match_annotation" (
	"matchId" text NOT NULL,
	"teamId" text NOT NULL,
	"note" text,
	"taggedKind" text,
	"updatedBy" text,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "match_annotation_matchId_teamId_pk" PRIMARY KEY("matchId","teamId"),
	CONSTRAINT "match_annotation_taggedKind_check" CHECK ("match_annotation"."taggedKind" in ('tournament', 'scrim', 'custom'))
);
--> statement-breakpoint
CREATE TABLE "match_participant" (
	"id" text PRIMARY KEY NOT NULL,
	"matchId" text NOT NULL,
	"side" integer NOT NULL,
	"slot" integer NOT NULL,
	"puuid" text,
	"teamPosition" text,
	"championId" integer,
	"win" boolean,
	"kills" integer,
	"deaths" integer,
	"assists" integer,
	"cs" integer,
	"goldEarned" integer,
	"visionScore" integer,
	CONSTRAINT "match_participant_match_side_slot_idx" UNIQUE("matchId","side","slot"),
	CONSTRAINT "match_participant_side_check" CHECK ("match_participant"."side" in (100, 200)),
	CONSTRAINT "match_participant_slot_check" CHECK ("match_participant"."slot" between 1 and 10)
);
--> statement-breakpoint
CREATE TABLE "match_skip" (
	"matchId" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lastAttemptAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"riotMatchId" text,
	"platformId" text,
	"gameStartAt" timestamp with time zone NOT NULL,
	"gameEndAt" timestamp with time zone,
	"durationSeconds" integer,
	"queueId" integer,
	"gameType" text,
	"gameVersion" text,
	"createdByTeamId" text,
	"createdBy" text,
	"fetchedAt" timestamp with time zone,
	CONSTRAINT "match_riotMatchId_idx" UNIQUE("riotMatchId"),
	CONSTRAINT "match_source_check" CHECK ("match"."source" in ('riot', 'manual')),
	CONSTRAINT "match_riot_id_check" CHECK ("match"."source" <> 'riot' or "match"."riotMatchId" is not null)
);
--> statement-breakpoint
ALTER TABLE "account_sync" ADD CONSTRAINT "account_sync_riotAccountId_riot_account_id_fk" FOREIGN KEY ("riotAccountId") REFERENCES "public"."riot_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_annotation" ADD CONSTRAINT "match_annotation_matchId_match_id_fk" FOREIGN KEY ("matchId") REFERENCES "public"."match"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_annotation" ADD CONSTRAINT "match_annotation_teamId_team_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_annotation" ADD CONSTRAINT "match_annotation_updatedBy_user_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_participant" ADD CONSTRAINT "match_participant_matchId_match_id_fk" FOREIGN KEY ("matchId") REFERENCES "public"."match"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match" ADD CONSTRAINT "match_createdByTeamId_team_id_fk" FOREIGN KEY ("createdByTeamId") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match" ADD CONSTRAINT "match_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_annotation_teamId_idx" ON "match_annotation" USING btree ("teamId");--> statement-breakpoint
CREATE UNIQUE INDEX "match_participant_match_puuid_idx" ON "match_participant" USING btree ("matchId","puuid") WHERE "match_participant"."puuid" is not null;--> statement-breakpoint
CREATE INDEX "match_participant_puuid_idx" ON "match_participant" USING btree ("puuid");--> statement-breakpoint
CREATE INDEX "match_participant_championId_idx" ON "match_participant" USING btree ("championId");--> statement-breakpoint
CREATE INDEX "match_gameStartAt_idx" ON "match" USING btree ("gameStartAt");--> statement-breakpoint
CREATE INDEX "match_queueId_idx" ON "match" USING btree ("queueId");--> statement-breakpoint
CREATE INDEX "match_source_idx" ON "match" USING btree ("source");