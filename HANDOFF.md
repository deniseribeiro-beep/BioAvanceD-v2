# HANDOFF

**Written 2026-09-02, second 10-issue queue sitting of the day.** Dennis
asked for "the next 10 issues, Docker is on." **3 closed, 6 driven forward
and left open, 6 issues filed here plus 1 on the pack, 5 commits pushed —
and the Docker/e2e gate ran green for the first time on this branch's
recent work.**

**INTERIM — the session was not declared over by the user.** It may
continue. Re-derive every count rather than trusting it.

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`, clean and matching
  origin. `main` untouched, no PR.
- Last substantive commit: `db552f74`.
- **One new env var:** `RESTORE_SCRATCH_DIR`, declared in
  `api/backend/src/config/env.js` and documented in
  `.env.production.example`. Optional; defaults to
  `<BACKUP_DIR>/.restore-scratch`.
- No new dependencies.

## Verification state — all green

| Gate | Result |
|---|---|
| backend `tests/unit tests/integration tests/compliance` | **455 files / 8284 tests, 0 failed** [ran it] |
| `npm run test:architecture` | **116 / 116** [ran it] |
| `npm --prefix frontend run typecheck:full` | clean [ran it] |
| **e2e, live Docker stack, `--workers=1`** | **221 / 221 passed, 2.0m, 0 flaky** [ran it] |

The full backend suite was the previous sitting's open `[not established]`
item. It is now closed: **8284 passed, zero failures.**

## Docker state — STACK IS UP AND FULLY BOOTSTRAPPED

**Left running deliberately.** 12 core services healthy, **plus** the
complete bootstrap: `admin-bootstrap-test` and all 17 chain services
(`foundation-bootstrap-test` + 16 `reference-data-bootstrap-*`), every one
`Exited (0)`. Volumes were **fresh** at the start of this run, so there is
no fixture accumulation from prior sessions.

A next session can run e2e immediately without re-bootstrapping. If you
tear it down, `docker compose -f compose.test.yml down` (no `-v`) keeps
that state; `down --volumes` costs the whole bootstrap again.

## What closed (3)

`#945` (arch guards read comments as violations — one shared
`stripComments`, and a second **false-negative** defect found in the
divergent copy), `#951` (the last two `startSession` guards), `#949` (the
report detail tables — see below, its premise was inverted).

## Left open, driven forward — the judgment a query cannot carry

Query the board (`gh issue list --state open`). What it will not tell you:

- **#949's premise was BACKWARDS and that is the sitting's most useful
  finding.** It asked whether two "unreachable" surfaces should be deleted.
  `recentReadings` had a live producer all along — `handleTemperature`
  returns `temperatures`, persisted verbatim — so a `temperature` report
  rendered stats and then an **empty** detail section. Same for
  `recentLogs`/`logs`. #940's own commit called it "genuinely dead". Fixed,
  not deleted. **Two prior sessions asserted "no producer" without checking
  the handler's return.**
- **#941 — the index the previous sitting shipped was broken, and that is
  now proven against live Mongo.** The old plain-unique spec fails on the
  real seeded data with `dup key: { sistema: "SPREC", codigo: null }`; the
  new `partialFilterExpression` spec builds. The third writer (the
  essential seed) was never counted. Ten declarations still remain — the
  full BUILD/DELETE disposition table is in the issue.
- **#952 + #761 are ONE decision, and it is Denise's.** dict-02 mandates a
  lockout *duration* at `1..1 Core` **twice** (P1X-0282, P1X-0298), and the
  `UserAccount` entity (P1X-0182–0208, complete) has **no field to store
  when a lock started or ends**. So a *permanent* lock is buildable today
  via `accountStatus='blocked'` (P1X-0193, already enforced at
  `auth.service.js:307`); a *timed* one needs a new canonical element. The
  dictionary contradicts itself and only its author can resolve it. Full
  framing on #952.
- **#649's premise was also wrong** — a full session-revocation mechanism
  exists and is enforced at `middleware/auth.js:91`. The gap is that
  `invalidateUserSessions` has **zero production callers**.
- **#914 — `session.maxSessionDuration` is INERT, not shadow-enforced.**
  There is no absolute session cap *at all*: `rotateSessionTokens` resets
  both expiries on every refresh. That makes the `session` slice new
  behaviour, not a wire-up. dict P1X-0262 mandates the wiring in words.
- **#933 — only direction 2 is live**, and it relaxes a security guard on
  the administrator role. Direction 1 shipped; direction 3 is #761.
  Deliberately not built.
- **#947/#948 are half-fixed and BLOCKED on #955**, not on themselves.

## Filed this sitting (7)

Here: **#953 #954 #955 #956 #957 #958**. On the pack: **#656**.

**Read #955 first.** `compose.prod.yml` **cannot bring the stack up at
all** — `read_only: true` on `tsa`/`witness` against entrypoints that
`mkdir /run/secrets` under `set -eu`, with `backend` gated on both being
healthy. Nothing has ever run this file. It blocks #947, #948 and #954.

**#954 is verified in-container** [ran it]: `openssl-ts.cnf` is never
copied into the TSA image, `openssl ts -reply` fails, `/health` returns
200 anyway, and `audit_timestamp_tokens` is **0 docs after 1456 audit
events**. Note its second comment **corrects the first** — the
`PENDING_TIMESTAMP` mechanism I asserted is not what the data shows, and
what triggers the sealing path at all is now the open question.

**#957 is a consequence of my own fix** and wants Denise's confirmation.

## Conventions this sitting relied on / established

- **Verify the premise. It paid on five of six issues**, and twice the
  premise was the *opposite* of the filed claim (#949, #649). A prior
  session's confident file-and-line trace is not evidence.
- **A comment on another issue is a claim under the same rule as a filed
  one.** I asserted a mechanism on #954 from reading code, checked it
  against the database afterwards, and had to correct myself. Check the
  data before writing the mechanism.
- **Never chain a git mutation with a hook-gated command.** `git rm && npm
  test && npx vitest <bare dir>` — the scope hook blocked the last part and
  killed the `git rm`, and the commit message then claimed a deletion that
  had not happened (`2552916e` → corrected by `db552f74`). This is
  `fix-bugs`' #413 rule; it was in context and I broke it anyway.
- **The two-hop consumer sweep paid again.** A delegated #951 fix ran its 4
  scoped test files green; the sweep found **15**, and
  `test:architecture` went 116→114 on a line-number-pinned exemption the
  worker could not have seen.
- **Research briefs may read the tracker.** I wrote "do not run any `gh`
  command" into three research briefs and two agents returned whole
  sections graded `[not established]` for want of a `gh issue view`. Pack
  #656.

## Recommended next

**None queued** — Dennis named no task beyond the 10.

If the session continues, the strongest are **#955** (it unblocks three
other issues and means production has never started), and **#952/#761**,
which need one answer from Denise before either can move.
