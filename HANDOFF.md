# HANDOFF

**Written:** 2026-08-14, end of `#594` iteration on
`feature/docker-e2e-backend-integration`. **Still inside a rabbit hole —
not a session end.**

## Rabbit-hole state: STILL INSIDE

Dogfooding the new `rabbit-hole` skill for the first time. Seed `#578`
(RF021, too big for one sitting — confirmed with Dennis via
`AskUserQuestion` up front).

- **Tracker:** [`#587`](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/587)
  — split via `divide-and-conquer` into `#588`-`#592`, then `#590`
  split further into `#593`/`#594` mid-investigation (a real dictionary
  gap surfaced two independently-risky halves, not a wrong-premise
  case like `#588`).
- **Budget spent so far this sitting: ~9-10 points** — past the
  skill's ~10-point sitting guidance. **Recommend a fresh sitting for
  `#591`/`#592` rather than continuing this one.**
- **Queue remaining:**
  - `#591` — inactive-protocol enforcement in `sample.service.js` (and
    now wherever the `#593`/`#594` consent/patient study linkage
    landed). The `sample.service.js` portion is independently landable
    today; the consent/patient-side enforcement now has real fields to
    enforce against, since `#593`/`#594` landed. Not started.
  - `#592` — real-backend e2e coverage for the enforcement path.
    Depends on `#588`✓, `#590`✓ (via `#593`✓/`#594`✓), `#591`. Not
    started.

### Closed this sitting: `#588`, `#589`, `#590` (sub-tracker), `#593`, `#594`

- **`#588`**: `Study.ethicsApprovalId` + `Protocol.effectivePeriod`,
  17/17 unit tests. Field placement corrected against
  `dict-02_DICIONARIO.md` before implementing. Merged `28f93db8`.
- **`#589`**: decision, not a build — `Protocol.protocolVersion` stays
  a plain string (no dictionary-defined supersession pair for
  Protocol, unlike ConsentTemplate). Recorded as a `Protocol.js`
  comment. Merged `e7e6a50c`.
- **`#590`** (sub-tracker, closed once both children landed):
  - **`#593`**: `PatientConsentModel.studyId` (optional) + referential
    check in `consent.service.js#createPatientConsent`. 167/167 in
    touched files. Merged `853b5a07`/`e2bdf9f6`.
  - **`#594`**: `Patient.studyId` (optional) in **both** duplicated
    allow-lists (`Patient.js` and `paciente.controller.js#
    rejectCanonicalAliases` — `#345` is the tracked general-duplication
    risk; this issue only fixed it for this one field, with a
    regression test pinning both lists agree) + referential check in
    `patient.service.js#createPatient`. 171/171 in touched files.
    Merged `617e9403`/`c53fc278`.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed at `c53fc278`,
  working tree clean. Carries this sitting's rabbit-hole-skill-install
  commit plus `#588`/`#589`/`#593`/`#594`'s merges on top of the prior
  handoff's `d42fa72b`. **Still not merged to `main` — no PR opened.**
- Docker/CI gate hasn't run this sitting (every iteration was
  native-provable per its own bar) — still owed at ship time.
- Issues this sitting (cumulative): `#587` (tracker, **open**), `#588`
  (closed), `#589` (closed), `#590` (closed, sub-tracker), `#591`/`#592`
  (open, queued — next pick), `#593` (closed), `#594` (closed),
  `dyeallpies-skills-pack#308` (Stop-hook checkpoint gap for
  backgrounded `Agent`-tool waits — filed, not yet fixed).

## Recommended next steps

**Resume inside the rabbit hole in a fresh sitting** — `#591` is next
(inactive-protocol enforcement). Re-derive tracker `#587`'s membership
before popping — it's changed twice already this sitting (the original
5-member split, then `#590` → `#593`/`#594`), so don't trust any cached
list, including this handoff's own summary above, without re-checking
`gh issue view 587`.

One thing worth checking before starting `#591`: the issue's original
scope note said the consent-side enforcement portion "depends on
#590" — that's now `#593`/`#594`, both closed, so `#591` may be fully
unblocked rather than partially blocked as originally scoped. Verify
against the actual current state of `consent.service.js`/
`patient.service.js` rather than trusting the old dependency note
verbatim.

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
  allow-list duplication itself (not just the two fields this sitting
  added to both copies) — still open, still worth a dedicated fix.
- Skills-pack [`#297`](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/297)
  (no graceful loop exit) — still open, needs the harness team.
- Skills-pack [`#294`](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/294)
  (blocked-item-skip dogfood) — still open, still no organic case.
- pack-repo `#279`/`#280`/`#281`/`#283`/`#248`/`#270`/`#286`,
  `#301` — unchanged, not checked this session.
