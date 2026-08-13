# HANDOFF

**Written:** 2026-08-13, end of session on `feature/docker-e2e-backend-integration`.

## What happened this session

Continuation of the `#368` queue (`#560`-`#566`), driven via `work-issue`
→ `issue-loop` (queue mode) → `build-loop`, explicitly asked by the user
to fulfill skills-pack `#279`'s dogfooding requirements for this pick.
Picked up right after the prior session closed `#563`/`#564` and paused
before `#566`. Shipped `#566`; stopped before `#565` (see "Next steps").

### `#566` — encryption at rest for `participantIdentities`

**Fresh re-derivation caught a real discrepancy before picking.** The
prior session's `HANDOFF.md` claimed "`#565` stays blocked until `#566`
lands too." Re-reading `#565`'s own issue body (`Depends on: #560, #561,
#562, #563, #564` — no `#566`) and `#566`'s own body ("Depends on:
none"... "independent of #565") showed both were actually open+unblocked
simultaneously, not the blocked-item-skip shape expected. Picked `#566`
first anyway on engineering judgment (data should land in an encrypted
store before `#565`'s backfill writes into it).

**Scope**, per `#566`'s own text ("this... only touches how
participantIdentities documents are stored, not who reads them"):
additive dual-write, not a cutover. Every write path
(`patient.service.js#createPatient`, `import.service.js`'s create+merge
branches, `import-lgpd.service.js`'s two intake paths,
`fhir-import-staging.service.js#commitBatch`) now calls
`participantIdentity.service.js#encryptIdentityFields`, adding
`patientNameEncrypted`/`birthDateEncrypted`/`identityDocumentEncrypted`
ciphertext siblings (AES-256-GCM, reusing `utils/fieldEncryption.js` +
`config/keyRegistry.js` — the same convention `Patient.
representativeIdentityDocument` already uses) plus `encryptionKeyVersion`
(dict-02 P1X-0362), alongside the still-present plaintext. `#560`'s
authorized `reidentify` flow (`participantIdentity.service.js
#getIdentityByParticipantId`) decrypts via `decryptIdentity`, preferring
ciphertext and falling back to plaintext for pre-`#566` records — the
sole intended decryption access path, as the issue asked.

Investigation surfaced that full encryption (dropping the plaintext) would
break 3 consumers at the MongoDB query level: `import.service.js`'s
exact-match `identityDocument` dedup, and `intakeWizard.js`'s /
`PatientIdentityService.js`'s `birthDate` day-range matching — both need a
blind-index hash sibling ciphertext can't provide; `reports.routes.js`'s
`patientName` `$regex` substring search can't be blind-indexed at all and
needs a real redesign. Filed as follow-up **`#574`** rather than forced
into this iteration (10+ established consumers from `#561`-`#564` keep
reading the still-present plaintext unchanged).

Proof: 9 new unit tests (`participantIdentity.service.encryption.unit.test.js`)
+ 1 new integration case on the existing `reidentify` endpoint test
(HTTP-level proof that a ciphertext-only record decrypts correctly). Full
backend suite run clean against the known `#572` baseline (8 pre-existing
failures across 5 files, unchanged before/after). Merge `dacc48f7`.

### Naming collision hit and fixed mid-iteration

Adding the new `require('./participantIdentity.service')` to
`import-lgpd.service.js` collided with that file's existing
`const participantIdentityService = require('./PatientIdentityService')`
(a different service — import-time name+DOB matching) — a `SyntaxError`
at module-load time that, via Node's module cache, broke 53 unrelated
test files (mostly "(0 test)", not real assertion failures) on the first
full-suite run. Root-caused by running 2-3 failed files in isolation;
fixed by renaming the new import to
`participantIdentityEncryptionService`. Filed to the skills-pack as
**`#291`** (the naming-collision convention gap) and **`#292`** (a
distinct dennis-windows Bash-quoting trap hit during the same
investigation: a double-quoted Windows path ending in a trailing
backslash hangs the shell — `\"` reads as an escaped quote, not a
terminator).

### Process miss, self-caught and fixed this session

Drafted two skill-file edits (the naming-collision note, the mass-
test-failure debugging note) and applied them **directly to the pack
repo's checkout** from this BioAvanceD-v2-primary session — a Rule 0
violation (skill files are only editable from a session working in the
skills-pack repo itself). Caught on the next tool result, reverted via
`git checkout --` in the pack repo, re-filed as `#291`/`#292` instead
(the correct "reverse case" path per `work-issue`'s own text). No pack
repo files remain modified.

### Skills-pack `#279` (dogfooding) — progress comment posted

Posted a follow-up comment covering: the fresh-re-derivation catch above
(first time re-deriving from source instead of a carried-forward
snapshot actually changed the picture, not just re-confirmed a static
one); blocked-item-skip still unexercised, and now for a clearer reason
(both remaining items turned out simultaneously resolvable, not one
blocked); a `build-loop` slice that initially looked bigger than one
iteration, resolved by trusting the issue's own explicit scope-limiting
sentence rather than independently re-deriving the same boundary; and
the Rule 0 miss above, noted as incidental to this run rather than a gap
in the skill under test. `#279` stays open.

## Repo state

- **`feature/docker-e2e-backend-integration`**: pushed, at `dacc48f7`
  (merge commit for `#566`, on top of the prior session's 3 commits).
- Local branch `test/566-participantidentity-encryption-at-rest` —
  merged, not yet deleted by a `clean-up` pass this session (do that
  before starting fresh work, or it'll accumulate).
- No Docker stack running, nothing left mid-flight. `#566` proved
  native-only per `build-loop`'s overlay (backend-internal, not the
  milestone's own e2e specs) — full backend suite run after merge,
  confirmed clean against the known `#572` baseline.
- **Pre-existing dangling local branches, not touched this session**
  (carried forward unchanged — same list as the prior handoff:
  `fix/476-...`, `fix/477-...`, `fix/481-...`, `fix/485-...`,
  `fix/513-...`, `test/377-...`, `test/428-...`, `test/431-...`,
  `test/440-...`, `test/441-...`, `test/486-...`, `test/507-...` through
  `test/511-...`, the nine `test/549-*-reference-source` branches, plus a
  stray `worktree-agent-*` branch).

## Next steps

**`#565`** (one-time backfill + drop `Patient`'s legacy civil-identity
fields) is the sole remaining item in the `#368` queue — confirmed
independently pickable now (`Depends on: #560, #561, #562, #563, #564`,
all closed; does not depend on `#566`). **Deliberately not started this
session** — it's the queue's final, most destructive step (removing
fields wholesale, per its own text: "every consumer group must have
already migrated its reads... or this removal breaks them outright"),
needs its own full consumer audit at the same depth `#566` just took, and
this session was already long. Before starting it: re-check whether the
`#570`/`#571`/`#573` follow-ups filed during `#563`/`#564` (pre-existing
gaps in specific consumers, deliberately deferred) represent a live
`Patient`-field read that `#565`'s removal would break — that check
wasn't done this session and is exactly the kind of thing `#565`'s own
"every consumer must have migrated" precondition would catch.

**`#368`** (the tracking issue) stays open — only `#565` remains.

**Skills-pack `#279`** — still open. This session's follow-up
[comment](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/279#issuecomment-5287532320)
is posted. `#291`/`#292` (this session's new findings) are unrelated to
`#279` directly but were filed in the same sitting — a pack-repo-primary
session picking either up doesn't need `#279` context.

- **pack-repo `#280`/`#281`** (long-carried) — still open, unchanged.
- **pack-repo `#283`** — same shape as `#280`, unchanged.
- **pack-repo `#248`/`#270`** — still open, unchanged; only remaining
  lever is a long loaded real session, not a dedicated debugging pass.
- **pack-repo `#286`** — per the prior handoff, Dennis was going to fix
  this directly in the pack repo. Not checked this session (`#566` never
  crossed a queue-item boundary the way `#563`→`#564` did, so it never
  came up) — the next session picking up `#565` should check whether it
  landed before assuming it's still open.
