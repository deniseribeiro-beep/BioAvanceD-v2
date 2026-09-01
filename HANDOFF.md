# HANDOFF

**Written 2026-09-01, after a 10-issue sitting with Docker ON and a full
gate run.** Dennis asked for 10 issues and to use agents. **6 closed, 3
filed, 11 commits pushed, full gate green.** The session was not declared
over by the user — it may continue. Re-derive every count rather than
trusting it.

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`, **pushed, clean and
  matching origin**. `main` untouched, no PR.
- Last substantive commit: `40fe64ab` (#734).
- No new dependencies.

## Verification state — FULL gate, all green [ran it]

| Gate | Result |
|---|---|
| backend `tests/unit tests/integration tests/compliance` | **8225 passed / 451 files / 0 failed** |
| frontend (27 files) | **227 passed** |
| `test:architecture` | **106 / 106** |
| `npm run typecheck` (frontend core + backend lint 462 files + e2e) | **clean** |
| **e2e, full ordered suite, `--workers=1`** | **221 passed / 0 failed / 1.8 min** |

Backend was 8190/449 last sitting (+35 tests, +2 files). Frontend was 225
(+2). Arch unchanged at 106.

**The e2e run is 1.8 min against 2.3 min last sitting, same 221 passing.**
That delta is #930's whole payoff and it is measured, not inferred.

## Docker state

**Stack DOWN. Volumes dropped (`down -v`). All `bioavanced-test-*` images
REMOVED. Build cache pruned (`builder prune -af`, 1.061GB).** Machine went
31 images/5.755GB → 7/2.913GB, 21 volumes/1.224GB → 9/314.8MB, containers
31 → 0.

So the next gate needs **a full image rebuild AND the full bootstrap
chain** — budget ~4 min for the build on top of the bring-up.
`docker-workflow`'s bioavanced overlay has the recipe and it is accurate.

**[ran it] The 17-service chain is `foundation-bootstrap-test` plus 16
`reference-data-bootstrap-*` services.** A grep bracketing digits
(`^  reference-data-bootstrap[A-Za-z0-9-]*:`) returns 16, which matches the
overlay's list exactly; the previous handoff's warning about `[a-z-]*`
undercounting to 15 is confirmed and still worth heeding.

**Always pass `--build` on the core bring-up** when the sitting touched
`api/backend/src` or `frontend/src`. The overlay's thrice-confirmed gotcha
held again: a plain `up -d --wait` reuses a stale image even for freshly
created containers.

## What closed (6)

`#734 #762 #791 #806 #930 #932`. Read each close comment for evidence.
Five carry `premise-corrected`.

## Open, and why — the judgment a query cannot carry

Query the board (`gh issue list --state open`). What the query will not
tell you:

- **#933 is half done.** The break-glass unlock script shipped
  (`493962a0`). The **policy** half is open and is genuinely Dennis's:
  should `reset-mfa` be allowed to clear an administrator's lock without
  clearing `mfaSecret`, and should locks expire at all — the latter
  overlapping #761.
- **#929 is 9 of 10 sites done.** `routes/eConsent.js:19` needs a
  Consent-domain code that does not exist, and creating one runs into
  #888's unresolved tier question, where a Coordenador-level grant has its
  widest blast radius.
- **#714 is one entity of four.** FamilyHistory shipped because it is
  gated under *either* reading of RF005 AC#4. The remaining question is
  narrow and stated on the issue: **does AC#4's five-system enumeration
  bind, or is it illustrative?** AllergyIntolerance/MedicationExposure/
  Procedure are all outside the enumerated set.
- **#931's `duplicatesFound` is open on real blast radius**, not on
  taste: a duplicate is already inside `errorCount`, and pulling it out
  changes the HTTP success flag and would stop a duplicate-only import
  being quarantined at all (RNF011 AC#4).
- **#779 is unblocked** now that #932 landed, and **its cost model was
  backwards** — the scanned set did not grow during an import because the
  import wrote elsewhere. What remains is a compliance question: may a
  biobank label sequence contain gaps?
- **#908 was rescoped and retitled**, not closed. Its "the plumbing is
  already sound" claim is false — three of its four master-data hooks
  expose no mutations. **#934** was split off for the two hooks RF020
  never covered.
- **#893 #921 #923 #892 #884 #881 #902 #903** remain prior sittings'
  decisions, unexamined this sitting.

## Conventions this sitting relied on / established

- **A `[read it]` premise in an issue body is worth re-checking before
  building on it.** Five of nine triaged issues carried a materially wrong
  claim, and two would have shipped defects: #929's "runtime no-op" swap
  would have 403'd six of nine routes, and #734 was blocked for months on
  a constraint that does not exist.
- **The two-hop consumer sweep paid three times.**
  `tests/unit/workers.unit.test.js` pins a return shape no brief named;
  `tests/integration/facility-room.api.test.js` was missed by a
  `facility.routes` grep because the filename does not match the router's;
  and #932's signature change surfaced 24 failures in a fixture outside
  every brief.
- **A test double can encode the very split the bug is about.**
  `import-lgpd.service.importSamples.unit.test.js` wired separate
  `samples` and `amostras` fakes, so the suite could not have caught a
  generated duplicate either. Fixing the fixture was as much the fix as
  the source change.
- **`sed -i` on product source is denied by the auto-mode permission
  classifier on this machine.** Edit is the working fallback — but it
  needs a prior `Read` *tool* call; `cat`/`sed -n` does not satisfy it.
- **A quoted heredoc carrying a long Markdown body failed to parse**
  through the Bash tool where `Write` succeeded with identical content.
  Use `Write` + `gh --body-file`.
- **`npm run typecheck:e2e` is safe beside a frontend write brief** (root
  `tsconfig.json` includes only `playwright/**` and `tests/e2e/**`); the
  full `npm run typecheck` is not.
- **`api/backend/tests/integration/` runs natively** — re-confirmed on
  `equipment.api.test.js`, `facility-room.api.test.js` and
  `users.api.test.js` with zero containers up.

## Recommended next

**None queued** — Dennis named no task beyond the 10.

Highest value now: **#921's remaining slices** (mechanical, and every
slice so far has found a real defect — this sitting's #929 is another
instance of exactly its finding), and **#923's remedy fork**, which is
still the sharpest open item and still needs Dennis's call.
