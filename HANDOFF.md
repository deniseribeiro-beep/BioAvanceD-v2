# HANDOFF

**Written:** 2026-08-14, mid-session on `test/588-protocol-caae-validity-period`
(branched off `feature/docker-e2e-backend-integration`). **Still inside a
rabbit hole — this is not a session end, it's a checkpoint forced by the
Stop hooks mid-task** (see `dyeallpies-skills-pack#308`, filed this
session: the hooks can't tell a legitimate background-agent wait from a
real stop).

## Rabbit-hole state: STILL INSIDE

Dennis asked to find a candidate issue to dogfood the new `rabbit-hole`
skill for the first time. Picked `#578` (RF021: CAAE/validity-period
fields, protocol versioning, consent/study linkage, inactive-protocol
enforcement — all missing), confirmed the ~15-19 point estimate (over
the skill's ~10-point sitting budget) with Dennis via `AskUserQuestion`
before opening anything.

- **Tracker:** [`#587`](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/587)
  — rabbit-hole tracker for seed `#578`.
- **Split via `divide-and-conquer`** into 5 independently-actionable
  issues (comment added to both `#587` and `#578` the moment they were
  filed, per the skill's live-membership rule):
  - `#588` — CAAE + validity-period fields (**in progress**, see below).
  - `#589` — protocol-versioning mechanism design decision. Not started.
  - `#590` — study↔consent↔participant linkage. Not started.
  - `#591` — inactive-protocol enforcement. Depends on `#590` for the
    consent-side portion; the `sample.service.js` portion is
    independently landable. Not started.
  - `#592` — real-backend e2e coverage for the enforcement path.
    Depends on `#588`, `#590`, `#591`. Not started.
- **Budget spent so far this sitting: 0 points** (nothing closed yet;
  `#588` is medium-sized, 2-3 points, once it lands).
- **Queue order:** `#588`/`#589`/`#590` in any order (independent),
  then `#591`, then `#592`.

### `#588` — in progress, not yet implemented

Routed to `build-loop` (spec'd-but-missing capability). Per build-loop's
ground-truth check against `docs/docs-7-27-2026/extracted/
dict-02_DICIONARIO.md` (outranks `docs/architecture/` and, this time,
outranks the parent issue `#578`'s own premise), **the field placement
in `#588`'s original title is wrong and was corrected via a comment on
`#588` before implementing:**

- CAAE does **not** belong on `Protocol`. It's `ethicsApprovalId` on
  **`Study`** (ELM-0060, dict-02_DICIONARIO.md:68 — "Identificador do
  parecer/protocolo ético aplicável", example "CAAE/parecer", type
  `Identifier`, cardinality `1..*`, Core/required). `StudyModel.js`
  doesn't have it yet.
- The validity-period field is `effectivePeriod` on **`Protocol`**
  (ELM-0072, dict-02_DICIONARIO.md:80 — "Vigência do protocolo... período
  em que a versão pode ser utilizada", type `Period`/ISO 8601,
  cardinality `1..1`, Core/required). `ProtocolModel.js` doesn't have it
  yet.
- Separately, `ConsentTemplate`'s own `caae` field (P1X-0367,
  dict-02_DICIONARIO.md:798) is a **different, already-implemented**
  field (`api/backend/src/models/ConsentTemplate.js`) — not part of
  `#588`'s remaining scope. Don't re-add it.

Research done (Explore agent, completed this session): both
`StudyModel`/`ProtocolModel` are validated/created through one shared
factory, `createMasterDataRouter` in
`api/backend/src/interface/routes/master-data.routes.js`, wired for
`/api/studies`/`/api/protocols` in `app.js` (~line 267-276). POST there
calls `model.validate()`/`model.create()`; PUT does not validate. No
existing unit test covers `StudyModel`/`ProtocolModel` directly
(`tests/unit/models/masterDataModels.test.js` covers 4 other models, not
these two); no integration test POSTs to `/api/studies`/`/api/protocols`.
**`tests/e2e/study-protocol-collection-crud.spec.ts` (real-backend,
`#320`/`#326`) will break** once these fields become required — its
generic CRUD loop posts only `{idField, nameField}` today and expects
`201`; it'll need updating to supply `ethicsApprovalId`/`effectivePeriod`
in the same slice. No frontend create/update UI exists for
Study/Protocol (checked, zero matches) — no frontend submit-payload risk.

**Next action:** implement `StudyModel.ethicsApprovalId` (required,
non-empty array of strings) and `ProtocolModel.effectivePeriod`
(required object: `start` required valid date, `end` optional, `end >=
start` when both present) in `Study.js`/`Protocol.js`, update
`study-protocol-collection-crud.spec.ts`'s fixtures to supply both,
write/run the failing-then-passing unit test first per build-loop, then
follow `fix-bugs`' "Ending an iteration" mechanics (commit referencing
`#588`, merge to `feature/docker-e2e-backend-integration`, close with
merge hash, `wrap-up`, rotate this file again per rabbit-hole Step 4 —
"still inside"/"exited" — before popping the next queue item).

## Repo state

- Currently on `test/588-protocol-caae-validity-period`, branched off
  `feature/docker-e2e-backend-integration` at `f18dfca9`. Working tree
  clean — no product code changed yet this branch.
- `feature/docker-e2e-backend-integration` itself: pushed at `f18dfca9`
  (this session added one housekeeping commit installing the
  `rabbit-hole` skill — `.claude/.gitignore`/`.claude/skills-manifest.txt`
  only, no product code). Everything from the prior handoff
  (`d42fa72b`, `#582`/`#583`/`#584`) still applies unchanged. **Still not
  merged to `main` — no PR opened**, unchanged from before.
- Issues filed this session: `BioAvanceD-v2#587` (rabbit-hole tracker),
  `#588`-`#592` (the split), `dyeallpies-skills-pack#308` (Stop-hook
  checkpoint gap for backgrounded `Agent`-tool waits, found live during
  this session's own use of the `Agent` tool).
- New skill installed: `rabbit-hole`, junctioned from the pack, recorded
  in `.claude/skills-manifest.txt`.

## Recommended next steps

**Resume inside the rabbit hole** — this is not a fresh backlog pick.
Continue `#588` per the "Next action" above, then proceed through the
tracker `#587` queue (`#589`, `#590`, `#591`, `#592`), re-deriving
membership before each pop per the skill's rule (a mid-run split could
add another member). Stop and re-surface once the running point total
would exceed the ~10-point sitting budget (Step 5) — likely partway
through, not all 5 in one sitting.

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
