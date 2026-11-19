# Done ideas

Ideas that shipped. Same docs as before the move: the reasoning, the options that were rejected and
the decisions forced along the way are worth more once the code exists, not less. Nothing here is a
trophy — it is the "why is it like this?" that the code cannot answer.

A doc belongs in this directory only when all four are true, in the commit that finishes the work:

1. the feature is in the app and green (`bun run test`, `bun run test:db`, `bun run typecheck`);
2. its `**Status:**` line says `done`, with the date and the commits that landed it;
3. its "decided while implementing" section matches the code, including the parts that were skipped
   or done differently;
4. its row left the queue table in [`../../ideas.md`](../../ideas.md) and sits in the **Done** table
   there, linking to `done/<name>.md` instead of `ideas/<name>.md`.

Anything short of all four stays in `docs/ideas/` as `in progress`, which is a useful state, not a
half-failure. The convention itself is in [`../../ideas.md`](../../ideas.md).
