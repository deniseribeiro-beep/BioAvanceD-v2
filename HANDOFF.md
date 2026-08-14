# HANDOFF

**Written:** 2026-08-14, end of `#588` iteration on
`feature/docker-e2e-backend-integration`. **Still inside a rabbit hole —
not a session end.**

## Rabbit-hole state: STILL INSIDE

Dogfooding the new `rabbit-hole` skill for the first time. Seed `#578`
(RF021, too big for one sitting — ~15-19 points against the skill's
~10-point budget, confirmed with Dennis via `AskUserQuestion`).

- **Tracker:** [`#587`](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/587)
  — split via `divide-and-conquer` into `#588`-`#592`.
- **Budget spent so far this sitting: ~2-3 points** (`#588` closed,
  medium-sized).
- **Queue remaining:** `#589` (protocol-versioning design decision),
  `#590` (study↔consent↔participant linkage) — either order, both
  independent — then `#591` (inactive-protocol enforcement, depends on
  `#590` for its consent-side portion), then `#592` (e2e coverage,
  depends on `#588`✓/`#590`/`#591`).

### `#588` — CLOSED this iteration

Routed to `build-loop`. Ground-truth check against
`dict-02_DICIONARIO.md` found the issue's own title/premise wrong —
CAAE isn't a Protocol field, it's `Study.ethicsApprovalId` (ELM-0060);
the validity-period field is `Protocol.effectivePeriod` (ELM-0072).
Corrected via a comment on `#588` before implementing (don't re-litigate
this if `#578`'s original wording resurfaces elsewhere in the tracker).

Implemented: `StudyModel.ethicsApprovalId` (required, non-empty string
array) and `ProtocolModel.effectivePeriod` (required `{start, end}`,
`start` required valid date, `end` optional/open-ended, must not precede
`start`). Both go through the shared `createMasterDataRouter` factory
(`api/backend/src/interface/routes/master-data.routes.js`) — no route
code needed changing, only the models. Unit coverage: 17/17 new tests in
`api/backend/tests/unit/models/studyProtocolModels.test.js` (dedicated
file — the existing `masterDataModels.test.js` table-driven pattern
doesn't fit Study/Protocol's shape). Updated
`tests/e2e/study-protocol-collection-crud.spec.ts` and
`tests/e2e/helpers/seedParticipant.ts`'s `seedStudy`/`seedProtocol` so
the new required fields don't break existing e2e fixtures (not run live
this iteration — no Docker; native unit coverage was the proof bar per
the build-loop overlay for a backend-internal model slice, not one of
the milestone's own e2e specs).

Merged: `6d484bed` / merge `28f93db8` on
`feature/docker-e2e-backend-integration`. Closed with the merge hash
noted on the issue. Branch `test/588-protocol-caae-validity-period`
deleted locally and remotely after merge.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed at `28f93db8`,
  working tree clean. Carries this session's rabbit-hole-skill-install
  commit (`f18dfca9`) and `#588`'s merge on top of the prior handoff's
  `d42fa72b`. **Still not merged to `main` — no PR opened.**
- Docker/CI gate hasn't run this session (native-only, per build-loop's
  backend-internal-slice proof bar) — still owed at ship time per
  `ship-integration-branch`, same standing note as every prior handoff.
- Issues this session (cumulative): `#587` (tracker), `#588` (closed),
  `#589`-`#592` (open, queued), `dyeallpies-skills-pack#308` (Stop-hook
  checkpoint gap for backgrounded `Agent`-tool waits).

## Recommended next steps

**Resume inside the rabbit hole** if continuing this sitting — pick
`#589` or `#590` next (both independent, no ordering preference), route
each through `work-issue`'s classification same as `#588` was. Re-derive
tracker `#587`'s membership before popping (a mid-run split could add a
member). Budget allows roughly one more medium item or a small one
before the ~10-point sitting guidance is reached — Dennis should confirm
whether to continue this sitting or pick it up later.

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
