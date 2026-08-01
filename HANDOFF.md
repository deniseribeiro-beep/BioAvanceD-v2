# HANDOFF

**Written:** 2026-08-01, after closing #393 (arch-test runner flip-flop
guard, `resolve-issue`, no Docker needed) on
`feature/docker-e2e-backend-integration`.

## What happened this session

Continuation of the same day's prior session (which closed #375 and
filed #393 as a follow-on finding). Dennis picked up #393 directly by
name — no backlog triage needed this time.

**#393's problem:** the node:test-vs-vitest runner choice for
`tests/architecture/*.arch.test.js` had flip-flopped four times (#138 →
#148/#182 → an undated README contract flip → #375), each round fixing
the symptom for whichever runner was canonical *at that moment* with no
record of *why*, and no guard against reverting.

**Fix, per the issue's own suggested resolution:**

- Added a 3-line header comment to all 8 existing
  `tests/architecture/*.arch.test.js` files stating they're
  `node:test`-only per `README.md`'s Test Strategy contract, pointing at
  #138/#148/#182/#375/#393.
- Added a 9th file, `test-runner-contract.arch.test.js` — a mechanical
  guard that fails if any sibling file in the directory imports from
  `vitest`, so a future re-port attempt is caught by the test suite
  itself, not just a comment.
- No `vitest.config.js` change needed: its existing
  `tests/architecture/**` exclude is directory-level and already covers
  the new file.

**Landed** (`fix/393-arch-test-runner-guard`, merged into
`feature/docker-e2e-backend-integration` at `2f84d2cc`, commit
`993309a1`):

- Verified: `npm run test:architecture` 20/20 via `node --test` (19 → 20,
  +1 for the new guard test), both on the fix branch and after merging;
  `npm run lint` clean (311 files — lint only scans `src`/`scripts`, so
  the new test file doesn't move that count).

**Issue #393 closed** (had to be closed manually via
`gh issue close --comment` — the `Closes #393` in the commit message
only auto-closes on a direct merge to `main`, and this merged into the
integration branch instead). Fix branch deleted (local + remote).

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `2f84d2cc`, **in sync
  with origin** (nothing outstanding to push). Working tree clean except
  the pre-existing `catalog.1.3.0.json` phantom line-ending diff (#391 —
  still open/unfixed, still a no-op, untouched again this session).
- Issues: **#393 closed** (`2f84d2cc` / `993309a1` noted in the close
  comment).
- `fix/393-arch-test-runner-guard` (merged) deleted, local + remote.
- Untouched from before: **#389** (storage/custody separation, open),
  **#390** (multi-consumer migration, open, depends on #383+#388+#389),
  **#391** (`.gitattributes` phantom-diff fix, open, small/mechanical),
  **#392** (dict-02's fuller SpecimenPreanalytics fields, open,
  build-loop sized), **#369** (audit-logger log-flood, needs
  investigation before it's fixable — now the only remaining
  `bug`-labeled issue). Local branch hygiene unchanged: everything
  merged except `test/377-docs-on-main`, tracked by still-open **#379**.

## Blocking next step

None. Nothing queued as blocking.

No next issue queued explicitly by Dennis. **#369** (audit-logger log
flood) is the only remaining `bug`-labeled issue, but it's unpinned and
needs investigation before it's even fixable — not a quick pickup like
#393 was.

## Which skills to use

- **#369** (audit-logger log flood): `fix-bugs`, but budget time for
  investigation first — no pinned test, root cause/call site not yet
  identified.
- **#391** (`.gitattributes`): small, mechanical `resolve-issue`.
- **#389** (storage/custody entity): scope with `divide-and-conquer`
  first — don't attempt as one slice (28 files, already half-separated
  via `storageBoxes`). Check dict-02's "Entidade" column for the
  canonical name before naming anything (dyeallpies-skills-pack#179).
- **#390**: blocked on #389.
- **#392**: `build-loop`, needs new parsing logic, not just a wrapper.
- Backlog unchanged otherwise from prior handoffs: **#384–#387** (four
  architecture-gap issues), older backlog (`#371`/`#373`/`#374`/`#378`/
  `#379`) — untouched this session.
