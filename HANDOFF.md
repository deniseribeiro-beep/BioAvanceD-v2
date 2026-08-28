# HANDOFF

**Written 2026-08-28. INTERIM — the 10-issue queue Dennis asked for is
complete, but the session was still open when this was written, so more may
have landed after it.** Everything below is verified as of writing;
re-derive counts rather than trusting them.

A delegating sitting: a self-picked 10-issue queue worked with three
concurrent research/fix agents after Dennis corrected the session mid-turn
for running single-track, then the issues it filed absorbed back in.
**11 commits, pushed. 10 issues closed, 3 left open deliberately, 4 product
+ 3 pack issues filed.**

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`, pushed and in sync, tree
  clean. `main` untouched, no PR. Last substantive commit `f8443983`.
- Untracked, deliberately: `.claude/skills/` and
  `api/backend/storage/assays/` — both unchanged from session start [ran
  it].
- **Never `git add -A`.**
- **Docker never started this session.** The four `bioavanced-test_*` named
  volumes are still whatever the previous session left; bootstrap state
  still **none observed**.

## Verification state

- `npm run test:architecture`: **93/93** [ran it] — up from 85, by the two
  #882 cases, four in `request-body-boundary.arch.test.js` (#839) and two in
  `e2e-fixture-model-fidelity.arch.test.js` (#886).
- **Backend regression: 7956/7956 passing, 442 files, zero failures** [ran
  it] — `npx vitest run tests/unit tests/integration tests/compliance
  --reporter=dot`, 527s. Up from the previous session's 7928/441. Run
  deliberately because this sitting made two route-middleware changes and
  the previous session shipped a 19-test regression from exactly that blind
  spot. **The bare `vitest run` form is hook-blocked**, and so is a bare
  directory target — name files or use the three explicit directories.
  - It postdates every commit except `9df92ba7` and `f8443983`, whose own
    targeted + consumer-derived runs were green (103/103, 146/146, 89/89,
    and the arch suite at 93/93).
- Frontend `typecheck` and `typecheck:full`: clean [ran it].
- **e2e specs were NOT run.**

## The three issues left open on purpose

- **#859** — storage RBAC. Fixed and merged (`ad344ed6`), left open because
  the unit proof covers route wiring but not that a *legitimate* caller
  still passes `requireRole`'s real `resolveUserHierarchyLevel` lookup
  against a real DB. Four e2e specs make real authenticated calls to those
  routes; all use `realLogin` (admin, level 4) and *should* pass. **Close it
  when `sample-storage-lifecycle.spec.ts` and
  `specimen-quality-inventory.spec.ts` run green at the Docker gate.**
- **#884** — retitled, not fixed. Its premise was already false; the
  remaining content is a genuine API-contract decision (13 handler sites on
  400 vs 3 on 422) that is Dennis's or Denise's to make.
- **#886** — item 1 shipped (`f8443983`, a guard pinning that the e2e
  equipment fixture stays `Equipment.validate`-clean). Item 2 — whether the
  fixture should construct through the model rather than a raw insert —
  is untouched and depends on #880.

## Findings worth carrying

- **Three issues' premises were contradicted by the tree**, all found by
  delegated research and re-verified by me before acting: #774 was already
  fixed by #867's shared `equipmentStatus.js`; #883's "no indication in the
  response" is false (the PUT already returns `matched`/`quarantined`/
  `movements`); #884's "its PUT returns 422" is false (there is no 422
  anywhere in `equipment.routes.js`). **Re-verify an issue body's factual
  claims before building on them** — this is now 3-for-3 in one sitting.
- **#883 has a docs answer nobody had looked for.** RF019 enumerates four
  quarantine triggers and a routine equipment status change is not among
  them, while RF017 AC#7 ("bloquear local") is a *different* action already
  implemented by `isEquipmentBlocked`. #868 then removed the trigger values
  with the *best* RF019 claim (`offline`, `repair`) and left the two with
  the weakest (`Maintenance`, `Inactive`). [read it — `requisitos-index.md`
  lines 256-305.]
- **#849's headline number is stale**: "65 filter variables outside reach"
  is the pre-#849 figure. Live count is 18-19 of 68 [ran it, via a script
  reproducing the guard's own resolver]. Commented on the issue.

## Rules this sitting earned

- **A fail-closed authorization fix needs its consumer sweep before the
  narrowing, not after.** Both #684 and #859 were only safe to ship because
  the callers were checked first — `api.ts#revokeConsent` turned out to have
  no caller at all, and every e2e caller of the storage mutations logs in as
  admin. Neither fact was in either issue.
- **Check whether an "unestablished" claim in an issue is the one that
  decides the remedy, and establish it first.** #861 offered three options
  and flagged "is there a caller?" as unknown; there was one (a live "Ver"
  button), and it eliminated two of the three options outright.
- **A guard's exemption list should say *which kind* each entry is.**
  `request-body-boundary.arch.test.js` has four exempted `$set`-spread
  sites: two are real defects (#875), two are a deliberate validated
  pattern (#868). Nothing in the code shape distinguishes them.

## Machine friction

- **`gh issue create`/`close`/`comment`/`edit` were NOT refused once** —
  ~18 calls across both repos, auto mode on, including large `--body`
  payloads. The previous handoff carried this as live friction (pack #586);
  it is fixed. Recorded on that issue.
- **`cd api/backend && ... && cd ..` lands in `api/`, not the repo root** —
  a `git checkout --` chained after it failed with "did not match any
  file(s)" and left a temporarily-mutated source file in place until I
  re-ran it from the root. Use absolute paths for restore steps.

## Open work

Do not trust a written list. Query it: `gh issue list --state open`, and the
same with `--repo DyeAllPies/dyeallpies-skills-pack`.

Judgment a query cannot carry:

- **#875 is now measured, not estimated** — 4 unambiguous unvalidated `$set`
  sites plus 2 partial, not the 5 its body claims. The two worst
  (`sensor.service.js`, `sample.service.js`) are cross-function and the new
  guard structurally cannot see them. Its remedy needs per-entity field
  allowlists, not another validator call.
- **#888 (new) blocks the *proper* fix for #859.** No storage-scoped
  permission code exists in the RBAC catalog, so #859 had to use a role
  gate. Adding codes touches Denise's canonical dictionary, and RF006
  (Técnico) and RF017 (Coordenador) disagree about the tier.
- **#886 (new) is the mechanism behind three already-closed issues**
  (#757, #736, #774) — the e2e equipment fixture's raw-insert bypass, which
  every one of those three left in place while correcting only its symptom.
  Item 1 is shipped; item 2 waits on #880.
- **#888's real scope is bigger than its title.** The sweep found
  `createPatient` borrowed as a Coordenador-tier proxy by **seven** route
  files, only one of them the Patient domain, plus `viewTemperature` on a
  policy route [ran it]. Every borrow resolves to the right *tier*, which is
  why nothing ever failed — the defect is in what the permission model and
  audit trail claim, not in who gets in.
- **#889 (new)** is the e2e gap that let #861 hide. Its one prerequisite is
  answered: `compose.test.yml:561` has a `worker-test` service, so the async
  import pipeline is exercisable — writing the spec needs no new
  infrastructure, only the Docker gate to verify it.

## Recommended next

Dennis named no next issue, so: **none queued.**

The two things this sitting could not finish itself, in the order they
unblock other work:

1. **The Docker/e2e gate.** It closes #859 and would let #889 be written and
   verified. Nothing else in the backlog is waiting on it, but two open
   issues are.
2. **#884 and #883 are decisions, not diagnoses.** Both have their
   measurements posted; neither needs more investigation before an answer.
