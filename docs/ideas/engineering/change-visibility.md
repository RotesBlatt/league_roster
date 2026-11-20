# Idea — seeing what changed in the data

**Status:** idea, nothing implemented. Follows [`logging.md`](logging.md): logs answer *did it do
the thing?*, not *what did the data look like afterwards?*
**Scope:** backend only. No SPA work.

## 1. The gap

`logging.md` deliberately logs **ids and outcomes**, never values (no names, notes, emails, Discord
ids, invite codes, request bodies). That is right for a request trail, but it means a bug report
that says "the roster is wrong" cannot be reproduced from the log alone:

| event | what we log today | what is missing |
| --- | --- | --- |
| `player.updated` | `playerId`, `byUserId` | **which** field changed, and to what |
| `player.created` / `player.deleted` | `playerId`, `byUserId` | the values created / the record deleted |
| `member.updated` | `targetUserId`, `byUserId`, new `role?`/`status?` | the **old** role/status (we log the new one only) |
| `invite.*` | ids only | by design — a code is a bearer token |
| any mutation | request line (`method`, `path`, `status`, `userId`, `requestId`) | the request **payload** |

And the database is mutable: after the fact there is no way to ask "what did this row look like
before that request?" unless we wrote it down. So today we can trace *that* something happened and
by whom, not what it changed.

## 2. Two different goals (do not conflate them)

1. **Debugging** — "why did this request produce the wrong state?" Wants: the payload, the fields
   that changed, the prior values, the code version. Retention is short; PII risk is the concern.
2. **Accountability** — "who demoted Markus, and when?" Wants: durable, queryable history per row,
   long retention, access control. This is an **audit trail**, a different feature with its own
   storage and policy.

The rest of this doc keeps them separate, because the answers are different (log fields vs a table).

## 3. Options, cheapest to heaviest

### A. Log the *names* of changed fields (cheap, no PII)

```ts
logger.info('player.updated', { playerId, byUserId, changed: ['displayName', 'isActive'] })
```

One line per route, no values. Answers "which field did the user touch" — often enough to localise
a bug to a form or a handler. **Recommended first.**

### B. Log before → after for low-risk scalars

Only enums/booleans where a value cannot be personal data: `role`, `status`, `isActive`,
`maxUses`. Never `note`, `displayName`, `riotGameName`, emails.

```ts
logger.info('member.updated', { targetUserId, byUserId, role: { from: 'member', to: 'captain' } })
```

Closes the "old value" hole for exactly the fields whose transitions are business rules.
**Recommended second.**

### C. Redacted request payload (allowlist per route)

Would help reproduction the most, but it is the thing `logging.md` §5 ruled out for good reasons
(`/api/auth/*` bodies are credentials). Only viable as a strict per-route allowlist
(`displayName`, `role`, `isActive`; never `note`/`code`). **Not recommended** unless a real bug
proves it necessary.

### D. Audit table written in the same transaction

The proper answer for accountability. A row per change, atomic with the change, queryable with SQL,
survives log rotation, carries `requestId` for correlation.

```sql
create table change_log (
  id          uuid primary key default gen_random_uuid(),
  at          timestamptz not null default now(),
  actor       text not null references "user"(id),
  team_id     text references team(id),
  entity      text not null,        -- 'player' | 'membership' | 'invite' | 'team'
  entity_id   text not null,
  action      text not null,        -- 'created' | 'updated' | 'deleted'
  before      jsonb,                -- null on create
  after       jsonb,                -- null on delete
  request_id  text
);
create index change_log_entity_idx on change_log (entity, entity_id, at desc);
```

Cost: migration, a write in each mutation's transaction, a retention job, and a **PII decision**
(store only whitelisted fields in `before`/`after`, or the whole row?). No read endpoint is needed
to get value — the captain can query it; a UI can come later.

### E. Tie a bug report to code

`server.start` should carry the **git sha / app version**. Trivial, and usually the highest
bug-reproduction value per line: a pasted log then identifies the exact build. Do this regardless
of A–D.

## 4. Recommendation

Do **A + E** next (small, safe, no PII); add **B** where a state transition is a business rule
(`member.updated`, player `isActive`). Treat **D** as its own idea if accountability is actually
wanted — a table, not more log fields. Skip **C** until it is the only way to reproduce something.

## 5. Open questions

1. **Which goal?** Debugging only (A/B/E) or accountability too (D)?
2. **PII line for D**: whitelist `before`/`after` to non-personal fields, or store the row and rely
   on DB access control? (Recommend whitelist — logs and audit share the "boring to leak" rule.)
3. **Retention for D**: 90 days? forever? A nightly `delete … where at < now() - interval` in the
   existing backup container, or a `pg_cron` job?
4. **Invites**: even an audit row must not store the code — `entity_id` is the invite id, that is all.
5. **Read access**: DB-only at first, or a captain-only `GET /api/teams/:slug/change-log`?

## 6. Deliberately out of scope

- Analytics/product telemetry — different question, different tool.
- Request bodies for `/api/auth/*` — never.
- Reconstructing full historical state from logs — that is D's job if it is wanted at all.
- Frontend logging.

## 7. Suggested commits (dependency order)

1. `feat(api): log changed field names on mutations` — A, one test per route event.
2. `feat(api): record the build version at boot` — E, `server.start.version`.
3. `feat(api): log enum transitions on member changes` — B, unit-tested on the rule.
4. *(separate idea)* `feat(api): audit table for roster changes` — D, migration + transactional write.
