CREATE TABLE "answer" (
	"id" text PRIMARY KEY NOT NULL,
	"weekId" text NOT NULL,
	"userId" text NOT NULL,
	"submittedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "answer_weekId_userId_idx" UNIQUE("weekId","userId")
);
--> statement-breakpoint
CREATE TABLE "availability" (
	"id" text PRIMARY KEY NOT NULL,
	"weekId" text NOT NULL,
	"userId" text NOT NULL,
	"dayOfWeek" integer NOT NULL,
	"startMinute" integer NOT NULL,
	"endMinute" integer NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "availability_dayOfWeek_check" CHECK ("availability"."dayOfWeek" between 0 and 6),
	CONSTRAINT "availability_minutes_check" CHECK ("availability"."startMinute" >= 0 and "availability"."endMinute" <= 1440 and "availability"."endMinute" > "availability"."startMinute")
);
--> statement-breakpoint
CREATE TABLE "availability_template" (
	"id" text PRIMARY KEY NOT NULL,
	"teamId" text NOT NULL,
	"userId" text NOT NULL,
	"dayOfWeek" integer NOT NULL,
	"startMinute" integer NOT NULL,
	"endMinute" integer NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "availability_template_dayOfWeek_check" CHECK ("availability_template"."dayOfWeek" between 0 and 6),
	CONSTRAINT "availability_template_minutes_check" CHECK ("availability_template"."startMinute" >= 0 and "availability_template"."endMinute" <= 1440 and "availability_template"."endMinute" > "availability_template"."startMinute")
);
--> statement-breakpoint
CREATE TABLE "week" (
	"id" text PRIMARY KEY NOT NULL,
	"teamId" text NOT NULL,
	"startsOn" date NOT NULL,
	"createdBy" text NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"unlockedAt" timestamp with time zone,
	CONSTRAINT "week_teamId_startsOn_idx" UNIQUE("teamId","startsOn")
);
--> statement-breakpoint
ALTER TABLE "team" ADD COLUMN "timezone" text DEFAULT 'Europe/Berlin' NOT NULL;--> statement-breakpoint
ALTER TABLE "team" ADD COLUMN "plannerStart" date;--> statement-breakpoint
ALTER TABLE "answer" ADD CONSTRAINT "answer_weekId_week_id_fk" FOREIGN KEY ("weekId") REFERENCES "public"."week"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer" ADD CONSTRAINT "answer_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_weekId_week_id_fk" FOREIGN KEY ("weekId") REFERENCES "public"."week"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_template" ADD CONSTRAINT "availability_template_teamId_team_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_template" ADD CONSTRAINT "availability_template_membership_fk" FOREIGN KEY ("teamId","userId") REFERENCES "public"."membership"("teamId","userId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week" ADD CONSTRAINT "week_teamId_team_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week" ADD CONSTRAINT "week_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "availability_weekId_idx" ON "availability" USING btree ("weekId");--> statement-breakpoint
CREATE INDEX "availability_template_teamId_userId_idx" ON "availability_template" USING btree ("teamId","userId");