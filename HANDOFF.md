# HANDOFF

**Written:** 2026-08-13, end of session on `feature/docker-e2e-backend-integration`.

## What happened this session

Picked up `#368` (RF005/RNF007 follow-up to `#363` — migrating
`Patient`'s remaining civil-identity fields off the document, plus the
missing audited re-identification flow and encryption at rest) via
`work-issue` → `divide-and-conquer`. No code changed this session —
`#368`'s own body already called for `divide-and-conquer` before
picking it up, and it turned out to need the "real design change, split
into a plan of issues" playbook: 20+ consumers still read identity
fields straight off `Patient`, plus a compliance-required
re-identification flow that doesn't exist yet at all. Forcing the full
scope through in one sitting was not viable; splitting it was.

### `#368` split into 7 issues, confirmed with Dennis before filing

Breakdown (proposed via `AskUserQuestion`, Dennis chose "file as
proposed"):

- **`#560`** — authorized, audited re-identification flow (RNF007
  AC#4/AC#5). Foundational, no deps. Must land before `#565`.
- **`#566`** — encryption at rest for `participantIdentities`.
  Independent, no deps.
- **`#561`** — migrate core/search paths (`patient.service.js`'s
  search/update paths, `PatientIdentityService.js`) off `Patient`'s
  identity fields.
- **`#562`** — migrate consent/intake paths (`consent.controller.js`,
  `eConsent.js`, `intakeWizard.js`).
- **`#563`** — migrate import/FHIR paths (`import.controller.js`,
  `import-lgpd.controller.js`, `import.service.js`,
  `import-lgpd.service.js`, `fhir-import-staging.service.js`,
  `fhir-validator.service.js`, `fhir.service.js`,
  `batch-validation-engine.service.js`).
- **`#564`** — migrate audit/notification/export paths
  (`reports.routes.js`, `NotificationService.js`, `sample.service.js`,
  `MerkleService.js`, `auditLogger.js`, `userAnonymization.js`).
- **`#565`** — one-time backfill + drop `patientName`/`birthDate`/
  `identityDocument` from `Patient` entirely. **Depends on: `#560`,
  `#561`, `#562`, `#563`, `#564`** — this is the step that turns
  "inconsistent/half-migrated" if any consumer group or the
  re-identification flow isn't done first, so it's explicitly last.

`#561`–`#564` (the four consumer-group migrations) have no dependencies
on each other and can be picked up in any order or in parallel across
sessions. `#566` (encryption) is also independent and can land anytime.

`#368` itself was **left open** as the tracking issue, with a comment
listing all 7 numbers and the dependency shape — not closed, since none
of the actual migration work has landed yet.

### Wrap-up / friction audit

Ran clean — no code touched, no scope creep, nothing to file. The one
hiccup (`gh issue create` blocked once by the repo's label-required
hook, pack issue #148) was self-explanatory and resolved by adding
`--label enhancement` to each call; not new friction worth a skill edit.

## Repo state

- **`feature/docker-e2e-backend-integration`**: clean, unchanged this
  session, still at `9ac14682` (same commit as the prior handoff — no
  new commits, no pushes; this session was issue-tracker-only).
- No Docker stack running, no stray local branches created this
  session.
- **Pre-existing dangling local branches, not touched this session**
  (carried forward unchanged from prior handoffs — `fix/476-...`,
  `fix/477-...`, `fix/481-...`, `fix/485-...`, `fix/513-...`,
  `test/377-...`, `test/428-...`, `test/431-...`, `test/440-...`,
  `test/441-...`, `test/486-...`, `test/507-...` through `test/511-...`,
  the nine `test/549-*-reference-source` branches, plus a stray
  `worktree-agent-*` branch — not re-verified against the integration
  branch this session).

## Next steps

No issue named as next by Dennis. For context (not a directive):
- **`#560`** (audited re-identification flow) is the natural first pick
  from the new split — it's the only piece with a downstream dependent
  (`#565`) and unblocks the safety condition the whole migration plan
  hinges on. `build-loop` is the likely route (new capability, not yet
  in the code) given the `RF005 build-loop` label-mapping precedent
  already in this repo's `work-issue` overlay for RF-numbered items.
- **`#561`–`#564`** (consumer-group migrations) and **`#566`**
  (encryption) are all independently pickable in any order once/if
  `#560` is underway — none block each other.
- **`#565`** is not pickable yet — blocked on all five of the above.
- **pack-repo `#280`/`#281`** (long-carried) — `#280` needs a
  pack-primary session to fold its content into that repo's
  `HANDOFF.md`; `#281` needs the `work-issue`/Rule-0-adjacent wording
  fix it proposes. Still open, still small/self-contained.
- **pack-repo `#283`** (from last session) — same shape as `#280`: a
  pack-primary session folds a `docker-workflow` local-env addition in
  verbatim.
- **pack-repo `#248`/`#270`** — both still open from prior sessions,
  both with two full sessions of negative-repro data each. Only
  remaining lever is "deep into a long, loaded, real session" rather
  than a dedicated isolated test — not worth another dedicated
  debugging session.
