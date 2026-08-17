# HANDOFF

**Written:** 2026-08-17, continuation session (tenth update). Rabbit hole
`#610`/`#585` was exited last rotation. This update covers a follow-on
request: "fix this new issue from this repo," picked up as `#612` (the
newest open issue, filed during the rabbit hole).

## `#612` root-caused and closed — not a reachable production bug

Brought the `compose.test.yml` stack back up specifically to reproduce
this (had just been torn down). Wrote a throwaway repro
(`mockLogin(page)` + `page.goto('/system-management')`, deleted before
finishing — never committed) and confirmed the loop directly: 227 401s
in 15 seconds cycling `/auth/refresh` → `/users` → `/organizations`.

**Mechanism**: `SystemManagementPage` mounts `useUsers()`/`useOrganizations()`,
both 401 against `mockLogin`'s unsigned token → `api.ts`'s interceptor
tries `/auth/refresh` (401) → `terminateSessionAndRedirect()` clears
`localStorage` and does a real `window.location.replace('/login')`. But
`mockLogin`'s `page.addInitScript` reruns on *every* navigation
(Playwright behavior, not app behavior) and re-seeds the same invalid
token — so the freshly-loaded `/login` page's `AuthContext` sees a token
again, `LoginPage`'s own "already authenticated → redirect" effect
bounces the mock Administrador user straight back to
`getPostLoginRoute()` → `/system-management`, and the cycle repeats
forever.

**Why it can't happen to a real user**: confirmed `AuthContext` correctly
handles the equivalent real scenario via the `storage` event (cross-tab
logout sync) and via a genuine reload with actually-cleared
`localStorage` (no `addInitScript` to undo it) — both land on a
correctly-unauthenticated state with no bounce. Closed `#612` with the
full trace and reasoning in the closing comment; no product-code change.

**Follow-up filed**: `#614` — a real, currently-unreachable architectural
gap noticed while tracing this (`AuthContext` never subscribes to the
`auth:logout` event other hooks rely on; only stays consistent today
because the forced-logout path always does a full reload). Flagged for
the owner's judgment, not fixed — not currently reachable.

**Skill lesson added**: third item in the `dyeallpies-skills-pack#330`
thread (still unapplied — junction, needs a pack-repo session) — the
`mockLogin` + `addInitScript`-reruns-on-navigation + role's
`getPostLoginRoute()` trap, so a future session doesn't mistake this
harness artifact for a real backoff bug again.

### Session-end cleanup (done)

- `compose.test.yml` stack (brought back up just for this repro) torn
  down again. No new images built this iteration — builder cache
  already at 0B, nothing to prune.
- Scratchpad logs from this iteration deleted.
- No issue branch to clean up — the throwaway repro spec was deleted
  before any commit; the `fix/612-post-401-retry-loop` branch had zero
  commits and was deleted with no merge needed.

## Repo state

- On `feature/docker-e2e-backend-integration`, clean except the
  gitignored/junctioned `.claude/skills/`. In sync with `origin`
  (`72ae8cf4` — no new commits this iteration beyond issue tracker
  activity).
- Docker: stack torn down, nothing running (`docker ps` empty).

## Recommended next steps

**None queued** — no further task named this sitting.

Backlog candidates, unchanged and unverified: `#602`, `#599`, `#336`,
`test/human-showcase-video`. New from this session: `#614` (AuthContext
`auth:logout` gap, low-priority/owner's-call).
