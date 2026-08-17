# HANDOFF

**Written:** 2026-08-17, continuation session (ninth update, final rotation).
User said "read handoff, go into a rabbit hole, docker is on." Previous
session's rabbit hole (`#605`) was already closed at pickup, so this
session opened a new one, drove it to completion, and exited it in the
same sitting.

## Rabbit hole exited — tracker #610 (seed #585), both closed

`#610` tracked reviving `compose.test.yml`'s `playwright-runner`
real-backend e2e suite. `#585` (the seed — found it unverified since
July's CI consolidation, 51/109 failing at filing) is closed too; its own
"revive or retire" question is answered: revive was correct.

### What happened this session

1. Brought up the test stack fresh (`compose.test.yml` core services +
   `admin-bootstrap-test`, `playwright-runner` left stopped to avoid the
   documented contention gotcha). Clean run: **111/119 passing** — already
   a big jump from `#585`'s baseline, most of the gap already closed by
   `#600`/`#601`/`#598` since filing.
2. Of the 8 initial failures, serial re-runs (`--workers=1`) showed 3
   were worker-contention artifacts (not real bugs) and one
   (`organization-collection-management-ui.spec.ts`) was a **stale
   `backend-app-test` image** predating the `#609` merge by ~12 minutes —
   same trap the prior session hit with `frontend-app-test`. Rebuilt both
   images; fixed.
3. **`#611`** (closed, merged `a0fc9c8b`): all 4
   `inline-storage-movement.spec.ts` tests failed — `SampleDetailsPage`
   mounts several components with unmocked background API calls
   (`useResults`, `useEquipment`, always-rendered `AnalysisUploadModal`'s
   `useAnalysisTypes`, `InlineStorageMovementPanel`'s storage-location
   lookup) that 401 against `mockLogin`'s unsigned token and force-log-out
   the session via `api.ts`'s global interceptor. Added the missing
   mocks.
4. **`#613`** (closed, merged `da4f08e3`): `tcle-dinamico.spec.ts`'s
   template-creation test — same shape, a debounced
   `GET /e-consent/consent-templates` fell through the spec's own
   `route.continue()` fallback to the real backend and 401'd. Mocked it.
5. **`#612`** (filed, open, not fixed — independent finding, not a
   tracker member): a rapid post-401 retry loop hitting `/auth/refresh`,
   `/users`, `/organizations` with no observed backoff, surfaced while
   debugging `#611`. Component not identified.
6. Two general lessons filed against the skills pack
   (`dyeallpies-skills-pack#330`, comment thread has 3 parts — the
   mockLogin+background-call pattern, the `route.continue()` gotcha, and
   a context-hygiene note on the debug-listener technique — not yet
   applied to the overlay file, it's a junction, can't edit directly).
7. **Final clean full-suite run: 117/119 passing.** The remaining 2
   (`pipeline-continuity.spec.ts` EthicalConsent projection,
   `scientific-data-access.spec.ts` file upload) confirmed
   worker-contention artifacts — both pass in 1-3s serially.

### Session-end cleanup (done)

- `compose.test.yml` stack torn down (`docker compose ... down`, no
  `-v` — named volumes like `mongodb-test-data` persist per the
  documented accumulation gotcha, intentional).
- Build cache from this session's one targeted rebuild pruned
  (`docker builder prune -af`, ~875.6MB reclaimed). Pre-existing tagged
  test images left in place (shared infra for ongoing e2e Docker-gate
  work, same precedent the prior session set).
- WSL2 vhdx checked: 15.9GB physical, not disproportionately bloated —
  no reset needed.
- Scratchpad log files from this session's test runs deleted (fully
  consumed, findings already captured in issues/commits).
- All issue branches (`fix/610-inline-storage-movement-mock-gap`,
  `test/610-tcle-dinamico-triage`) merged and deleted, locally and
  remotely, immediately after each merge — none dangling.

## Repo state

- On `feature/docker-e2e-backend-integration`, clean except the
  gitignored/junctioned `.claude/skills/`. Pushed, in sync with `origin`
  (`da4f08e3` plus this handoff rotation).
- Docker: stack torn down at session end, nothing running (`docker ps`
  empty).

## Recommended next steps

**None queued** — the user didn't name a next task, and the rabbit hole
that was the active thread is fully closed.

Backlog candidates, unchanged and unverified this session (carried
forward from prior handoffs): `#602`, `#599`, `#336`,
`test/human-showcase-video`. New from this session: `#612` (post-401
retry loop, not root-caused).
