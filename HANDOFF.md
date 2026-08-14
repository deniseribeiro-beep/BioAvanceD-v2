# HANDOFF

**Written:** 2026-08-14, end of `#593` iteration on
`feature/docker-e2e-backend-integration`. **Still inside a rabbit hole —
not a session end.**

## Rabbit-hole state: STILL INSIDE

Dogfooding the new `rabbit-hole` skill for the first time. Seed `#578`
(RF021, too big for one sitting — confirmed with Dennis via
`AskUserQuestion` up front).

- **Tracker:** [`#587`](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/587)
  — split via `divide-and-conquer` into `#588`-`#592`, then `#590`
  split further into `#593`/`#594` once real investigation showed it
  was two independent pieces with very different risk (see below).
- **Budget spent so far this sitting: ~6-7 points** (`#588` medium,
  `#589` small, `#593` medium — all closed). Close to the ~10-point
  sitting guidance; recommend stopping or checking in before the next
  pick, not pushing straight through `#594`.
- **Queue remaining:**
  - `#594` — patient-side study linkage (`Patient.js` +
    `paciente.controller.js`'s **duplicated** allow-list, see `#345` —
    the riskier half of the old `#590`). Not started.
  - `#590` stays open as the sub-tracking issue for `#593`✓/`#594`
    (comment lists both) — close it once `#594` lands, per
    `resolve-issue`'s parent-closeable check.
  - `#591` — inactive-protocol enforcement. Depends on `#594` for its
    consent-side portion (was `#590`, same dependency now routes
    through `#594`'s completion) — the `sample.service.js` portion is
    independently landable.
  - `#592` — e2e coverage. Depends on `#588`✓, `#594` (was `#590`),
    `#591`.

### `#588`, `#589`, `#593` — CLOSED this sitting

- **`#588`**: `Study.ethicsApprovalId` + `Protocol.effectivePeriod`,
  17/17 unit tests. Field placement corrected against
  `dict-02_DICIONARIO.md` before implementing (the parent `#578`'s own
  premise had CAAE on the wrong entity). Merged `28f93db8`.
- **`#589`**: decision, not a build — `Protocol.protocolVersion` stays a
  plain string; the dictionary defines no supersession pair for
  Protocol the way it does for `ConsentTemplate`
  (`versionGroupId`/`previousConsentTemplateId`, P1X-0365/0366).
  Recorded as a comment in `Protocol.js`. Merged `e7e6a50c`.
- **`#593`** (was half of `#590`): `PatientConsentModel.studyId`
  (optional) + a referential-integrity check in
  `consent.service.js#createPatientConsent` (same pattern as
  `sample.service.js:187-192`). 167/167 in the touched test files.
  Merged `853b5a07` / `e2bdf9f6`.

### Why `#590` got split mid-investigation (not a wrong-premise case)

A full sweep of `dict-02_DICIONARIO.md` (grep for every row with
`studyId` in the Campo canônico column) found **no dictionary field
linking Consent, ConsentTemplate, or Participant to Study at all** —
only Study itself, Specimen (`studyIds`, plural), Assay, and
`AccessRequest` carry that link. This is a genuine dictionary gap for
RF021 AC#4 (unlike `#588`, which was a wrong-premise correction). The
precedent used: `Sample.js`'s `studyId`/`protocolId`
(commit `5e2e672a`, issue `#295`) — a deliberate implementation choice
tracing to *Specimen's* dictionary fields, not a literal dictionary row
for "Sample."

Splitting happened because the patient-side half is genuinely riskier:
**`Patient.js` and `paciente.controller.js` independently duplicate the
same canonical-field allow-list** (already tracked as `#345`) — adding
`studyId` requires updating *both* in the same commit or the field
passes one gate and fails the other. The consent-side half
(`PatientConsent.js`) has no such duplication, so it shipped alone as
`#593` while `#594` carries the riskier half forward with that trap
called out explicitly in its own body.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed at `e2bdf9f6`,
  working tree clean. Carries this sitting's rabbit-hole-skill-install
  commit plus `#588`/`#589`/`#593`'s merges on top of the prior
  handoff's `d42fa72b`. **Still not merged to `main` — no PR opened.**
- Docker/CI gate hasn't run this sitting (every iteration was
  native-provable per its own bar) — still owed at ship time.
- Issues this sitting (cumulative): `#587` (tracker, open), `#588`
  (closed), `#589` (closed), `#590` (open, sub-tracker for `#593`✓/`#594`),
  `#591`/`#592` (open, queued), `#593` (closed), `#594` (open, next
  pick), `dyeallpies-skills-pack#308` (Stop-hook checkpoint gap for
  backgrounded `Agent`-tool waits — filed, not yet fixed).

## Recommended next steps

**Resume inside the rabbit hole** if continuing — `#594` is next
(patient-side study linkage, the `#345`-shaped duplicated-allow-list
risk called out above). Budget is at ~6-7/10 points already; check with
Dennis before starting `#594` rather than assuming this sitting should
absorb it too. Re-derive tracker `#587`'s membership before popping —
membership already changed once this sitting (`#590` → `#593`/`#594`),
so don't trust a cached list from earlier in the same session either.

Carried forward from prior handoffs, still relevant, not touched this
session:

- **`#579`** (systemic `MongoTopologyClosedError` in shared e2e Mongo
  helpers) — still the most concrete next pickup outside this rabbit
  hole, blocking `#331`'s close.
- **`#331`** stays open pending `#579`.
- `deniseribeiro-beep/BioAvanceD-v2#585` — repo-owner call on reviving or
  retiring `playwright-runner`/`frontend-unit-runner`. Not code-resolvable.
- `deniseribeiro-beep/BioAvanceD-v2#586` — re-identification authorization
  follow-up for `toFhirPatient`, not urgent, no live caller yet.
- `deniseribeiro-beep/BioAvanceD-v2#345` — Patient canonical-field
  allow-list duplication itself (not just this session's one-field
  addition to both copies) — still open, still worth a dedicated fix.
- Skills-pack [`#297`](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/297)
  (no graceful loop exit) — still open, needs the harness team.
- Skills-pack [`#294`](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/294)
  (blocked-item-skip dogfood) — still open, still no organic case.
- pack-repo `#279`/`#280`/`#281`/`#283`/`#248`/`#270`/`#286`,
  `#301` — unchanged, not checked this session.
