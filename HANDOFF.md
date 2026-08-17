# HANDOFF

**Written:** 2026-08-17, continuation session (ninth update). User said
"read handoff, go into a rabbit hole, docker is on." Previous session's
rabbit hole (`#605`) was already fully closed at pickup, so this session
opened a new one.

## Still inside a rabbit hole — tracker #610 (seed #585)

**Not exited yet.** `#610` tracks reviving `compose.test.yml`'s
`playwright-runner` real-backend e2e suite (`#585` found it unverified
since July's CI consolidation, 51/109 failing at filing time).

### What happened this session

Brought up the test stack fresh (`compose.test.yml`, core services +
`admin-bootstrap-test`, `playwright-runner` itself left stopped to avoid
the documented contention gotcha). A clean full-suite run from the host
came back **111/119 passing** — a big improvement over `#585`'s original
baseline, consistent with `#579`'s comment (already-closed sub-findings
`#600`/`#601`/`#598` had independently fixed most of the gap since
filing).

Of the 8 initial failures, re-running serially (`--workers=1`) showed 3
were **worker-contention artifacts** (`auth-access-security.spec.ts`,
`scientific-data-access.spec.ts`, `specimen-quality-inventory.spec.ts` —
all pass serially, not real bugs) and one more
(`organization-collection-management-ui.spec.ts`) was a **stale Docker
image** — `backend-app-test`'s image predated the `#609` merge
(`2ea5c4cf`) by ~12 minutes, same trap the prior session hit with
`frontend-app-test`. Fixed with a targeted
`docker compose ... up -d --build --wait backend-app-test frontend-app-test`;
confirmed the rebuilt image has `GET /:id` and the spec now passes.

That left two genuine bugs, both confirmed under serial re-runs:

- **`inline-storage-movement.spec.ts` (#488), all 4 tests** — filed as
  `#611`, fixed and merged this session
  (`fix/610-inline-storage-movement-mock-gap` → `a0fc9c8b`, branch
  deleted post-merge). Root cause: `SampleDetailsPage` mounts several
  components (`useResults()`, `useEquipment()`, always-rendered
  `AnalysisUploadModal`'s `useAnalysisTypes()`) plus
  `InlineStorageMovementPanel`'s own `GET /storage/sample/:id` lookup —
  none mocked by the spec, so each 401s against `mockLogin`'s unsigned
  token and `api.ts`'s global interceptor force-logs-out the whole
  session mid-test. Added the missing `page.route` mocks; all 4 tests
  now pass. Lesson written up and filed against the skills pack
  (`dyeallpies-skills-pack#330`, not yet applied — it's a junction into
  that repo, can't edit directly per Rule 0).
  - **Secondary finding, filed but not fixed**: `#612` — once a 401
    triggers the logout path, the app enters a rapid, seemingly-endless
    retry loop hitting `/auth/refresh`, `/users`, `/organizations` with
    no observed backoff. Not root-caused (component not identified).
    Not a tracker `#610` member — an independent finding surfaced while
    debugging `#611`.

- **`tcle-dinamico.spec.ts:33` ("creating a template posts the
  filled-in metadata")** — **not yet triaged**. Fails even serially:
  submit button becomes unstable/detached from the DOM, never completes
  a click within 30s. The sibling test in the same file (form-fill only,
  no submit) passes fine, so it's specific to the submit interaction.
  Not yet checked whether this is the same
  unmocked-background-endpoint pattern as `#611` (worth trying the
  `page.on('response', ...)` 400+ listener technique first — it found
  `#611`'s real cause fast) or a genuine frontend re-render bug. No
  issue filed yet — do that as part of triaging it.

### Repo state

- On `feature/docker-e2e-backend-integration`, pushed and in sync with
  `origin` (`a0fc9c8b`). Working tree clean except the
  gitignored/junctioned `.claude/skills/` (not part of this session's
  diff — the skills-pack fix for `#330` lives in that separate repo,
  unapplied).
- **Docker stack is still up** (`compose.test.yml` core services +
  `admin-bootstrap-test`, `playwright-runner` stopped) — deliberately
  left running because this session's rabbit hole isn't finished;
  tearing it down now would lose the warm state needed to keep
  triaging `tcle-dinamico.spec.ts` and to do a final clean full-suite
  confirmation run before `#610` can close. Tear down with
  `docker compose --env-file .env.test.example -f compose.test.yml down`
  when the hole is actually exited.

## Recommended next steps

Resume inside rabbit hole `#610`:
1. Triage `tcle-dinamico.spec.ts:33` (file an issue once root-caused),
   fix if it's a test-only gap like `#611`; if it's a genuine product
   bug, follow `fix-bugs` instead (out of `#610`'s own test-only scope
   otherwise).
2. Re-run the full suite clean once more to get a final passing count.
3. Close `#610` once every known member is resolved, naming `#611`
   (and `#609`, discovered/fixed just before this session started) in
   the closing comment — `#612` stays open separately, not a blocker.
4. Docker teardown + build-cache prune as part of exiting the hole
   (session's own rebuild only touched `backend-app-test`/
   `frontend-app-test` — no other images rebuilt this session).

Other backlog candidates, unchanged and unverified this session (carried
forward from prior handoffs): `#602`, `#599`, `#336`, `test/human-showcase-video`.
(`#585` itself is superseded by `#610`'s narrower scope now.)
