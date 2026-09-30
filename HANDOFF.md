# HANDOFF

**Written 2026-09-30, seventy-second queue sitting. INTERIM: the sitting ran
its end sequence (audit, suite, push, issues, clean-up), but Dennis has not
said it is over.**

The instruction was "Read handoff. Pick next group of issues to resolve and
begin. Docker is on. We haven't tested docker with the updated workflow, so
remember full testing only in end of session." The group picked was
**#1238**, then the session chain **#1005 → #1020**, plus **#1239**, which
#1005 surfaced.

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive
commit is `09fa4166`.

## What shipped (all closed with comments)

- **#1238** (`ddcac10c`): two unit files paid the cold module-graph load
  (import-worker 2.4 s, server.js 4.2 s in plain node) inside their first
  test. They now warm it in a `beforeAll`. The suite-wide duration sweep
  found nothing else near its timeout (numbers are on the issue).
- **#1005** (`0e778147`, `fe4b6b1f`): `GET /api/logs/sessions` is the audit
  read path over every user's sessions, revoked ones included.
  - Access: `requireAuditReader`.
  - LGPD: pseudonymised owner and actor, masked IP, no `sessionID` (it
    embeds the raw user id).
  - Seven `sessions` lookup indexes, chosen on the planner. The per-request
    `tokenHash` lookup was a collection scan.
  - The session panel is on the Logs page.
- **#1239** (`fe4b6b1f`): the Logs screen, its nav entry and the route map
  now follow the backend's admin-or-auditor rule. The new
  `user.isAuditReader` is in the login and verify payloads.
- **#1020** (`30e99b55`, `fa9b898f`):
  - Every session revocation writes an audit row from inside
    `session.service`. The reason goes in `message` and the owner pseudonym
    in `resourceId`.
  - `POST /api/users/:id/revoke-sessions` (new `revokeSessions`
    permission) gives `risk` a writer, and the admin button for it is on
    System Management.
- `09fa4166`: the `logs/` gitignore patterns no longer swallow source
  directories named `logs/`.

## Test runs this sitting

All at `09fa4166` unless noted.

| run | scope | result | time |
|---|---|---|---|
| backend vitest, `tests/unit tests/integration tests/compliance`, JSON reporter | full | 487 files, 9358/9358 | 637 s |
| frontend vitest, the seven `src/` test dirs, `resources.cjs run --width 3` | full | 37 files, 329/329 | 30.5 s |
| backend `node --test "tests/architecture/**/*.arch.test.js"` | full | 161/162, **1 red → #1242** | 44.6 s |
| `compose build`, then stack + admin bootstrap + 17-service chain, all `--no-deps` | full | all one-shots `Exited (0)` | build 163 s |
| in-container `playwright-runner`, `compose run -d --no-deps --name`, `docker wait`, `docker logs` | full | **258/258**, 0 flaky, 1 worker | 135 s |

No suite was skipped: the diff touched backend, frontend and e2e.
Per-fix targeted runs are in the commit messages. This is the first full run
of the updated Docker workflow, and it worked as written (status on #284).

## Filed, carried open

- **#1242 (`suite-red`), first next sitting:** the #1088 filter-keys guard
  flags the new revoke route's inline `buildUserFilterById`. It is a
  one-line fix, and the issue names it.
- **#1240:** no UI grants the `auditor` role (`auditorRole` is API-only).
- **#1241:** security review of the new surfaces (session list, revoke
  route, `isAuditReader`).
- Pack issues: **pack#1447** (full-suite guard false positives), **pack#1448**
  (a 22.5 KB whole-file `cat`), and **pack#1450** (Docker had no load
  sizing, peer check or `resources.cjs` record). pack#1450 carries Dennis's
  correction: it is one general testing approach that every run type falls
  under, and omitting Docker was a slip. All need a pack session (Rule 0).

## Touched, left open

None beyond the filings above. #1222, #1234 and #1227 are unchanged from the
previous note (see their last comments).

## For Dennis

Unchanged from the previous note:
- Milestone #3's stale runner line (#284).
- Whether #1222 merits an upstream report.
- #1225's option call, #1228's default, #1220's step 5, the #941 re-close,
  #1218, #956 and #979.
- Whether `0d87f73b` (#1124) stands.
- Whether to mirror Denise's `docs/` deletions, and #1231.
- The go for a PR into `main`.

## Docker and the machine

- **Gate:** Dennis, 2026-09-30: "Docker is on." It closes at the next `/clear`.
- **Nothing is running.** `compose down` ran. The 6 named volumes and all
  images (built from `09fa4166`'s sources) are kept, and the build cache is
  pruned to 0.
- Empty `logs/` and `api/backend/logs/` may be leftovers of a
  `git check-ignore` control. They are ignored and harmless.
- `resources.cjs` now has BioAvanceD records for `vitest-frontend`,
  `node-test-arch` and `docker-build-test` (~3.4 GB, 15 GB disk). There is
  none yet for the backend suite or the e2e run. Use `suggest` before heavy
  runs (#1249, #1287).

## Things a next session must not undo

Earlier notes' items still hold. Plus:
- **Never emit `sessionID` from an audit or read path.** It is
  `session_<userID>_<ms>`.
- **Session-revocation audit rows keep the reason in `message` and the
  pseudonym in `resourceId`, never in `payload`,** which audit-v2 drops. And
  keep pseudonyms out of `message`: `sanitizeMessage`'s phone regex
  rewrites all-digit ones.
- **No automatic `risk` revocation on login lockout.** It would let anyone
  log the owner out.
- **Don't add an `_id` tiebreak to the session list's sort.** It stops
  `{createdAt:-1}` serving it (measured).

## Standing context: re-measure, don't copy

- Denise's newest live branch, 2026-09-30: `stabilize/v2.0.0-prototype`,
  last commit 2026-09-26
  (`git for-each-ref refs/remotes/origin --sort=-committerdate`).
- Divergence, 2026-09-30: 936 commits on hers only, 225 on ours only
  (`git rev-list --left-right --count origin/stabilize/v2.0.0-prototype...HEAD`),
  measured before this rotation's commit.
- Her tip's CI, runs of 2026-09-26 14:05 (none newer): release manifest
  integrity, Full Vitest diagnostic, Coverage diagnostic and current-state
  validation all passed (`gh run list --branch stabilize/v2.0.0-prototype --limit 4`).
- Her `docs/stabilization/AXIS_E_DECISION_LOG.md` is still unread against the
  issue comments.

## Recommended next

None queued by Dennis. #1242 comes first by rule (suite-red).
