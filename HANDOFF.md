# HANDOFF

**Written 2026-08-29. INTERIM — written mid-sitting while two workers were
live and the Docker gate had not yet run.** Everything below is verified as
of writing; re-derive counts rather than trusting them.

A delegating sitting on the e2e/Docker-gate cluster, opened by three
concurrent recon agents. **Recon overturned the premise of three of the four
issues picked.** 1 commit so far, not pushed. 3 issues filed, 3 commented.

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`. **One unpushed commit:
  `a0a091b0`** (the #819 warm-up). `main` untouched, no PR.
- Untracked, deliberately: `.claude/skills/` and `api/backend/storage/assays/`
  — unchanged from session start [ran it].
- **Never `git add -A`.**
- **Nothing was lost in the WSL/Docker cleanup** [ran it] — all three
  `node_modules` trees, `.env.docker` (uncommitted and unrecoverable if it
  had gone), `.env.test.example`, all four compose files, and the Playwright
  browser cache are intact. `docker_data.vhdx` is down to 1.29GB.
- **Docker is at absolute zero** [ran it]: 0 images, 0 containers, 0 volumes,
  0 build cache. The four `bioavanced-test_*` named volumes are gone. **The
  gate is a full cold rebuild of ~30 services.**

## Verification state

- `npm run test:architecture`: **93/93** [ran it], unchanged.
- `npx tsc --noEmit -p tsconfig.json`: clean [ran it].
- `PLAYWRIGHT_SKIP_WEBSERVER=1 npx playwright test --list`: exit 0,
  **219 tests in 20 files** [ran it].
- **The Docker gate has NOT run.** Nothing behavioural has been verified this
  sitting. `a0a091b0` is statically verified only.
- Backend regression not re-run — no `api/backend/src` change has landed yet.

## The cold-volume state is an ADVANTAGE, not a problem

`docker-workflow`'s bioavanced overlay records that a from-scratch run (fresh
volumes, full bootstrap chain) went 199/200, hitting **zero** of the three
"known" failures that a stale-volume stack reproduces. Those were fixture
accumulation. So a failure on this gate is a real regression until shown
otherwise — do not reach for the historical known-failure list.

## Four premises that did not survive contact with the tree

This is now **five in two sittings**, and one of them was this sitting's own.

- **#856 — already built.** `tests/unit/storage.routes.test.js` exists
  (`ad344ed6`) and cites the issue five times. The router has **13** routes,
  not the 4 the body names; the body also omits `DELETE /release/:sampleId`,
  the fourth mutation. Anyone scoping from that list under-builds by
  two-thirds. Commented.
- **#889 — its own `[not established]` settled: no.** Part B is blocked on
  **#828**: neither `backend-app-test` nor `worker-test` declares a
  `volumes:` key [ran it], so the worker cannot see the uploaded file and the
  job never reaches `completed`. Commented.
- **#819 — not "cold stack", "cold route".** The issue's own 2026-08-27
  comment records a failure 215 tests into a run. That kills every
  bring-up-time remedy. Also: the healthcheck probes `/` and Vite serves the
  static shell for every unknown path, so "healthy" means "port open".
  Commented.
- **#890 — mine, and I corrected it.** I filed it claiming `.raw`/generic
  imports set no `importJobID`. True but irrelevant: `processRawFile` and
  `processGenericFile` are **stubs** that write no document at all [ran it].
  The proposed remedy (thread `jobID` through) is a no-op. Retitled to the
  real open question — whether such a job reports itself `completed`.

## Rule this sitting earned

**Grade the inference, not just the observation.** #890 went wrong because
the call-site signatures were verified firsthand and correct — `processRaw`
genuinely is called without `jobID` — and the *consequence* was inferred from
them without reading the callee bodies. A verified premise plus an unverified
inference reads exactly like a verified conclusion. The `[not established]`
marker placed on the right question is the only thing that caught it.

## Open work

Query it: `gh issue list --state open`, and the same with
`--repo DyeAllPies/dyeallpies-skills-pack`.

Judgment a query cannot carry:

- **#891 (new)** — `frontend-app-test` runs a Vite dev server with **no bind
  mount** [ran it], so it pays #819's on-demand compile cost for HMR it
  structurally cannot deliver. Landing it makes #819's warm-up dead weight.
  Two verified hazards keep it separate: `VITE_API_BASE_URL` is a *runtime*
  compose env var that must become a build arg, and
  `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` is dev-server-specific.
- **#888 is Dennis's or Denise's call, not a diagnosis.** Adding storage
  permission codes touches the canonical dictionary, and RF006 (Técnico) vs
  RF017 (Coordenador) disagree on the tier for the same four routes.
- **pack #607 (new)** — `agent-delegation-guard` false-positived on three
  briefs that *forbade* tracker writes; the prohibition text is what matched.
  Cannot be fixed from here: `skill-maintenance` Rule 0 forbids editing pack
  files from a consuming project.
- **#859 closes at the gate.** Both close-criterion specs exist and every
  auth call in them goes through `realLogin` as admin [ran it], so they
  should clear the new role gate.

## Recommended next

Dennis named no next issue, so: **none queued.** What this sitting has left
open, in order:

1. **The Docker gate.** Cold rebuild, ~30 services. It is the only thing that
   can verify `a0a091b0`, and it closes #859.
2. **#856 slice 2** — the four mutations plus `PATCH .../room`. Note the trap:
   `requirePermission`'s test seam has the factory-freeze bug `ad344ed6` fixed
   for `requireRole`, and must be converted to per-request dispatch first.
3. **#890's remaining question** — does a `.raw` import land `completed` or
   `failed` when `results.errors` is non-empty but nothing threw? That decides
   whether the issue survives at all.
