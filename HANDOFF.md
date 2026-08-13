# HANDOFF

**Written:** 2026-08-13, end of session on `feature/docker-e2e-backend-integration`.

## What happened this session

User asked to run the multi-issue queue `#368` was split into last
session (`#560`-`#566`, per the prior handoff), explicitly framing it as
dogfooding skills-pack issue #279 (which asks for `issue-loop`'s queue
mode to be exercised against a real multi-item queue, not just read
through). Drove it via `work-issue` → `issue-loop` (queue mode) →
`build-loop` per item. Three sub-issues shipped, fully tested, merged,
and closed in one continuous sitting; paused before the fourth once its
size was confirmed to be the queue's largest remaining piece.

### `#560` — authorized, audited re-identification flow (RNF007 AC#4/AC#5)

`POST /api/patients/:id/reidentify` (`paciente.controller.js#reidentify`,
new `participantIdentity.service.js`), gated by a new
`reidentifyParticipant` permission (Administrador-only — deliberately
not granted alongside `createPatient` or any broader role) and a
required `reason` field, audited on every call including not-found
cases. Merge `129700cf`. Filed `#567` asking Dennis to confirm the
Administrador-only gating is the intended long-term scope for this new
PII-disclosure endpoint (not blocking, not urgent).

### `#561` — migrate core/search paths off Patient's civil-identity fields

`patient.service.js`'s `checkIdentifierConflict`/`checkDuplicatePatient`/
`listPatients`/`searchPatients`/`updatePatient` and
`PatientIdentityService.js`'s import-time matching now resolve
`patientName`/`birthDate`/`identityDocument` via `ParticipantIdentity`
instead of `Patient`'s own copy; `updatePatient` now also dual-writes
`ParticipantIdentity` (closing a gap — only `createPatient` did before).
5 pre-existing test files updated to the new resolution source, 1
obsolete test/dead-code branch removed. Merge `19f47681`.

### `#562` — migrate consent/intake paths off Patient's civil-identity fields

`consent.controller.js`, `eConsent.js` (including the public,
unauthenticated `/validate/:token` e-consent page), and
`intakeWizard.js`'s `/patient-match` heuristic endpoint now resolve via
`ParticipantIdentity` — the `/patient-match` rewrite also fixed a latent
bug (matched on a `patientID` field that doesn't exist on `Patient`
documents, which use `participantId`). Merge `b3731bf4`. Filed `#569`:
`intakeWizard.js#buildSampleDocumentFromIntake` writes a denormalized
civil-identity name straight onto `Sample` documents, bypassing the
whole `ParticipantIdentity` segregation for any consumer that reads
samples — not fixed (out of #562's named scope, needs its own scoping
decision), just flagged.

### Paused before `#563`

`#563` (import/FHIR paths — `import.controller.js`,
`import-lgpd.controller.js`, `import.service.js`, `import-lgpd.service.js`,
`fhir-import-staging.service.js`, `fhir-validator.service.js`,
`fhir.service.js`, `batch-validation-engine.service.js`) is confirmed the
largest of the four consumer-group migrations: ~38 civil-identity-field
references across 8 files (`import-lgpd.service.js` alone has 21).
Reconnaissance only (`grep` counts) — no branch created, no code
touched. Stopped here per `issue-loop` queue mode's own escalation text
("if the queue itself is clearly too large for one sitting... report the
queue's remaining state rather than forcing through it") after three
full, tested, merged slices in one sitting — a natural checkpoint, not a
blocker.

### Two pack-repo (skills-pack) issues filed along the way

- **`#284`** — a `globalThis.vi`/`Cannot read properties of undefined
  (reading 'fn')` vitest error means the command ran from the repo root
  instead of `api/backend/` (different vitest config, no `globals: true`),
  not a real test-infra flake. Cost real time this session: a false
  BioAvanceD-v2 issue (`#568`) was filed believing it was a real flake,
  then had to be closed with a correction once the cwd mistake was
  found. Check the `RUN vX.X.X <path>` banner in vitest's own output
  before treating this error shape as a real bug.
- **`#285`** — Edit-tool `old_string`/`new_string` content containing an
  em-dash or a Unicode regex escape (`̀-ͯ`, common in this
  repo's diacritics-stripping code) can silently land as the literal
  escape-sequence text rather than the real character, with nothing in
  Read/Edit/`git diff` output signaling the mismatch — caught once this
  session via a raw-byte `xxd` check, not by any tool feedback.

### Wrap-up / friction audit (each iteration)

Ran clean on scope (verified via `git diff --stat` against each
slice's merge-base — matched intent every time) and no lazy fixes. Real
friction, both filed to the pack per the above: the vitest-cwd trap
(`#284`, cost a false issue filed-and-closed as `#568`) and the
Edit-tool Unicode-escape trap (`#285`). No skill-file edits made this
session (session's primary directory is BioAvanceD-v2, not the pack —
per Rule 0, findings about pack mechanics went to issues, not edits).

## Repo state

- **`feature/docker-e2e-backend-integration`**: pushed, at `b3731bf4`
  (6 commits ahead of where the prior handoff left it: `#560`/`#561`/
  `#562`'s branch commits + their 3 merge commits).
- Local branches `test/560-reidentification-flow`,
  `test/561-core-search-identity-migration`,
  `test/562-consent-intake-identity-migration` — all merged, not
  deleted (consistent with this repo's existing pile of un-deleted
  merged branches; not cleaned up by this session either).
- No Docker stack running, nothing left mid-flight.
- **Pre-existing dangling local branches, not touched this session**
  (carried forward unchanged — `fix/476-...`, `fix/477-...`,
  `fix/481-...`, `fix/485-...`, `fix/513-...`, `test/377-...`,
  `test/428-...`, `test/431-...`, `test/440-...`, `test/441-...`,
  `test/486-...`, `test/507-...` through `test/511-...`, the nine
  `test/549-*-reference-source` branches, plus a stray
  `worktree-agent-*` branch).

## Next steps

**`#563`** is the natural next pick — it's the next item in the queue
the user asked this session to run, confirmed largest of the four
consumer-group migrations (8 files, ~38 civil-identity-field
references; `import-lgpd.service.js` alone has 21). Likely needs
`divide-and-conquer` treatment (split into sub-slices by file group —
e.g. core import path, `import-lgpd.service.js` alone, FHIR
staging/conversion, batch validation) rather than one commit across all
8 files; `import-lgpd.controller.js` and `fhir-validator.service.js`
showed 0 matches in the grep sweep and may need no changes at all
(confirm before assuming, per the reconnaissance-only caveat above).

After `#563`: **`#564`** (audit/notification/export paths) and **`#566`**
(encryption at rest) are still independently pickable in any order —
neither depends on `#563`. **`#565`** (final backfill + drop legacy
fields) stays blocked until `#560`-`#564` all land; `#560`-`#562` are
done, `#563`/`#564` remain.

**`#368`** (the tracking issue) stays open — not closeable until `#565`
lands.

**Skills-pack `#279`** (the dogfooding request this session was framed
as satisfying) is not yet closed — this session exercised queue mode's
core mechanics (queue determination from a parent's sub-issues,
sequential resolvable-item picking, per-item single-issue-mode driving,
wrap-up every iteration) but the queue never actually emptied and the
upward parent-chain-close check (`#279`'s other named check) was never
exercised, since no sub-issue closure has yet made `#368` closeable.
Leave `#279` open until a future session either empties this queue or
hits a real parent-chain cascade to verify against.

- **pack-repo `#280`/`#281`** (long-carried) — still open, still
  small/self-contained, unchanged this session.
- **pack-repo `#283`** — same shape as `#280`, unchanged this session.
- **pack-repo `#248`/`#270`** — still open, unchanged this session; only
  remaining lever is a long loaded real session, not a dedicated
  debugging pass.
