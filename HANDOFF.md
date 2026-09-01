# HANDOFF

**Written 2026-09-01, after a 10-issue queue sitting with Docker ON and a
full gate run.** Dennis asked for 10 issues; the sitting **closed 13** and
**filed 8**, working 6 of the 8 to closure. The session was not declared
over by the user — it may continue. Re-derive every count rather than
trusting it.

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`, pushed, clean and
  matching origin. `main` untouched, no PR.
- Last substantive commit: `8dc19916` (#928).
- **`git status` is genuinely clean now** — the standing "never `git add
  -A`, `api/backend/storage/assays/` is deliberately untracked" warning
  several handoffs carried is **retired**. #927 gitignored the runtime
  `storage/` and `uploads/` trees, which is what that warning worked
  around. One committed PDF under `storage/samples/` stays tracked; a
  gitignore rule does not untrack.
- No new dependencies.

## Verification state — FULL gate, all green [ran it]

| Gate | Result |
|---|---|
| backend `tests/unit tests/integration tests/compliance` | **8190 passed / 449 files / 0 failed** |
| frontend (27 files) | **225 passed** |
| `test:architecture` | **106 / 106** |
| `npx tsc --noEmit` (frontend) | **exit 0** |
| **e2e, full ordered suite, `--workers=1`** | **221 passed / 0 failed / 2.3 min** |

Backend was 8084 last sitting (+106). Arch was 104 (+2, the new
route-shadowing guard).

## Docker state

**Stack DOWN. Volumes dropped (`down -v`). Nothing running.** So the next
gate needs the **full bootstrap chain re-run**: the 12-service core, then
`admin-bootstrap-test`, then the 17 reference-data one-shots.
`docker-workflow`'s bioavanced overlay has the recipe and it is accurate —
**including the 17, which is right; a grep of `^  reference-data-bootstrap`
undercounts to 15 because `[a-z-]*` excludes the digits in `icd10`/`icd11`.**

Images rebuilt this sitting: `backend-app-test`, `worker-test`,
`neo4j-projection-worker-test`, `frontend-app-test`.

**Rebuild the backend images before any gate that is meant to exercise
backend changes.** Bringing the stack up reuses whatever
`bioavanced-test-backend-app-test:latest` exists, and this sitting spent a
full bring-up on a stale one — the giveaway was the RBAC boot-seed log line
being absent for pre-#916 code.

## What closed (13)

`#659 #819 #888 #891 #905 #910 #918 #922 #924 #925 #926 #927 #928` — six of
them filed by this sitting. Read each close comment for the evidence.

## Open, and why — the judgment a query cannot carry

Query the board (`gh issue list --state open`, same with `--repo
DyeAllPies/dyeallpies-skills-pack`). What the query will not tell you:

- **#923 is the sharpest open item.** `POST /storage/allocate`,
  `/allocate/auto`, `/move` and `DELETE /release` cannot complete on
  `compose.yml`, `compose.dev.yml` or `compose.prod.yml`. **[ran it]**
  against a live standalone `mongo:7`: `hello` returns no `setName`, the
  probe classifies it standalone, `withTransaction` refuses. Half shipped
  (`d16933a3` makes the failure legible instead of `MongoServerError` code
  20). **The remaining half is a genuine fork and it is yours** — degrade to
  sequential writes (`sensor.service.js:237-268`, #918) or make dev/prod
  replica sets (`compose.test.yml:85`). They differ on chain-of-custody: a
  degraded `/move` writes the specimen's new position with no guarantee the
  immutable audit row landed with it. The repo has done both, for reasons
  that do not transfer, which is why I did not infer one.
- **#893 is open on one unobserved step.** Code half verified natively,
  and the ownership risk the plan flagged is now **[ran it]** — the prod
  image's `/data/*` volumes are writable as uid 100 while `/app` is
  refused. What is unobserved is an upload actually landing. **You cannot
  smoke-test `compose.prod.yml` from the repo as shipped**: it guards nine
  secrets with `${VAR:?}` and `.env.production.example` ships them present
  but **blank**, which `:?` rejects. That is correct behaviour and also the
  reason #893 and #924 both survived undetected. A real `.env` is the
  precondition for any prod verification.
- **#921 is open with ~80 of 228 gate sites pinned** across five routers.
  Its original numbers were wrong by 4.3x. Every slice so far found a real
  defect, so budget the rest as fix-work rather than coverage.
- **#915 and #892 were deliberately excluded from this queue** — #915's own
  body sequences it after #800, and #892's item 1 is parked behind #884.
  Blocked on owner decisions, not on work.
- **#902/#884/#881/#903/#908/#909** remain prior sittings' decisions.
- Pack **#637/#638** carry this sitting's workflow findings. Both are Rule 0
  — only a pack-repo session can act on them.

## Conventions this sitting relied on / established

- **A `git grep` pattern beginning with `/` is MSYS path-mangled on this
  machine** — silent under-match, exit 0. `"/label|SampleLabel"` returned 10
  hits where `"[/]label|SampleLabel"` returned 19, in one file. It defeated
  #659's original evidence **and my re-verification of it**. Bracket the
  slash. Pack #637.
- **A character class silently excludes what you did not think to include.**
  Same family, twice in one sitting: `[a-z-]*` hid `icd10`/`icd11` and made
  me report the overlay as stale when it was correct. Both failures produce
  a confident wrong count, not an error.
- **`full-suite-guard`'s sanctioned frontend whole-suite command cannot
  work** — vitest positional args are filters, not globs, and the hook
  blocks the only alternative it names. What works: `npx vitest run
  src/components src/contexts src/foundation src/hooks src/pages src/utils
  src/views`. Pack #638.
- **Arch-guard exemptions travel with any change that moves them**, again:
  `filter-keys.arch.test.js`'s three `result.routes.js` entries were
  re-keyed **twice** in this one sitting. The gate caught it both times.
- **Three distinct mechanisms produce a vacuous gate test**, and no single
  guard catches all three: an argument-discarding stub (#888), an empty db
  mock (#913), and a proxy that calls the middleware factory once at
  require time so the seam is structurally inert (`sample.routes.test.js`,
  fixed in `b96bbc69`).
- **`requirePermission`'s `allowedActions` is derived from the HTTP verb**
  (`METHOD_TO_ACTION`, `rbac.js:82`), not chosen. A code whose
  `allowedActions` omits the verb's derived action denies every request to
  that route — which is why dict-02's `RELEASE` could not be used for
  `DELETE /release/:sampleId`.
- **A predicate and its negation can want opposite defaults.**
  `isKnownStandaloneDeployment` is deliberately not `!isTransactionCapable`;
  collapsing them cost 18 red tests. "May I use a transaction" and "should I
  refuse" must both answer no when the topology is unknown.
- **A red gate is not evidence about the change you just made.** The first
  full e2e run came back 38 red and none of it was the compose change under
  test — `TEST_SUPPORT_SECRET` was unset in the host shell (#928, fixed).
  The failures surfaced as 403s and `response.ok() === false` in the RF029
  ingestion blocks, which read exactly like product breakage.

## Recommended next

**None queued** — Dennis named no task beyond the 10.

Highest value now: **#923's remedy fork** (needs your call, everything else
about it is measured) and **#921's remaining slices** (mechanical, and each
one so far has found a real defect).
