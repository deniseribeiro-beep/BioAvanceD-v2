# HANDOFF

**Written 2026-09-02, third 10-issue queue sitting of the day.** Dennis asked
for "the next group of 10 issues, Docker is on." **5 closed, 5 commits pushed,
8 issues filed (7 here + 1 on the pack) — and the Docker gate ran, green, with
`compose.prod.yml` starting for the first time in this repo's history.**

**INTERIM — the session was not declared over by the user.** It may continue.
Re-derive every count rather than trusting it.

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`, clean and matching origin.
  `main` untouched, no PR.
- Last substantive commit: `96d7361a` (#953's canonical rename).
- **One new npm script:** `migrate:security-config-keys` →
  `api/backend/src/scripts/migrateSecurityConfigCanonicalKeys.js`. Hand-run,
  idempotent, follows the eleven existing `migrate*.js` conventions.
- No new dependencies. No new env vars.

## Docker state — STACK IS UP AND FULLY BOOTSTRAPPED

`compose.test.yml`: **12 core services healthy**, and **bootstrapped** —
`admin-bootstrap-test` plus all 17 reference-data chain services ran against
these volumes and every one is `Exited (0)`. So the next session can run e2e
immediately without paying the ~18-container chain again. `playwright-runner`
was never started; start it or run from the host, not both.

The `bioavanced-prodverify` project used to verify `compose.prod.yml` was torn
down completely (`down --volumes`), as were three throwaway verify images.

## Verification state — all green [ran it]

| Gate | Result |
|---|---|
| security unit + integration (4 files) | 139 / 139 |
| two-hop consumer sweep (`user-security.*`) | 95 / 95 |
| `npm run test:architecture` | 116 / 116 |
| frontend `typecheck`, root `typecheck:e2e` | clean |
| **e2e, live stack, `--workers=1`** | **221 / 221, 1.9m, 0 flaky** |

## What closed (5)

`#946` `#947` `#953` `#954` `#955`. Query the board for the rest
(`gh issue list --state open`); what a query cannot carry is below.

## The judgment a query cannot carry

- **`compose.prod.yml` started for the first time.** `tsa` and `witness` reach
  `Healthy` under the real file, and the TSA issued a granted RFC3161 token
  (`Status: Granted.`, serial `06`→`07`) — **the first this repo has produced**.
  It still cannot come up *from tracked files*, for a **fifth** reason nobody
  had filed: **#965** (seven `${VAR:?}` with no `.env`, and four services take
  the blank tracked `.env.production.example` as their live `env_file`).
  **#948 is now blocked on #965, not on #955.**
- **Three premises this sitting overturned, all `[ran it]`:**
  - **#955's npm leg was FALSE.** `npm run` works fine under `read_only` with
    an unwritable `$HOME`. That leg was never a bring-up blocker.
  - **#956's premise is inverted.** `useSensors.ts:48` hardcodes
    `const TEMPERATURE_READING_DISABLED = true`, so the "success: N/A °C"
    message never fires and the bad audit row is unreachable from the UI.
  - **#958's "role expiry revokes" is wrong.** `middleware/auth.js:145-152`
    returns 403 per request; the session row is never written. That is the
    repo's *pattern*, and it is what settles #649.
- **#649 is much narrower than it claims.** RNF021 AC#2 enumerates four
  revocation triggers and a policy change is not among them; `criticalPaths`
  **[ran it]** originates in "Initial commit" and has never been a decision.
  Only two one-line questions are genuinely Denise's — see the issue.
- **#914's central question is answered from the corpus.**
  `timeoutMinutes → inactivityTimeoutMs` is **documented** (dict-02 P1X-0262
  says "Deve derivar de SecurityConfiguration"). `maxSessionDurationHours` is
  an **absolute cap that does not exist yet** — inferred, not cited. And
  `rotateSessionTokens` slides the refresh window with no ceiling, so RNF021's
  "duração limitada" is unsatisfied independently of the config being inert.
- **#953 was on the critical path of #914/#649/#952 and that was recorded
  nowhere.** It has landed, so those are unblocked — but their quoted greps
  now need the new spelling.
- **Three issues are one missing call site.** #958 (password), #649 (policy),
  #963 (admin MFA reset) all need `invalidateUserSessions`, which has zero
  production callers. **#963 is the only one not blocked on #914.** Whichever
  lands first should own the wiring.

## Filed this sitting (8)

Here: **#959 #960 #961 #962 #963 #964 #965**. On the pack: **#658**.

**Read #959 first** if you touch audit: the sealing path is reachable only via
a bare `setTimeout` to 02:30 UTC, with three further blockers behind it.

## Conventions this sitting relied on / established

- **Verify the premise — it paid on three of ten, and all three were
  inversions.** Two came from `[read it]` traces that were never run.
- **A throwaway `docker run` answers a compose question far cheaper than a
  bring-up.** Every leg of #955 was settled with a 5-line image and
  `--read-only` before any stack came up. But **make the throwaway faithful**:
  omitting `USER app` from an nginx stand-in produced a `chown` failure the
  real image does not have.
- **`.dockerignore` and Dockerfiles arrive CRLF here** (`core.autocrlf=true`,
  `.gitattributes` protects only `*.sh`). A string-anchored edit via Bash/node
  silently matches zero times — normalise before matching.
- **A `Fixes #N` keyword never auto-closes on this branch** (main-only, #599).
  Every close is manual. #946 sat open for a day because of exactly this.
- **`gh issue create --body-file` with a quoted heredoc still failed** on
  ordinary Markdown prose; the `Write` tool is the reliable transport.

## Recommended next

**None queued** — Dennis named no task beyond the 10.

If the session continues, the stack is hot and bootstrapped, so the cheapest
wins are **#963** (buildable now, not blocked, ~one call plus fixtures that
must assert `updateMany` — the existing mocks lack it and would go green while
revoking nothing) and **#964**'s Group B (four `cleanup`/`clean` entries whose
target `0daee9da` deleted on purpose).
