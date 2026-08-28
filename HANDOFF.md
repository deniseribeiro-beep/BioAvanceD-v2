# HANDOFF

**Written 2026-08-28. Definitive rotation — the sitting is finished.**
A `rabbit-hole` sitting on the `patientID`/mock-fidelity cluster, run as an
orchestrator with delegated workers. Three bugs fixed and closed, one static
guard landed, four issues filed here and four against the pack.

---

## Still inside the rabbit hole: tracker #846

**Do not treat this as a fresh backlog pick.** Re-enter via `rabbit-hole`
with tracker #846, and re-derive membership from its comments rather than
this table.

| member | state |
|---|---|
| #843 miabisValidator sharing verdict | closed, `a27c9721` |
| #847 buildActiveConsentQuery wrong key | closed, `32a1538d` |
| #848 unguarded patient `$or` | closed, `ab1b20a1` |
| #797 filter-blind mocks | **open** — guard slices landed `Refs` |
| #849 guard scope | **open** — option 2 done (`534a2e67`); two legs left |
| #851 shorthand blind spot | closed, `28b66177` |
| #850 the legacy `_id` leg | **open** — wants owner input or a DB query |

Five of these were filed by this sitting from inside the work.

**Also resolved, outside the hole:** #842 (`a125e524`) removed `frontend/.nycrc`
and the two nyc devDependencies it kept alive. Reading it turned up **#852**
— the 7-31 doc batch requires CI to fail on unapproved coverage regression,
and CI has no coverage measurement at all.

## The mechanism claim worth carrying (ran it)

**The `consents` collection is keyed on `participantId`. No writer emits
`patientId`** — verified across `PatientConsent.js:63`,
`consent.service.js:901,918`, `RegisterSample.js:128`,
`intakeWizard.js:523`, with `intakeWizard.js:543` the one correct reader.

**#843's own "Suggested fix" was wrong because of it** — it proposed
`{ patientId: participantId }`, right value and wrong key, which would have
traded a match-anything filter for a match-nothing one while the guard made
it look fixed.

The cluster is **two failure directions from one root**, which is why no
single rename sweep clears it:

- **wrongly permissive** (#843, #848) — `undefined` serialises to BSON
  `null`, matches an arbitrary record, and the code faithfully reports
  *that* record's consent.
- **wrongly restrictive** (#847) — the key is absent from every document,
  so nothing matches and every sample badges "TCLE Pendente".

#788's fix moved `GET /api/samples` from the first to the second without
anyone noticing, because the test written to prove #788 fixed was an
identity stub asserting two mock values against each other.

## Rules this sitting earned

- **Verify a body's *remedy* separately from its *defect trace*.**
  Confirming the trace is exactly what makes the remedy feel pre-vetted.
- **A precedent cited in a brief must be verified from commits, not from an
  issue body.** This sitting briefed "#771 swept 165 mocks across 80 files";
  #771 actually migrated nothing and was closed by one architecture test.
  The agent caught it. Pack #565.
- **Prove a new guard catches the real defect, not just a synthetic one.**
  `filter-keys.arch.test.js` was checked by reintroducing #843's and then
  #847's actual lines; each goes red naming file, line and key.
- **Open the non-greppable docs, or say you didn't.** A `git grep` hit on a
  `.docx` is a match on compressed bytes — neither usable nor dismissable.
  Opening `docs/docs-7-31-2026/3 - Plano_Integrado_*.docx` for #842 changed
  that issue's outcome and produced #852. Pack #569.

## Repo state

- On `feature/docker-e2e-backend-integration`, **pushed**
  (through `a125e524`). Tree clean apart from this rotation. `main`
  untouched, no open PR.
- Untracked and deliberately untouched: `.claude/skills/`,
  `api/backend/storage/assays/`. **Never `git add -A`.**
- Native runs only, all green: the three touched unit files, and
  `npm run test:architecture` at **80/80** (was 73).
- **Docker: not run, not observed.** Bootstrap state unverified — run
  `docker ps -a`, not `docker ps`, before trusting anything about volumes.

## Deliberate non-actions — don't redo the reasoning

- **#797 was not closed, and no migration-chunk issues were filed.** Its
  item 1 is already done; its owner comment scopes item 2 to triage, not a
  730-site sweep. The triage itself is now a comment on #797.
- **`db.factory.js:48` was not touched.** It ships the identity stub as its
  *default*, with 43 consumers, 35 in `tests/integration/` — outside this
  cluster. Arguably the highest-leverage single change available, and it
  must be its own serialized work.
- **#844 is a sixth instance** of the same class, predates this sitting, so
  it was not absorbed into the hole.

## Recommended next

Dennis named no next issue, so: **none queued.** For the backlogs run
`gh issue list --state open` and the same against
`DyeAllPies/dyeallpies-skills-pack`.

What a query cannot carry:

- **#849 and #850 both want Dennis, not a session** — one is a
  lint-vs-dataflow direction call (and should probably be decided with
  #839, which has the identical fork), the other needs a real database
  answer.
- **Pack #564 says `rabbit-hole` is stale** — Dennis flagged it mid-sitting,
  and mid-workflow HANDOFF rotations are no longer done despite Step 4 and
  `handoff`'s multi-iteration subsection both mandating them. Treat that
  skill's prescriptions as suspect until #564 lands.
- **Pack #566 and #567** are this sitting's two orchestration findings: the
  opening move of a delegating sitting is under-specified, and the routing
  reminder now fires too late to change anything.
