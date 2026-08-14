# HANDOFF

**Written:** 2026-08-13, end of session on `feature/docker-e2e-backend-integration`.

## What happened this session

Continuation of the `#368` queue, driven via `work-issue` → `resolve-issue`.
Picked up right after the prior session shipped `#566` and paused before
`#565`, the queue's last remaining item.

### `#565` — closed against a narrowed backfill+parity deliverable; the real removal split out to `#575`

`#565`'s own text described the removal as touching `patient.service.js
#createPatient`'s dual-write plus a schema/model change, with
`Depends on: #560, #561, #562, #563, #564` (all closed — correctly
unblocked on paper). A consumer audit run before touching any code (a
backgrounded `Explore` agent, gated through `agent-delegation` first)
found the real removal surface is roughly 4x that: an entire
undocumented service (`PatientIdentityService.js` — the naming-collision
service flagged in `#566`'s own handoff, distinct from
`services/participantIdentity.service.js`) reads and writes
`patientName`/`birthDate`/`identityDocument` directly onto `Patient`
documents for its own import-time matching, live via `intakeWizard.js`
and `import-lgpd.service.js#importSamples` — never mentioned in `#565`'s
dependency list at all. Plus: an independent dual-write bug in
`patient.service.js#updatePatient` (never stripped from the `Patient`
`$set`), four more live write paths across `import.service.js` and
`import-lgpd.service.js`, two MongoDB indexes built directly on these
fields, and ~10 test files that pin the current behavior (one,
`patient-identity.service.test.js`, needing substantial rework, not just
field deletion).

Per `divide-and-conquer`'s "some changes are only correct applied whole"
test: the actual field-removal has to land as one atomic commit (a
half-applied version breaks `PatientModel.create()`'s own validation
immediately), so it couldn't ride along with this session's work.
Surfaced the scope gap to Dennis via `AskUserQuestion` before proceeding
given the LGPD-sensitive nature of the data — confirmed "split it."

**Landed** (`fix/565-participantidentity-backfill`, merged into
`feature/docker-e2e-backend-integration` at `29b9b0f9`):
- `services/participant-identity-backfill.service.js` —
  `backfillParticipantIdentities(db)` (idempotent, creates a
  `ParticipantIdentity` for any pre-`#363` `Patient` missing one) and
  `checkParticipantIdentityParity(db)` (reports any `Patient` with no
  matching identity record, or one whose fields have drifted from the
  mirror — decrypts ciphertext-only records via `#566`'s
  `decryptIdentity` before comparing).
- `scripts/backfillParticipantIdentities.js` — thin CLI wrapper (Pattern
  B, matching `backfillSealedSnapshotPins.js`'s convention: delegates to
  the service, no dry-run flag, `connectDB`/`closeConnection`).
- 9 unit tests, `tests/unit/services/participant-identity-backfill.service.test.js`
  — passed both on the fix branch and after the merge, alongside
  `patient.model.unit.test.js` and `participantIdentity.service.encryption.unit.test.js`
  (76 tests total, all green).

`#565` closed against this narrowed deliverable. Local/remote branch
deleted post-merge.

### `#575` filed — carries the corrected full removal scope

New issue, `Depends on: #565` (this backfill, so no data loss) plus
`#570`/`#571` (recommended, not hard-blocking — those two are raw
MongoDB bypasses that also write these field names onto `Patient`
outside `PatientModel` entirely; landing them first makes "stop writing
them anywhere" actually true rather than true-for-`PatientModel`-paths-
only). Full write-path inventory, the two indexes, the ~10 tests, the
frontend TS-type update (`frontend/src/types/models.ts`), and the
`docs/architecture/canonical-data-contract-v1.md` update are all listed
in `#575`'s body with file:line references — that's the resumable
source of truth for whoever picks it up, not this file.

### `#368` — commented, stays open

`#565` was `#368`'s last listed item, but only the backfill half landed.
Commented on `#368` explaining the split and that it stays open until
`#575` (the actual field-removal) lands.

## Repo state

- **`feature/docker-e2e-backend-integration`**: pushed, at `29b9b0f9`
  (merge commit for the `#565` backfill work, on top of `#566`'s prior
  commits). Working tree clean.
- No Docker stack running, nothing left mid-flight. Backfill work proved
  native-only (a new service + script, no live-Mongo tier in this repo) —
  targeted vitest runs only, per `resolve-issue`'s default execution
  contract.
- `fix/565-participantidentity-backfill` — merged, closed, branch deleted
  (local + remote) this session.
- **Pre-existing dangling local branches, not touched this session**
  (carried forward unchanged — same list as prior handoffs: `fix/476-...`,
  `fix/477-...`, `fix/481-...`, `fix/485-...`, `fix/513-...`,
  `test/377-...`, `test/428-...`, `test/431-...`, `test/440-...`,
  `test/441-...`, `test/486-...`, `test/507-...` through `test/511-...`,
  the nine `test/549-*-reference-source` branches, plus a stray
  `worktree-agent-*` branch).

## Next steps

**`#575`** (the atomic removal — drop `patientName`/`birthDate`/
`identityDocument` from `Patient`'s model/schema and every write path)
is the queue's actual remaining item now, not `#565`. Its own body
carries the full scope; re-read it directly rather than re-deriving from
this summary. Before starting: `#570`/`#571` are recommended
prerequisites (see above) — check whether either landed since this
session. This is explicitly **not** a "pick one small piece" task —
`#575`'s own note repeats `divide-and-conquer`'s atomicity warning: the
model change and every write-path update must land together.

**`#368`** (the tracking issue) stays open — `#575` is what actually
finishes it.

**Skills-pack `#279`** (dogfooding) — not touched this session; no
follow-up comment posted. If the next session is asked to continue that
angle, the prior sessions' comments on `#279` are the place to pick up
from, not this file.

- **pack-repo `#280`/`#281`** (long-carried) — still open, unchanged,
  not checked this session.
- **pack-repo `#283`** — same shape as `#280`, unchanged.
- **pack-repo `#248`/`#270`** — still open, unchanged; only remaining
  lever is a long loaded real session, not a dedicated debugging pass.
- **pack-repo `#286`** — per two prior handoffs, Dennis was going to fix
  this directly in the pack repo. Not checked this session — carry the
  same "check if it landed" note forward again.
