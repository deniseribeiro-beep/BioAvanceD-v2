# HANDOFF

**Written 2026-08-28. Definitive rotation — the sitting is finished.**
A `rabbit-hole` sitting on the `patientID`/mock-fidelity cluster, run as an
orchestrator with delegated workers. **25 commits, pushed.** Twelve issues
closed here, sixteen filed here, fourteen filed against the pack.

---

## Still inside the rabbit hole: tracker #846

Re-enter via `rabbit-hole` with tracker **#846**. Re-derive membership from
its comments, not from this file.

**Closed** — #843 `a27c9721` · #847 `32a1538d` · #848 `ab1b20a1` ·
#850 `21e7398d` · #851 `28b66177` · #853 `bd451e60`+`9f74a6aa` ·
#854 `c3aeb128` · #857 `11267453` · #860 `e1abee39`.
Outside the hole: #842 `a125e524` · #844 `20833d93` · #845 `2d4422bd` ·
#855 · #858 · #852 (premise-corrected).

**Open, with what each needs:**

| # | state |
|---|---|
| #797 | item 2 is **triage, not a sweep** (owner scoping). Triage posted; Band A item 1 landed `b1f006ab`. Next: `MongoPatientConsentReadRepository`, `analysisValidation`, `session.service`, then the `patient.service.*` cluster. |
| #849 | option 2 + Band A landed. Remaining: 25 Band B sites needing cross-function analysis — **none dangerous today**, so this is inventory, not urgency. |
| #856 | `freezers` + `box/:boxId/available` covered. `allocate`/`move` need their own harness (inline repo construction + `withTransaction` + Neo4j lineage). |
| #859 | **owner's call, and it survived the check** — see below. |
| #861 | `Depends on: #789`. Establish that first. |
| #862 | delete-or-reimplement; the dictionary closed the "stub for unbuilt data" reading. |

## The one genuine owner's call: #859

`storage.routes.js` gates **1 of 13** routes. Twelve carry only
`authenticate`, including `POST /allocate`, `/allocate/auto`, `/move` and
`DELETE /release/:sampleId`. **RF002 AC#5** requires the backend to validate
permission regardless of frontend hiding, so the *defect* is settled.

**Why the remedy is not a session's:** the RBAC catalog contains **no
storage, freezer, box, position, or read permission** — the whole vocabulary
is six sample-mutation permissions. So a fix either gates reads on *write*
permissions (locking out the read-only roles RF002 AC#2/AC#4 define) or
extends `rbac-catalog-seed.service.js`, redefining what every role can do.
The file's one existing gate uses `requirePermission('createPatient')` on a
storage route — the only precedent, and probably itself wrong.

## What the cluster turned out to be

**Nine** live instances of one root cause, in **two directions**:

- **wrongly permissive** — #843, #848: `undefined` serialises to BSON
  `null`, matches an arbitrary record, and the code faithfully reports
  *that* record's consent.
- **wrongly restrictive** — #847, #853, #857, #861: the key is absent from
  every document, so nothing ever matches.

Plus two in the mirror form — a *fixture* carrying a shape the product never
emits (#844, #855). #788's own fix moved `GET /api/samples` from the first
direction to the second without anyone noticing.

## Rules this sitting earned (all "ran it")

- **Verify a body's *remedy* separately from its *defect trace*.** #843's
  own suggested fix was wrong.
- **Docs gate deferral, and milestones say *when*.** Three issues were
  parked as "needs Dennis" and all three dissolved on reading (#850, #855,
  #858). #852 was filed against a question milestone #3 already answered.
  `docs/CI.md` now carries that pointer. Pack #570, #576.
- **After a rename, grep the whole test tree for the literal.** #853 shipped
  with a sibling test file red. Pack #573.
- **Don't mutate tracked source while an agent is live** — an injection
  corrupted a worker's sweep. Pack #574.
- **A guard's passing tests prove nothing about what it cannot see.** Two
  false-negative classes were found in `filter-keys.arch.test.js` while all
  its own tests passed (#851, #854).

## Repo state

- `feature/docker-e2e-backend-integration`, **pushed and in sync**. `main`
  untouched, no open PR. Last substantive commit `e1abee39`.
- Untracked, deliberately: `.claude/skills/`, `api/backend/storage/assays/`.
  **Never `git add -A`.**
- **`npm run test:architecture`: 82/82** (was 73).
- **Full native reconcile earlier: 7907/7909**; both failures were
  pre-existing and are now **fixed** (#855, #858). No known red tests.
- **Docker: not run, not observed** — Docker Desktop was not even running.
  Use `docker ps -a`, not `docker ps`.

## Deliberate non-actions — don't redo the reasoning

- **`db.factory.js:48`** ships the identity stub as its *default*, 43
  consumers, 35 in `tests/integration/`. Highest-leverage single change
  available; must be its own serialized work.
- **`{ sampleId }` (lowercase d)** legs kept in #857's four sites —
  liveness unestablished, noted in the guard's exemption comment.
- **`UNWRITTEN_KEY_EXEMPT`** in the guard suppresses four *real* defects so
  the suite is green. Its comment names #861/#862 and says to delete the
  entries when they close. Do not read it as an accepted pattern.
- **`api/backend/coverage/`** (31M, gitignored) left in place — could not be
  attributed to this sitting.

## Recommended next

Dennis named no next issue, so: **none queued.** Backlogs via
`gh issue list --state open` and the same against
`DyeAllPies/dyeallpies-skills-pack`.

- **#859 wants Dennis** — the only item here that genuinely does.
- **Pack #564 says `rabbit-hole` is stale**; mid-workflow HANDOFF rotations
  are no longer done despite its Step 4 and `handoff`'s multi-iteration
  subsection both mandating them. Treat its prescriptions as suspect.
- **Pack #571/#568** carry the agent-saturation rules Dennis set this
  sitting: keep 2-3 agents in flight while a hole has open members, and
  query the backlog when below cap.
