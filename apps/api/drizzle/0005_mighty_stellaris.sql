CREATE TABLE "profile" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"displayName" text NOT NULL,
	"preferredRole" text NOT NULL,
	"birthday" date,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "profile_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "riot_account" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"gameName" text NOT NULL,
	"tagLine" text NOT NULL,
	"platform" text DEFAULT 'euw1' NOT NULL,
	"puuid" text,
	"isMain" boolean DEFAULT false NOT NULL,
	"verifiedAt" timestamp with time zone,
	"fetchedAt" timestamp with time zone,
	"createdAt" timestamp with time zone NOT NULL,
	CONSTRAINT "riot_account_userId_riot_id_idx" UNIQUE("userId","gameName","tagLine")
);
--> statement-breakpoint
ALTER TABLE "profile" ADD CONSTRAINT "profile_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riot_account" ADD CONSTRAINT "riot_account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "riot_account_one_main_idx" ON "riot_account" USING btree ("userId") WHERE "riot_account"."isMain";