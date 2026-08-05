# HANDOFF

**Written:** 2026-08-05, end of session on `feature/docker-e2e-backend-integration`,
after splitting #389.

## What happened this session

Dennis asked to pick #390 (Sample.js Specimen/SPREC/RCS/storage consumer
migration). Reading it surfaced that #390 explicitly depends on #389
(storage/custody entity separation), which is still open and unstarted
— #388 (SPREC) and #383 (RCS) are landed/closed, but #389 is not. Asked
Dennis how to proceed; picked #389 instead.

Routed #389 via `work-issue` → `divide-and-conquer` (its own issue text
says "largest of the three separations (28 files)... scope it with
divide-and-conquer before implementing"). Surveyed the actual field
consumers directly (grep, not delegated — see friction note below) and
found the real picture narrower/different than the issue's own
non-exhaustive list suggested:

- `availableQuantity`/`originalQuantity`/`totalWithdrawn`/`totalReturned`
  are **not** naive duplicated state — `Sample.js`'s own code comments
  (lines 80-91) already confirm (#401) they're written atomically with
  the `SampleMovement` ledger in one transaction. This is a rename/decision
  task (dict-02 alignment), not a migration task.
- `lifecycleStatus`'s dual-write bridge was already removed (#408) — it's
  now just a legacy-document fallback, near-dead code.
- Several files that string-matched the field names (`sensor.controller.js`,
  `Temperature.js`, `Sensor.js`, `mqtt-telemetry.service.js`,
  `iot-streaming.service.js`, `TelemetryMonitor.js`,
  `InfluxTelemetryWriteRepository.js`, `NotificationService.js`) turned out
  to be unrelated Sensor/IoT-telemetry `locationId` usage, not `Sample`'s —
  excluded from scope.

Proposed a 3-issue split to Dennis (confirmed via AskUserQuestion), filed
all three, referencing #389 as originating issue, and left #389 open as
the tracking issue with a comment listing them:

- **#449** — quantity ledger field rename/decision (`availableQuantity`→
  `currentQuantity`, `originalQuantity`→`initialQuantity`, decide fate of
  `totalWithdrawn`/`totalReturned`). Self-contained, no dependency.
- **#450** — `locationId`/`location`/`storageLocation` migration onto the
  existing `MongoStorageRepository`/use-case layer (`MoveSampleUseCase`,
  `AllocateSampleUseCase`, `GetSampleStorageLocationUseCase`,
  `SearchAllocatableSamplesUseCase`, `ReleaseSampleUseCase` already
  partly resolve through it). Largest piece, carries the real consumer
  list (both backend and frontend). Should land before #390 can close
  out the storage half of its own sweep.
- **#451** — `lifecycleStatus`/`availabilityStatus`/`quarantineStatus`
  consolidation onto `specimenStatus`/`releaseStatus`, plus the open
  design question #389 raised: should custody (`SampleMovement`, an
  append-only ledger) and storage (current location) be one entity or
  two — current code already treats them as separate, suggesting two.

Ran `wrap-up`: no out-of-scope edits (issue-tracker actions only, no code
touched), no lazy fixes, nothing security-relevant, no sub-point stranded
on a closed issue (#389 stayed open). One friction finding: the
`agent-delegation-guard.cjs` hook blocked a single, coherent read-only
`Explore` investigation (one grep-and-categorize survey, not parallel
fan-out) because the brief's prose happened to quote the issue's own
"~28 files" figure — its digit-matcher can't distinguish a fan-out size
from a codebase fact being investigated. Filed as
`dyeallpies-skills-pack#218` (with a suggested refinement: only trigger
on fan-out-adjacent language, or only for unrestricted agent types, not
`Explore`). Worked around by doing the grep directly in the primary
session instead — correct call here, but cost a wasted Agent-tool round
trip and kept the survey work in the main transcript instead of a
subagent's.

## Repo state

- **`feature/docker-e2e-backend-integration`**: clean working tree
  (`git status`/`git diff --stat` both empty aside from the pre-existing
  untracked `api/backend/out.txt`, not touched this session, not
  investigated — flagging in case it's stray output worth cleaning up
  next pickup). No commits made this session (issue-tracker-only
  session); branch position vs. origin unchanged from last handoff
  (pushed through `aa29b532`).
- Issues: **#449, #450, #451 opened** (all `enhancement`, all reference
  #389 as originating issue). **#389 left open** as tracking issue, one
  comment added listing the split. **#390 not picked up** — still
  blocked on #450 landing. `dyeallpies-skills-pack#218` opened (hook
  false-positive finding, see above).
- Backlog otherwise unchanged from last handoff: older backlog (`#371`/
  `#373`/`#374`/`#378`/`#379`). dyeallpies-skills-pack#216, #210 still
  open, not yet applied (now #218 too).
- Carried-forward `user.accessType` grep sweep — still not done. Prior
  note: check against `tests/unit/user.model.unit.test.js`'s
  `isValidAccessType`/`getRoleName` failures first when picked up.
- Local branches `test/440-retention-policy-model` and
  `test/441-retention-sweep-job` are merged and could be deleted per
  `clean-up`'s branch domain — still not done, still flagging.
- `fix/444-retention-period-iso8601` branch housekeeping — still carried
  forward, not re-checked.

## Dev stack state

Untouched this session — no Docker involved, no code run. Last known
dev-stack state unchanged from prior handoffs (dev stack torn down,
named volumes kept, RBAC catalog seeded, 0 real users).

## Blocking next step

None. #390 is blocked on #450 (not on this session, on a future one
picking up #450's actual implementation).

## Recommended next steps

None explicitly queued by Dennis beyond "pick #390" (redirected to #389,
done via split). Candidates, in likely priority order (all carried
forward, untriaged this session except #389's split):

1. **#449** (quantity ledger rename) — smallest, self-contained, no
   dependency. Good next pickup.
2. **#450** (location/storageLocation migration) — largest of the three,
   blocks #390. Its own text says to audit the existing use-cases first
   before assuming the full consumer list needs work.
3. **#451** (status consolidation + custody/storage entity decision) —
   has a real design question to settle (one entity vs. two) before/
   alongside #450.
4. **#390** itself — still blocked until #450 lands.
5. Older backlog: `#371`/`#373`/`#374`/`#378`/`#379`, `user.accessType`
   grep sweep, `test/440-*`/`test/441-*` branch deletion,
   `fix/444-retention-period-iso8601` housekeeping.

## Which skills to use

- `divide-and-conquer`'s design-split playbook (issue too big → plan of
  issues, confirm with user, file with `Depends on:`/`Originating issue:`
  lines, leave original open as tracker) worked cleanly end-to-end this
  session — confirms the playbook as written, nothing to change there.
- New this session: `dyeallpies-skills-pack#218` — `Explore`-type agent
  briefs that quote a source-material count (not a fan-out size) can get
  false-positive blocked by `agent-delegation-guard.cjs`. Until that's
  fixed upstream, expect to fall back to doing single-investigation greps
  directly in the primary session rather than delegating, when the brief
  needs to reference a number from the issue/ticket being investigated.
- Same two open flags carried from prior handoffs, still not filed
  anywhere new this session:
  - A plain "these are closed"/"this reproduces" factual claim that
    turns out false isn't obviously covered by `work-issue`/
    `resolve-issue`'s existing "verify a prior handoff's settled claims"
    guidance (scoped to "needs owner/design call" claims specifically).
  - `resolve-issue`'s close-discipline case 3 covers both "already-
    implemented" tracking issues and "I couldn't reproduce this" flake
    reports — wording currently reads as only the former.
