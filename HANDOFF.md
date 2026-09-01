# HANDOFF

**INTERIM — written 2026-09-01 mid-sitting, session CONTINUING.** Dennis
asked for 10 issues with Docker ON. All 10 are worked; the Docker gate has
not run yet. This file will be rewritten when the sitting actually ends.
Re-derive every count rather than trusting it.

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`. **Not yet pushed** — 11
  commits ahead of origin as of writing. `main` untouched, no PR.
- **Tree fully clean.** The standing "never `git add -A`, `api/backend/
  storage/assays/` is deliberately untracked" warning that several handoffs
  carried is **retired**: #927 gitignored the runtime `storage/` and
  `uploads/` trees, which is what that warning was working around. Only
  `api/backend/src/storage/results/` had ever been ignored, and #893 moved
  results out of it — so the ignore had to follow anyway.
  - One file under `api/backend/storage/samples/` is genuinely tracked (a
    committed PDF) and stays that way; a gitignore rule does not untrack.
- Last substantive commit: `09f41b42` (#888).
- No new dependencies.

## Docker state

**Engine reachable (28.5.1). Stack DOWN, no containers, volumes dropped by a
previous sitting. 24 `bioavanced-test-*` images present.**

The gate still needs the **full bootstrap chain**: the 12-service core `up
-d --wait`, then `admin-bootstrap-test`, then the 17 reference-data one-shots
(`docker-workflow`'s bioavanced overlay has the exact recipe). Verify
one-shots via `docker ps -a` for `Exited (0)`, not the compose exit code.
Run the suite `--workers=1`.

**`frontend-app-test` will rebuild from a different Dockerfile this time** —
see "Carried risk".

## What the sitting did

**Closed:** `#659 #905 #918 #922` and, pending the regression's confirmation,
`#888 #910`. **Filed 7:** `#923 #924 #925 #926 #927` (product) and pack
`#637 #638`.

**Left open on purpose:** `#891 #819 #893` — all three are fixed in code but
their proof is a Docker run (`fix-bugs`' deferred-evidence exception).
`#921` stays open because most of its 228 sites are still unpinned.

Read each issue's comment for the evidence; don't re-derive from this file.

## Carried risk — read before the next Docker gate

- **`frontend-app-test` now builds `frontend/Dockerfile.prod --target
  preview` and runs `vite preview`, not `vite dev`** (`1bef5be6`, #891/#819).
  Verified natively that `vite preview` serves deep lazy routes with SPA
  history fallback — `/`, `/samples/<oid>/label`, `/import/quarantine` and a
  hashed asset all 200 **[ran it]**. Everything else about it is unverified:
  the image build itself, its cost, and whether the e2e suite is actually
  greener. **The `global-setup.ts` warm-up is deliberately still ON** — do not
  retire it until this gate is green.
- **`compose.prod.yml` gained three volume mounts and
  `api/backend/Dockerfile.prod` a `/data` chown** (`092c4f52`, #893).
  **Unverified [not established]**: that a named volume mounted at `/data/*`
  is writable by the non-root `app` user. Docker copies the image path's
  ownership onto a fresh volume, which is *why* the chown is there — but that
  reasoning has not been run. Probe it first:
  `exec backend node -e "require('fs').mkdirSync('/data/uploads/probe',{recursive:true})"`.
- **`#888` added two permission codes to the RBAC catalog (24 -> 26).** The
  boot seed writes them, and #916's boot path is still itself unexercised
  against a live start-up. Watch for `🔑 Catálogo RBAC garantido: ... 26
  permissões` in the backend log.
- **`#910` narrowed three `/api/results` read routes.** Any e2e spec reading
  results as a non-Administrador principal will now be scoped. That is the
  intended behaviour, but it is a behaviour change an e2e failure could
  legitimately surface.

## Judgment a query cannot carry

Query the board (`gh issue list --state open`, same with `--repo
DyeAllPies/dyeallpies-skills-pack`). What the query won't tell you:

- **#923 is the sharpest new finding.** `POST /storage/move`, `/allocate` and
  `DELETE /release` call `withTransaction` against a guard that only detects
  a *mock*, and only `compose.test.yml`'s mongo is a replica set — so those
  three endpoints cannot work on dev or prod. **[not established]** by a live
  request; that single request is the whole confirmation and is one command
  at the gate. #918 shipped the topology probe that fixes this class; #923
  should lift it into the shared helper rather than write a third copy.
- **#926 is now two confirmed instances plus three clean routers**, so the
  arch guard it proposes is worth more than the two edits. The rule to encode:
  only same-method, same-segment-count routes can collide.
- **#921's numbers were wrong by 4.3x** — 228 sites, not 53; ~4 pinned, not
  ~13. Five routers are now pinned (~80 sites). Every slice so far found a
  real defect, so budget the rest as fix-work, not coverage.
- **#915 and #892 were deliberately excluded from this queue** — #915's own
  body sequences it after #800, and #892's item 1 is parked behind #884.
  Both are blocked on owner decisions, not on work.
- **#902/#884/#881/#903/#908/#909** remain prior sittings' decisions.

## Conventions this sitting relied on / established

- **A `git grep` pattern with a leading `/` is MSYS path-mangled on this
  machine** — silent under-match, exit 0. `git grep -E "/label|SampleLabel"`
  returned 10 hits where `"[/]label|SampleLabel"` returned 19, in one file.
  It defeated both #659's original evidence and my re-verification of it.
  Bracket the slash. Pack **#637**.
- **`full-suite-guard`'s sanctioned frontend whole-suite command cannot
  work** — vitest positional args are filters, not globs, and the hook blocks
  the only alternative it names. What works: `npx vitest run src/components
  src/contexts src/foundation src/hooks src/pages src/utils src/views`. Pack
  **#638**.
- **Arch-guard exemptions travel with any change that moves them**, again:
  `filter-keys.arch.test.js`'s three `result.routes.js` entries were re-keyed
  **twice** in this one sitting (137/384/543 -> 177/440/599). The gate caught
  it both times; nothing else would have.
- **Three distinct mechanisms produce a vacuous gate test**, and no single
  guard catches all three: an argument-discarding stub (#888), an empty db
  mock (#913), and — new — a proxy that calls the middleware factory once at
  require time so the seam is structurally inert (`sample.routes.test.js`,
  fixed in `b96bbc69`).
- **`requirePermission`'s `allowedActions` is derived from the HTTP verb**
  (`METHOD_TO_ACTION`, `rbac.js:82`), not chosen. A code whose `allowedActions`
  omits the verb's derived action denies every request to that route.

## Recommended next

**None queued** — Dennis named no task beyond the 10.

The immediate next step inside this sitting is the **Docker gate**, which is
what closes #891, #819 and #893 and what confirms #923.
