# HANDOFF

**Written:** 2026-08-21, continuing the same rabbit hole under Dennis's
"Continue rabbit hole" instruction this sitting. Docker is on.

## Rabbit-hole state: STILL INSIDE #646 -- #696's own sub-chain is now fully resolved -- other #646 members remain queued

**Tracker: #646** (Wave 3 kickoff -- RF014/015/016/017/024/025/026/029).
Last sitting's blocker, **#706**, needed Dennis's design call on whether
`createCondition`'s all-or-nothing gate is RF005 AC#4's intended reading
for a multi-coding Condition. This sitting got that answer (confirmed:
all-or-nothing is intentional, corroborated by `canonical-data-contract-
v1.md`'s own #690 landing note, written before #698 or #706 existed),
then found and fixed the actual remaining blocker underneath it -- #698
(OMIM code format mismatch) -- and **closed all three: #706, #698, #696**.
#696's entire real-backend Playwright proof now passes.

**#646 itself stays open** -- #696 was one queue member among several
(RF014/015/016/017/024/025/026/029 still queued/unstarted), not the whole
tracker.

## What landed this sitting

- **#706 resolved (no code change of its own, closed with regression
  coverage):** confirmed via `docs/architecture/canonical-data-contract-
  v1.md:1057-1067` (the actively-maintained contract, not an archived
  snapshot) that `createCondition`'s all-or-nothing gate was documented
  as intentional when #690 landed -- months before #698 or #706 existed.
  Added a short addendum to `condition.service.js`'s own comment citing
  this, plus a dedicated regression test in `condition.service.test.js`
  (`#706: rejects the whole write when one of several codings is
  invalid...`) locking in the behavior.

- **#698 fixed and merged** (`fix/698-omim-prefix-mismatch` ->
  `8cc786fe`, fix commit `67f1b8fc`): `intakeWizard.js#buildClinicalData`
  passed the wizard's always-prefixed `OMIM:<digits>` straight into
  `conditionCoding` with no stripping, unlike `buildPharmacologyData`'s
  `atcCode`, which already strips `^ATC:/i`. Applied the same fix to
  `omimCode`. Reproduced red first (new unit test in
  `intakeWizard.clinicalEntities.test.js`), confirmed fail, then fixed.
  Un-weakened every #698-pinned assertion: the new unit test, plus
  `tests/e2e/intake-wizard.spec.ts`'s `conditions`/OMIM assertions
  (previously asserting the buggy silent-drop behavior, now asserting
  the OMIM coding is present in RF028's bare-digit format).

- **#696 closed:** with #698 fixed, all three condition codings (ORPHA/
  ICD-10/OMIM) resolve active, so `createCondition` succeeds and every
  downstream assertion passes. Verified live: `npm run test:e2e:docker
  -- tests/e2e/intake-wizard.spec.ts` -- all 6 tests in the file pass,
  including the sibling "Participant identity segregation" describe
  block (regression check). #696 needed no code change of its own; it
  was blocked in sequence by #699/#701/#703/#704/#705/#698/#706, all now
  resolved.

- **Gotcha hit and already-documented, not newly discovered:** the first
  post-fix live run still showed the pre-fix OMIM error -- `backend-app-
  test` is `build:`-only (`compose.test.yml`, `Dockerfile.dev`, no
  source bind mount), so a backend source edit needs a targeted rebuild
  (`docker compose --env-file .env.test.example -f compose.test.yml up
  -d --build --wait backend-app-test`) before it's live. Already recorded
  in `docker-workflow`'s `local-env/bioavanced-v2.md` ("`backend-app-test`
  has the identical build-not-mount shape as `frontend-app-test`") --
  followed it, no skill update needed.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed to origin at
  `8cc786fe`. Clean tree except the pre-existing untracked
  `.claude/skills/`/`api/backend/storage/assays/` (unrelated, not
  touched this sitting).
- No PR to `main` exists. `main` stays frozen per this repo's convention.
- `fix/698-omim-prefix-mismatch` merged, deleted both local and remote.
- **Docker: UP.** Same stack, `backend-app-test` rebuilt this sitting
  (now serving the #698 fix). Deliberately **not** torn down -- #646's
  remaining queue members may still want it, and tearing down a stack
  this session didn't start is a judgment call for whoever picks up next
  based on what they're doing, not a default.

## Recommended next steps

**None queued by Dennis explicitly for #646's remaining members.**
#696/#706/#698's whole sub-chain is done. The natural #646 queue pick,
per the previous sitting's own note (not re-verified this sitting):
**#674** (RF029 slice 6/6), last known blocked on RF027/Wave 4 -- check
whether that's unblocked before picking. Same discipline as every prior
slice: branch first, re-invoke the routed skill via the Skill tool per
issue number before closing anything.

Rabbit-hole budget: prior sittings already totaled ~12/10 (over the
advisory budget) before this one started. This sitting added #706
(~2pts, design confirmation + regression test) + #698 (~5pts, fix +
2 new tests + e2e rewrite + Docker rebuild + live verify) + #696 (~1pt,
verification-only close) = ~8 more points, cumulative well past budget.
This is a natural stopping point (a full sub-chain closed clean), not
just a budget cutoff -- but worth flagging to Dennis if the next sitting
is expected to keep going deep into #646 rather than wrapping the
tracker soon.
