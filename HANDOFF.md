# HANDOFF

**INTERIM — written mid-sitting, 2026-09-01. The session is CONTINUING.**
Dennis asked for 10 issues and to use agents. Seven are committed, two
write briefs are still in flight, and **the end-of-loop gate has not run
at all.** Written now because the Stop checkpoint fired, not because the
sitting ended. Re-derive every count rather than trusting it.

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`. **8 commits ahead of
  origin and NOT pushed.** `main` untouched, no PR.
- Working tree is **dirty by design** — two `fix-writer` agents are
  editing. Do not assume `git status` is clean; check what is staged
  before adding anything.
- No new dependencies.

## THE IMPORTANT THING: nothing here has been gated

Every commit below was verified only by **targeted native vitest runs**
plus a scoped consumer sweep. Not run this sitting, at all:

- the full backend suite
- the full frontend suite
- `npm run test:architecture`
- `npx tsc --noEmit` for frontend or backend (only `typecheck:e2e`)
- **any Docker anything, and the e2e suite**

Two commits specifically need gates that have not happened:

- **#930 (`568fb15f`) is unproven.** It changes Playwright's
  `globalSetup`. Its only verification was `npm run typecheck:e2e`. The
  full ordered e2e suite is the actual proof and it has not been run.
- **#929 (`385b46f2`) widens an RBAC catalog entry.** Arch guards were
  not run.

## Docker state

**Stack DOWN, volumes dropped, nothing running** — inherited from the
previous sitting and unchanged, because this sitting never touched
Docker. So the gate needs the **full bootstrap chain**: the 12-service
core, then `admin-bootstrap-test`, then the 17 reference-data one-shots.
`docker-workflow`'s bioavanced overlay has the recipe.

**Rebuild `backend-app-test` before any gate meant to exercise backend
changes** — seven of the eight commits are backend, and a bring-up
reuses whatever image already exists.

## Committed this sitting (8)

| Commit | Issue | Scope |
|---|---|---|
| `31c128fb` | #791 | full |
| `a4329bb1` | #714 | FamilyHistory only |
| `bc381020` | #931 | 2 of 3 fields |
| `568fb15f` | #930 | needs e2e gate |
| `cf7b1f74` | #762 | full |
| `385b46f2` | #929 | 9 of 10 sites |
| `9125b2c5` | #806 | full |
| (this file) | — | interim rotation |

**No issue has been closed.** #791, #762 and #806 are resolved and are
waiting on the gate + push before closing. Read each issue's comment
thread for what shipped.

## In flight when this was written

Two `fix-writer` agents, both unverified and uncommitted:

- **#734** — backup encryption gated on `encryptionEnabled`. Files:
  `backup.service.js`, `backup.service.test.js`,
  `backup.service.jsonFallback.test.js`.
- **#932** — barcode collection mismatch. Files: `barcodeGenerator.js`,
  `import-lgpd.service.js`, `sample.service.js`,
  `barcodeGenerator.test.js`.

If the sitting died before these returned, **check the working tree for
partial edits in those files** and either finish or revert them; do not
gate on top of a half-applied change.

## Filed this sitting (3) — all from contradicted premises

Query the board (`gh issue list --state open`). What the query cannot
carry:

- **#932 is the sharpest.** `generateUniqueBarcode` scans `amostras`
  while the LGPD import writes to `samples`. **[read it]** the RF004
  duplicate guard is `if (sampleData.barcode)` and fires ~83 lines
  *before* generation, so generated codes are never checked against
  `samples`; the collision retry re-checks the same wrong collection;
  and **[read it]** `Sample.js:35` has a non-unique index. Mechanism is
  settled; **field impact is [not established]** — there is no
  deployment, so nothing is corrupted today. **Blocks #779**, whose cost
  model it invalidates.
- **#933** — if every Administrador is `mfaLocked`, nothing in the app
  unlocks anyone. **[read it]** `reset-mfa` refuses admin targets
  (`user.routes.js:883-889`), `disable-mfa` needs an *authenticated*
  admin (`:981-988`), and `resetMFA` is Administrador-only. Distinct
  from #762's deploy-timing concern; this is a standing property.
- **#934** — split from #908. **[read it]** `ReportQueryPage.tsx:7`
  imports `reportsService` directly, so `useReports` is a *redundant*
  second client, not prepared plumbing — that half is answerable and the
  suggestion on the issue is to delete it. The `useAccess` half is
  genuinely Dennis's.

## Also changed on the tracker

- **#908 was rescoped and retitled**, not closed. Its "the plumbing is
  already sound" claim is false: three of its four master-data hooks
  expose no mutations and their services have no update/delete.
- **#714, #931, #929 carry `premise-corrected`** — each shipped work
  required correcting the issue's own claims first.
- **#734 is no longer an architecture call.** Its blocker was the belief
  that encrypting backups breaks the RNF010 AC#5 checksum property.
  **[read it]** It does not: the checksum is compared only inside
  `runControlledRestoreTest`, against a recompute over the *same
  directory in the same call* — never across runs — and `restoreBackup`
  compares no checksum at all. Random IVs are irrelevant to it.

## Conventions this sitting relied on / established

- **A `[read it]` premise in an issue body is worth re-checking before
  building on it.** Five of nine triaged issues had a materially wrong
  claim, and two would have shipped defects: #929's "runtime no-op" swap
  would have 403'd six of nine routes, and #931's literal reading
  produces tiles that do not add up.
- **The two-hop consumer sweep paid twice more.**
  `tests/unit/workers.unit.test.js` pins the sub-worker return shape and
  no brief named it; `tests/integration/facility-room.api.test.js` was
  missed by a `facility.routes` grep because the filename does not match
  the router's.
- **`sed -i` on product source is denied by the auto-mode permission
  classifier on this machine.** The Edit tool is the working fallback —
  but it requires a prior `Read` *tool* call, which `cat`/`sed -n` does
  not satisfy.
- **A quoted heredoc writing a long Markdown body failed to parse**
  through the Bash tool; the `Write` tool succeeded with identical
  content. Prefer `Write` + `gh --body-file` for issue bodies.
- **`npm run typecheck:e2e` is safe beside a frontend write brief** —
  root `tsconfig.json` includes only `playwright/**` and `tests/e2e/**`.
  The full `npm run typecheck` is NOT: it recurses frontend and backend.
- **`api/backend/tests/integration/` runs natively**, re-confirmed —
  `equipment.api.test.js` and `facility-room.api.test.js` both ran with
  zero containers up.

## Recommended next

**None queued** — Dennis named no task beyond the 10, and this sitting
is not over.

The immediate next actions, in order: land or revert the two in-flight
agents' work, **then run the full gate** (native suites, architecture,
both typechecks, then Docker bring-up + bootstrap + ordered e2e), then
push, then close #791/#762/#806.
