# HANDOFF

**Written:** 2026-08-14, mid-`rabbit-hole` sitting on tracker `#587`
(RF021 protocol/consent/study linkage, seed `#578`), resumed on Dennis's
explicit instruction ("pick the rabbit hole again"). **Still inside the
hole** — this is not an exit handoff.

## What landed this session (so far)

- **`#591`** — `sample.service.js`'s `createSample` had existence-only
  checks for `studyId`/`protocolId`. Extended to reject when
  `study.studyStatus !== 'active'` or `protocol.approvalStatus !==
  'approved'` (RF021 AC#5). 4 new unit cases in `sample.service.test.js`;
  97/97 passing. Merged `dcb04e6f`. Closed.
- **`#596`** — filed this session from `#591`'s own `wrap-up` audit:
  `consent.service.js`'s `createPatientConsent` and `patient.service.js`'s
  `createPatient` mirrored the same pre-`#591` existence-only `studyId`
  check (landed via `#593`/`#594`), no `studyStatus` gate. Extended both
  to reject with 422 when `studyStatus !== 'active'`. Fixed 2 existing
  `#593`/`#594` "accept" test fixtures that mocked a Study doc with no
  `studyStatus` field (would've false-failed under the new gate — no
  real Study document has that shape, `StudyModel.create` always
  defaults it). Verified `tests/e2e/helpers/seedParticipant.ts`'s
  `seedStudy`/`seedProtocol` e2e fixtures already set
  `studyStatus: 'active'`/`approvalStatus: 'approved'` explicitly, so
  neither this nor `#591`'s gate breaks existing e2e setup. 2 new unit
  cases; 250/250 passing across the 3 targeted files. Merged `3a619f30`.
  Closed.

## Tracker `#587` current membership (re-derived, not from memory)

- `#588`, `#589`, `#590` (+ split children `#593`/`#594`), `#591`,
  `#596` — **all closed**.
- `#592` — **open, not started. Last remaining member.** Real-backend
  e2e coverage for the full enforcement path (protocol + study status
  gates across Sample/Consent/Patient). Its stated dependencies
  (`#588`, `#590`, `#591`, and now `#596`) are all landed — **unblocked**.

**Next step: pick up `#592`.** Re-derive via `gh issue view 587` before
resuming regardless — this file is a snapshot, not the source of truth.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed at `3a619f30`,
  working tree clean. Both fix branches (`fix/591-...`, `fix/596-...`)
  merged `--no-ff` and deleted locally (neither was ever pushed to
  remote, so no remote deletion needed).
- Docker is **on** this session (user confirmed), not yet exercised.
  `#591`/`#596` were both native-provable (no live-Mongo tier in this
  repo; mocked-collection unit tests are the proof bar for
  backend-internal slices per `build-loop`'s BioAvanceD-v2 overlay).
  `#592` is the actual e2e Playwright spec this milestone's Docker-on
  default exists for — first real use of Docker this session.

## Recommended next steps

Continue the `rabbit-hole` sitting: `#592` is the only open member left.
Write a real-backend Playwright spec covering: creating a protocol with
CAAE/validity fields (`#588`), the study/consent/participant linkage
(`#590`/`#593`/`#594`), and the inactive/incompatible-protocol and
inactive-study rejection paths (`#591`/`#596`) — see `#592`'s own body
for its full scope, including the `E2E_TRACEABILITY_PLAN.md` update it
calls for. Confirm Docker is actually running before the first
`docker build`/`up` call (invoke `docker-workflow` fresh, per
`build-loop`'s own instruction — don't assume from "Docker is on" alone).

Once `#592` closes, run the tracker's upward-cascade check: `#587`
closes only when all six split issues (`#588`/`#589`/`#590`/`#591`/
`#592`/`#596`) and anything they spun off are resolved and no further
split is pending — that condition will be met once `#592` lands, nothing
else is outstanding. `#578` (the seed) closes separately per its own
comment, once `#587`'s full membership lands — don't forget that second
close, it doesn't happen automatically.

No other work queued outside this rabbit hole this session — Dennis's
instruction was specifically to resume `#587` and work it without
stopping for questions, filing follow-ups instead (which is how `#596`
came to exist). Carried-forward items from the prior handoff (`#336`,
`#579`/`#331`, `#585`, `#586`, skills-pack backlog) are unchanged and
not re-derived here; see git history for the previous `HANDOFF.md`
revision if needed.
