# Bugs — the bug queue

**This file is a queue, not an archive.** An entry exists for exactly one reason: the bug is not
forgotten before someone works on it. The moment it has a regression test, the entry is **deleted** —
the test that fails without the fix *is* the record, and it cannot rot the way prose does. The file
itself is permanent and stays when the table is empty: an empty queue is a clean queue, not a deleted
one.

## How to use it

- **Record only what you are asked to record.** This is filled on request ("note this, we'll do it
  later"), not by noticing things. A bug journal nobody reads is worse than none.
- **Recording is one patch, no code.** A row plus a section, while the repro is fresh. Mixing it with
  the fix destroys the "fails before, passes after" evidence.
- **Working a bug is one patch.** The failing regression test first, then the fix — and that same
  patch **deletes the row and the section here**. Nothing accumulates: a `Fixed` table would be an
  archive with no reader, and git already remembers what was deleted and why.
- **Ids are never reused.** `B1` means one bug forever, even after its entry is gone, so a commit
  message that cites it stays true. `Next id` below is the only thing a cleanup leaves behind — bump
  it when you add an entry.
- **One bug per entry.** "The header is wrong and also the admin page" is two entries.
- **Record what you saw, then what you think.** *Repro / actual / expected* are observed and
  trustworthy; *suspects* are hypotheses and are labelled as such. A guessed cause written down as
  fact is worse than no entry.

## States

| state | means |
| --- | --- |
| `open` | reproducible, not fixed |
| `blocked` | understood, can't be fixed yet (needs a decision, a dependency, a person) — the blocker is named in its section |

Severity is about the person, not the code: **blocker** = a normal flow cannot be completed;
**major** = it can, but wrongly or confusingly; **minor** = cosmetic, or only on an edge input.

## Open

**Next id:** `B3`

| Id | Sev | Area | Bug | Found |
| --- | --- | --- | --- | --- |

---
