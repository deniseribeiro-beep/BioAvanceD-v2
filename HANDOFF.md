# HANDOFF

**Written:** 2026-08-14, end of `#589` iteration on
`feature/docker-e2e-backend-integration`. **Still inside a rabbit hole —
not a session end.**

## Rabbit-hole state: STILL INSIDE

Dogfooding the new `rabbit-hole` skill for the first time. Seed `#578`
(RF021, too big for one sitting — confirmed with Dennis via
`AskUserQuestion` up front).

- **Tracker:** [`#587`](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/587)
  — split via `divide-and-conquer` into `#588`-`#592`.
- **Budget spent so far this sitting: ~3-4 points** (`#588` medium,
  closed; `#589` small/decision-only, closed).
- **Queue remaining:** `#590` (study↔consent↔participant linkage,
  large — the next natural pick), then `#591` (inactive-protocol
  enforcement, depends on `#590` for its consent-side portion), then
  `#592` (e2e coverage, depends on `#588`✓/`#590`/`#591`).

### `#588` and `#589` — CLOSED this sitting

- **`#588`**: Study.ethicsApprovalId + Protocol.effectivePeriod, built
  and unit-tested (17/17). Field placement corrected against
  dict-02_DICIONARIO.md before implementing — see prior handoff entries
  or the issue's own comment thread for the full reasoning. Merged
  `6d484bed` / `28f93db8`.
- **`#589`**: design decision, not a build. Checked whether Protocol
  needs a real version-history mechanism (like ConsentTemplate's
  `versionGroupId`/`previousConsentTemplateId`, P1X-0365/P1X-0366) or
  should stay a plain `protocolVersion` string (ELM-0071). **Decided:
  plain string is correct** — the dictionary defines no supersession
  pair for Protocol specifically, unlike ConsentTemplate, and ELM-0071's
  own definition ("Versão formal controlada", matching FHIR
  `PlanDefinition.version`) is a single-value field by design. No code
  behavior changed — only a comment recorded in `Protocol.js` explaining
  the decision and dictionary evidence, so a future session doesn't
  reintroduce a supersession pair on the ConsentTemplate precedent
  without a matching dictionary entry. Merged `24988100` / `e7e6a50c`.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed at `e7e6a50c`,
  working tree clean. Carries this sitting's rabbit-hole-skill-install
  commit, `#588`'s merge, and `#589`'s merge on top of the prior
  handoff's `d42fa72b`. **Still not merged to `main` — no PR opened.**
- Docker/CI gate hasn't run this sitting (both iterations were
  native-provable per their own bar) — still owed at ship time.
- Issues this sitting (cumulative): `#587` (tracker, open), `#588`
  (closed), `#589` (closed), `#590`-`#592` (open, queued),
  `dyeallpies-skills-pack#308` (Stop-hook checkpoint gap for
  backgrounded `Agent`-tool waits — filed, not yet fixed).

## Recommended next steps

**Resume inside the rabbit hole** if continuing this sitting — `#590`
(study↔consent↔participant linkage) is next: add `studyId` to
`ConsentTemplate`/consent creation and to `Patient`/`ParticipantIdentity`
linkage, matching the pattern `Sample.js` already uses for
`studyId`/`protocolId`. Sized "large" (~5 points) in the original
tracker estimate — likely the point at which this sitting's ~10-point
budget runs out; check with Dennis before continuing past it rather than
assuming. Re-derive tracker `#587`'s membership before popping (a
mid-run split could add a member).

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
- Skills-pack [`#297`](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/297)
  (no graceful loop exit) — still open, needs the harness team.
- Skills-pack [`#294`](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/294)
  (blocked-item-skip dogfood) — still open, still no organic case.
- pack-repo `#279`/`#280`/`#281`/`#283`/`#248`/`#270`/`#286`,
  `#301` — unchanged, not checked this session.
