# HANDOFF

**Written 2026-08-28. Definitive rotation — the sitting is finished.**
A `rabbit-hole` sitting on the `patientID`/mock-fidelity cluster, run as an
orchestrator with delegated workers. **19 commits, pushed.** Nine issues
closed here, nine filed here, nine filed against the pack.

---

## Still inside the rabbit hole: tracker #846

Re-enter via `rabbit-hole` with tracker **#846**; re-derive membership from
its comments, not from this table.

| member | state |
|---|---|
| #843 miabisValidator sharing verdict | closed `a27c9721` |
| #847 buildActiveConsentQuery wrong key | closed `32a1538d` |
| #848 unguarded patient `$or` | closed `ab1b20a1` |
| #850 dead `_id` leg | closed `21e7398d` |
| #851 shorthand blind spot | closed `28b66177` |
| #853 batch-import linkage key | closed `bd451e60` + `9f74a6aa` |
| #854 `$or` blind spot in the guard | closed `c3aeb128` |
| #857 missing canonical `specimenId` tier | closed `11267453` |
| **#797** filter-blind mocks | **open** — triage posted; item 2 is triage, *not* a sweep |
| **#849** guard's unreached scope | **open** — option 2 done; direction decided, see its triage comment |

Also closed outside the hole: **#842** (`a125e524`), **#844** (`20833d93`),
**#845** (`2d4422bd`), **#852** (premise-corrected, not planned).

## The cluster, as it actually turned out

`sample.patientID` produced **eight** live read-site bugs, in **two
directions** — which is why no single rename sweep would have cleared it:

- **wrongly permissive** (#843, #848) — `undefined` serialises to BSON
  `null`, matches an arbitrary record, and the code faithfully reports
  *that* record's consent.
- **wrongly restrictive** (#847, #853, #857) — the key is absent from every
  document, so nothing ever matches.

#788's fix moved `GET /api/samples` from the first direction to the second
without anyone noticing, because the test written to prove #788 fixed was an
identity stub asserting two mock values against each other.

## Rules this sitting earned (all "ran it")

- **Verify a body's *remedy* separately from its *defect trace*.** #843's
  own suggested fix was wrong; confirming the trace is what made it feel
  pre-vetted.
- **Check the milestones before filing a doc-derived gap.** Docs say what
  must eventually be true; **milestones say when.** #852 was filed and
  closed the same sitting for want of one `gh api .../milestones` call.
  `docs/CI.md` now carries that pointer.
- **Open the non-greppable docs, or say you didn't.** A `git grep` hit on a
  `.docx` is a compressed-bytes match. Opening one inverted #844's fix.
- **After a rename, grep the whole test tree for the literal — not just the
  file you changed.** #853 shipped with a sibling test file red. Pack #573.
- **Prove a new guard catches the *real* defect.** Two false-negative
  classes were found in a guard whose own tests passed throughout (#851,
  #854).

## Repo state

- On `feature/docker-e2e-backend-integration`, **pushed and in sync**.
  `main` untouched, no open PR.
- Untracked, deliberately: `.claude/skills/`, `api/backend/storage/assays/`.
  **Never `git add -A`.**
- **Full native reconcile run: 7907/7909 passing** (438 files). The two
  failures are **pre-existing and filed** — #855 (consent resend 400) and
  #858 (backup.service restore fallback). Confirmed pre-existing by
  reverting `src/` to this sitting's base and reproducing. **That is the
  current baseline; neither is a regression from today.**
- `npm run test:architecture`: **81/81** (was 73).
- **Docker: not run, not observed.** Run `docker ps -a`, not `docker ps`.

## Deliberate non-actions — don't redo the reasoning

- **#797 not closed, and no migration-chunk issues filed.** Its item 1 is
  done; its owner comment scopes item 2 to triage, not a 730-site sweep.
- **`db.factory.js:48` untouched** — ships the identity stub as its
  *default*, 43 consumers, 35 in `tests/integration/`. Highest-leverage
  single change available, and it must be its own serialized work.
- **`{ sampleId }` (lowercase d) legs kept** in #857's four sites. Whether
  that field was ever written is unestablished; noted in the guard's
  exemption comment.

## Recommended next

Dennis named no next issue, so: **none queued.** Backlogs via
`gh issue list --state open` and the same against
`DyeAllPies/dyeallpies-skills-pack`.

- **#855 and #858 are the two red tests** — both want a stale-test-vs-real-bug
  direction call before anyone edits.
- **#856** — nothing drives `storage.routes.js` over HTTP.
- **#849's remaining legs** want deciding with **#839** (identical
  lint-vs-taint fork).
- **Pack #564 says `rabbit-hole` is stale** — Dennis flagged it mid-sitting.
  Mid-workflow HANDOFF rotations are no longer done, despite its Step 4 and
  `handoff`'s multi-iteration subsection both mandating them.
