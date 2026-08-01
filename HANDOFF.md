# HANDOFF

**Written:** 2026-08-01, after closing #375 (arch tests node:test/ESM
mismatch, `fix-bugs`, Docker on) on `feature/docker-e2e-backend-integration`.

## What happened this session

Picked up via `work-issue` (no specific issue named). Fresh backlog: only
two `bug`-labeled issues remained, #375 and #369 (same pair as the prior
session's handoff — nothing changed upstream). Chose **#375**: clear,
already-locally-reproduced defect with two documented candidate fixes,
over #369 (unpinned, needs open-ended investigation, cosmetic/logging).

**Root cause:** all 8 `tests/architecture/*.arch.test.js` files imported
vitest's `test`/`expect` via ESM `import`, but `package.json` is
`"type": "commonjs"` and `test:architecture` runs them via plain
`node --test`, which can't parse ESM `import`.

**Fix direction settled by checking docs first** (fix-bugs' verify-before-
deferring rule): `README.md`'s Test Strategy section explicitly names
`node --test` as the deliberate, canonical runner for this directory
("Vitest e Playwright legados permanecem fora do contrato atual") — so
converted the 8 files to `node:test`/`node:assert` (mechanical matcher
mapping; `expect.assertions(3)` replaced with an explicit `threw`-flag
assertion) rather than dropping the script.

**Second-order break caught and fixed in the same commit:** converting
away from vitest's own `test()` meant vitest's default glob (any
`*.test.js`) started reporting "No test suite found in file" on all 8
files — would have broken `npm run test:unit:vitest`/`npm test`. Fixed
by excluding `tests/architecture/**` in `vitest.config.js`, matching the
same file's existing `tests/e2e/**` exclusion.

**Landed** (`fix/375-arch-tests-node-test-esm`, merged into
`feature/docker-e2e-backend-integration` at `e9340945`):

- 8 files under `api/backend/tests/architecture/*.arch.test.js`: ported
  to `node:test`/`node:assert`.
- `api/backend/vitest.config.js`: added `tests/architecture/**` to
  `exclude`.
- Verified: `npm run test:architecture` 19/19 via `node --test`; full
  `npm run current-state:ci` chain (architecture tests + essential-seed
  validation + dictionary validation 929/929 + seed dry-run + compliance
  evidence generation) green end to end, per the issue's own ask; a
  normal vitest file run confirms the config edit didn't break vitest
  itself; `npm run lint` clean (311 files) — both pre- and post-merge.

**Issue #375 closed**, comment notes the trace, both fixes, and
verification. Fix branch deleted (local + remote).

**Significant finding filed as #393** (BioAvanceD-v2): this exact
node:test-vs-vitest tension has now flip-flopped **four times**
(#138→#148/#182→[undated README contract flip]→#375), each round fixing
the symptom for whichever runner was canonical *at that moment* with no
record of *why*, and no guard against reverting. A future session
searching "vitest reports 0 tests in this directory" (the literal
symptom #148/#182 describe) could easily re-port these files to vitest
and reintroduce #375 a second time. Suggested a comment or mechanical
guard in the affected files pointing at this history — not attempted
this session, kept separate from #375's own scope.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `e9340945`, **in sync
  with origin** (nothing outstanding to push). Working tree clean except
  the pre-existing `catalog.1.3.0.json` phantom line-ending diff (#391 —
  confirmed no-op again this session, still open/unfixed).
- Issues: **#375 closed** (`e9340945` noted in the close comment).
  **#393 opened** (BioAvanceD-v2, open — the flip-flop-history finding
  above).
- `fix/375-arch-tests-node-test-esm` (merged) deleted, local + remote.
- Untouched from before: **#389** (storage/custody separation, open),
  **#390** (multi-consumer migration, open, depends on #383+#388+#389),
  **#391** (`.gitattributes` phantom-diff fix, open, small/mechanical),
  **#392** (dict-02's fuller SpecimenPreanalytics fields, open,
  build-loop sized), **#369** (audit-logger log-flood, needs
  investigation before it's fixable). Local branch hygiene (swept last
  session): everything merged except `test/377-docs-on-main`, tracked by
  still-open **#379** — not lost work.

## Blocking next step

None. Nothing queued as blocking.

No next issue queued explicitly by Dennis. **#393** (the flip-flop
comment/guard) is the closest, cheapest continuation of this session's
own find — small, in the same files just touched — but that's an
inference, not something Dennis said. **#369** is the only other
remaining `bug`-labeled issue.

## Which skills to use

- **#393** (arch-test flip-flop guard): small — `resolve-issue`. Add a
  comment (or a lint/architecture-test guard) to the 8 files pointing at
  this issue and #138/#148/#182/#375 so a future session doesn't re-port
  them to vitest.
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
