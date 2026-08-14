# HANDOFF

**Written:** 2026-08-14, later same day (two sessions in). User asked to
"pick next group of issues or big issue" — picked `#579` (the "big issue"
the prior session had explicitly deferred as "too large to start blind"
without live Docker) via `work-issue` dispatch (`bug` label → `fix-bugs`
route). Docker was authorized for this session via `AskUserQuestion`.

## What happened this session

**`#579`** ("real-backend e2e helpers' shared MongoClient singleton
throws `MongoTopologyClosedError` mid-operation") **closed as
not-reproducible-as-filed.** Brought up `compose.test.yml` (targeted
service list + `admin-bootstrap-test`, per `docker-workflow`'s
documented recipe) and reproduced the issue's exact named repro command
four separate ways:
1. Isolated single spec (`scientific-data-access.spec.ts`, `--workers=1`,
   `playwright-runner` never started): 3/3 passed, 6.4s.
2. Isolated full suite (same conditions): 85/117 passed — vs. the
   original 58/109 baseline (spec count grew via #591-#598 work since
   #579 was filed).
3. Concurrent with `playwright-runner`'s own auto-started full run
   (started right after the stack went healthy — the documented
   contention gotcha): `scientific-data-access.spec.ts` still 3/3 clean.
4. Concurrent under heavier load (`playwright-runner` itself timing out
   on its own first test, 3 retries): still clean — `seedParticipant.ts`/
   `seedSensor.ts`-backed tests all passed; only unrelated tests failed.

`MongoTopologyClosedError` never appeared in any of the four runs. Full
four-way trace posted as #579's closing comment. Root cause of the
*original* failures stays unconfirmed (leading guess: a transient
Mongo replica-set-init condition at the original session's stack
startup, not a code defect) — flagged as such, not asserted.

**Two new issues filed from the same runs, both real, both distinct
from #579:**
- **`#600`** — `compose.test.yml` never wires the
  `reference-data-bootstrap`/`foundation-bootstrap` chain that
  `compose.dev.yml` has (confirmed: zero matches in the test compose
  file, full 16-source chain in the dev one). This is the *one* root
  cause behind 19 of the 32 failures in run #2 above (every RF022/RF028
  test in `pipeline-continuity.spec.ts`). Flagged in #600's body as
  possibly overlapping already-open `#374`/`#371` — not claimed as
  certainly a new gap, worth checking before fixing.
- **`#601`** — `interop-monitoring.spec.ts`'s RF011 FHIR-bundle-commit
  test: a second call to `findCommittedPatient()` right after an
  `expect.poll()` already found the same record non-null comes back
  null. Not yet distinguished whether it's a test-authoring bug
  (re-querying instead of reusing the polled value) or a genuine
  backend eventual-consistency race — seen once under concurrent load,
  not isolated-confirmed. Needs a clean isolated run before anyone
  fixes it.

**`#585`** (owner-gated: revive vs. retire `playwright-runner`) — not
touched (scope/label untouched, still Dennis's call), but commented
with updated numbers: was "51/109 failing, ~49 untriaged," now
"32/117 failing, 19 of which are #600's one root cause, ~13 genuinely
untriaged" (the remaining 13 are listed by name in #579's closing
comment for whoever picks this up).

**Skills-pack tracker** (not this repo):
`DyeAllPies/dyeallpies-skills-pack#317` — filed a `docker-workflow`
BioAvanceD-v2-overlay gotcha found in the process (`--wait
admin-bootstrap-test` reports exit 1 even though the one-shot service
succeeds cleanly) with exact text supplied, since Rule 0 blocks editing
the overlay directly from a BioAvanceD-v2-primary session.

**No product or test code was touched this session at all** — every
issue was diagnosis/closure/filing, not a fix; #579's resolution was
"the bug doesn't exist," so no fix branch was ever created.

## Repo state

- On `feature/docker-e2e-backend-integration`, clean, nothing
  uncommitted, in sync with `origin`. **No commits were made this
  session** — nothing needed pushing.
- Docker: fully torn down at session end. `compose.test.yml` stack
  brought down (no `-v` — named volumes, incl. `mongodb-test-data`,
  kept). 7 session-tagged test images removed
  (`bioavanced-test-playwright-runner` and friends). Builder cache
  pruned, 4.72GB reclaimed. No containers left running.

## Recommended next steps

- **`#331`** (Wave 2 integration tracker) — **still open, and #579's
  closure does NOT resolve it.** #579 turned out to be a non-issue
  rather than a fix, so #331's actual underlying concern (verifying the
  merged Wave 2 specs are genuinely green) is still unverified. A fresh
  full-suite run under clean isolated conditions is what would actually
  close it — use this session's methodology as the reference recipe
  (targeted `up -d --wait` service list, skip `playwright-runner`
  entirely, run Playwright host-side): it's now proven clean of the
  false-positive contention/singleton signal that blocked #331 before.
- **`#600`** — reference-data-bootstrap gap, well-scoped, no owner call
  needed, pickable directly.
- **`#601`** — RF011 commit-race finding, needs an isolated confirmation
  run before anyone attempts a fix (test-bug vs. product-bug still open).
- **`#585`** — still Dennis's call (revive vs. retire
  `playwright-runner`), now with better numbers to decide from.
- **`#336`** — still needs Dennis's call (fix vs. retire the legacy
  `import.controller.js#importFhirBundle` endpoint); `#570` stays
  parked on it, unchanged.
- **`test/human-showcase-video`** — still awaiting Dennis's go to
  show/merge, unchanged.
- Skills-pack `#297`/`#294`/`#315`/`#317` (new this session) —
  unchanged otherwise, not touched further.
- pack-repo `#279`/`#280`/`#281`/`#283`/`#248`/`#270`/`#286`/`#301`/
  `#309`/`#310`/`#311`/`#312`/`#313`/`#314` — unchanged, not checked
  this session.
