CREATE TABLE "champion_patch" (
	"patch" text PRIMARY KEY NOT NULL,
	"publishedAt" timestamp with time zone NOT NULL,
	"publishedAtTimestamp" integer NOT NULL,
	"fetchedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "champion" (
	"patch" text NOT NULL,
	"championId" integer NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"iconUrl" text NOT NULL,
	"positions" text[] DEFAULT '{}'::text[] NOT NULL,
	"roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"locale" text DEFAULT 'en_US' NOT NULL,
	CONSTRAINT "champion_patch_championId_pk" PRIMARY KEY("patch","championId")
);
--> statement-breakpoint
ALTER TABLE "champion" ADD CONSTRAINT "champion_patch_fk" FOREIGN KEY ("patch") REFERENCES "public"."champion_patch"("patch") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "champion_championId_idx" ON "champion" USING btree ("championId");