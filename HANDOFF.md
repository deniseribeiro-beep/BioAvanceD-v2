# HANDOFF

**Written:** 2026-08-17, fresh session. User asked to "read handoff and
pick the next sizable chunk of issues to resolve," Docker on. Routed via
`work-issue` → `#374` (RF028's compose.test.yml wiring, unblocked by
`#371` landing last session) → `divide-and-conquer` assessment (all 16
importers use bundled local fixtures, no live network — judged doable
whole rather than pre-split) → `build-loop`.

## What happened this session

**`#374`** ("Cut compose.test.yml/CI over to the RF028 reference-data-
bootstrap") — **partial progress, issue left open.**

Landed: `compose.test.yml` now has the full 16-source
`reference-data-bootstrap-test*` one-shot chain (HPO → MONDO → ORPHA →
ICD-11 → ICD-10 → OMIM → HGNC → LOINC → UCUM → DCB → ATC → DUO → Uberon
→ NCBI Taxonomy → Cell Ontology → EDAM), each `depends_on` the prior via
`service_completed_successfully`, first one chained after
`foundation-bootstrap-test` (#371). Mirrors `compose.dev.yml`'s
already-working chain exactly. `docker compose config --quiet` validates
cleanly (all `depends_on` references resolve, no cycles).

Merge `11f27c71` on `feature/docker-e2e-backend-integration`, pushed.
Fix branch `test/374-reference-data-bootstrap-test` deleted locally
after merge.

**Not verified against a live stack.** Three `docker compose up -d
--wait <core services>` attempts all failed with `ports are not
available ... 8086` — a Windows Hyper-V/WinNAT port-exclusion range
(`7775–8274`, confirmed via `netsh interface ipv4 show
excludedportrange protocol=tcp`) swallowing `influxdb-test`'s published
port, unrelated to this session's compose edit. `wsl --shutdown`
(user-authorized) did **not** clear it — Docker's engine came back
briefly (reachable via `docker version`) with the exclusion range
byte-identical, then went fully unreachable again
(`dockerDesktopLinuxEngine` pipe not found) and stayed that way for the
rest of the session. User is restarting Docker Desktop after this
session ends; **image cleanup (5 tagged test images:
`bioavanced-test-{witness,tsa,backend-app,frontend-app,worker}-test`,
plus builder cache) is still pending** — couldn't reach the daemon to
run it. Containers/network from the failed attempts were already torn
down (`docker compose down --remove-orphans`, ran before the WSL
restart) — nothing left running.

**"Wire it into CI" bullet: not attempted, traced instead.**
`ci-pipeline.yml`'s `current-state-validation` job never invokes
Playwright/`playwright-runner` at all (independently confirmed by
`dyeallpies-skills-pack#298`); whether it ever will is gated on the
still-open `#585` (revive vs. retire `playwright-runner`). `#371`'s own
precedent already shows "wire into CI" for this milestone's issues
doesn't mean touching `ci-pipeline.yml` — it closed having only touched
`compose.test.yml` + retired a redundant `current-state:ci` step.
RF028 has no analogous dry-run step to retire at all.

Progress comment left on `#374` with all of the above. Issue kept
**open** pending a live-stack verification run (17 RF028 tests in
`pipeline-continuity.spec.ts`).

**Filed to the skills-pack tracker (both from this repo, per Rule 0 —
skill files aren't editable from here):**
- `dyeallpies-skills-pack#321` — new Windows Docker gotcha:
  Hyper-V/WinNAT port-exclusion blocking a `compose.test.yml` published
  port (8086), confirmed `wsl --shutdown` does *not* clear it (untested:
  admin `net stop winnat && net start winnat`, or a reboot).
- `dyeallpies-skills-pack#322` — `build-loop`'s BioAvanceD-v2 overlay
  should note that this milestone's "wire it into CI" bullets aren't
  actionable until `#585` resolves, so future RF-slice sessions don't
  re-investigate the same dead end.

## Repo state

- On `feature/docker-e2e-backend-integration`, clean except the
  gitignored/junctioned `.claude/skills/` (untracked, not part of this
  session's diff). In sync with `origin` (pushed `11f27c71`).
- **Docker: engine currently unreachable** (see above) — user is
  restarting Docker Desktop after this session. Once it's back, still
  need: `docker rmi` the 5 tagged test images listed above, then
  `docker builder prune -af`. No containers running, no named volumes
  touched this session.

## Recommended next steps

None queued — the user hasn't named what's next. Candidates visible in
the backlog, not confirmed direction:
- **`#374`** itself — needs a live-stack verification run once Docker
  cooperates: bring up core services + `admin-bootstrap-test` +
  `foundation-bootstrap-test` + the 16 `reference-data-bootstrap-test*`
  services (targeted, per `docker-workflow`'s recipe — don't retry a
  plain `up -d`), confirm all 17 RF028 tests in
  `pipeline-continuity.spec.ts` pass, then close.
- **Docker image cleanup** (see above) — small, mechanical, blocked only
  on the engine being reachable again.
- **`#601`** — RF011 commit-race finding (still needs an isolated
  confirmation run before anyone attempts a fix; test-bug vs.
  product-bug still open), untouched this session.
- **`#599`** — explicitly flagged in its own body as a repo-owner call
  (widen `ci-pipeline.yml`'s trigger to the integration branch); not
  mine to decide.
- **`#585`** — still Dennis's call (revive vs. retire
  `playwright-runner`), unchanged — also now the blocker for #374's
  CI-wiring bullet specifically (see above).
- **`#336`** — still needs Dennis's call (fix vs. retire the legacy
  `import.controller.js#importFhirBundle` endpoint); `#570` stays
  parked on it, unchanged.
- **`test/human-showcase-video`** — still awaiting Dennis's go to
  show/merge, unchanged.
- Skills-pack `#297`/`#294`/`#315`/`#317`/`#318`/`#321`/`#322` — not
  touched further this session beyond filing `#321`/`#322`.
- pack-repo `#279`/`#280`/`#281`/`#283`/`#248`/`#270`/`#286`/`#301`/
  `#309`/`#310`/`#311`/`#312`/`#313`/`#314` — unchanged, not checked
  this session.
