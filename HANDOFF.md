# HANDOFF

**Written 2026-09-08, twenty-ninth queue sitting. INTERIM — Dennis gave no
end signal, so treat the session as CONTINUING.** He asked to read the
handoff, pick the next *group* of issues, and said Docker is on. I took the
**unauthenticated e-consent attack surface**: **#823** and **#832**, which
cross-reference each other and share one root — six routes on
`src/routes/eConsent.js` that carry no `authenticate`, because the emailed
token *is* the credential.

## What shipped

Branch `feature/docker-e2e-backend-integration`, tree clean and matching
origin. `main` untouched and still frozen.

| commit | issue | what |
|---|---|---|
| `c52254dc` | **Fixes #823** | both consent-token handlers answer every failure with one opaque 400, no `message` |
| `308e09d2` | Refs **#832** | `consentLimiter` on all six unauthenticated e-consent routes, with its own isolated opt-in |

**Closed: #823.** **Filed: #1127** (project), pack **#856**, **#857**,
**#858**, plus recurrence/instance comments on pack **#648** and project
**#1060**. Query the tracker for state — `gh issue list --state open`.

## Gates

- **Targeted native, per iteration.** `[ran it]` #823: 12 consumer files /
  466 tests. #832: **76 consumer files / 1187 tests**. `npm run
  test:architecture` **131/131**, twice. All exit 0.
- **Full native backend suite: GREEN.** `[ran it]` **470 files / 8852
  tests**, 0 failures, exit 0, **621.24s** — the sanctioned form
  `npx vitest run tests/unit tests/integration tests/compliance
  --reporter=dot` from `api/backend`, backgrounded per the 600s ceiling.
  This covers the whole tree at `308e09d2`, so it supersedes the previous
  handoff's caveat that five commits had landed since the last full run.
  Note the duration is at the top of the 569-615s range the conventions
  record and now exceeds the Bash ceiling outright; `import` alone was
  386s of it.
- **Frontend suite NOT run** — this sitting touched no frontend file.
- **Docker e2e NOT run.** Docker Desktop is ON; no stack up, no volumes,
  bootstrap NONE.
- **`node scripts/test-smoke.js` does NOT apply to this sitting's second
  commit** — `[ran it]` it refuses at **260 affected files**, because
  `app.js`/`env.js` are imported by nearly everything. That is the correct
  answer for a central module, not a stale base ref. Its refusal message
  tells you to run `npm run test:unit`, which is a bare `vitest run` that
  `full-suite-guard` blocks — reported upstream.

## Read this before the next Docker gate

**`308e09d2` adds a new env var, and your existing `.env.docker` did not
have it.** `[ran it]` `CONSENT_RATE_LIMIT_RELAXED` is in
`.env.docker.example`; the live gitignored `.env.docker` on this machine
(dated Aug 20) carried only `AUTH_RATE_LIMIT_RELAXED`. **I appended the line
to the local file** — that is machine-local state only, `git status` stayed
clean, and it is a workaround rather than a fix.

Without it `consentLimiter` runs at 10/min instead of 100/min and
`participant-e-consent-page.spec.ts` can **429 partway through a Docker e2e
run** — the exact symptom #350 recorded for `authLimiter`. `[not
established]` whether that spec actually exceeds 10/min; no gate has run.
This is a fresh instance of open **#1060**, commented there.

## Things a next session must not undo

1. **The four `patient.service.js` throws stay distinct on purpose.**
   #823's fix is at the *controller*, which is the disclosure boundary; the
   service's distinct messages are useful to authenticated callers and to
   the log, and four `patient.service.*` tests pin them. Do not "finish the
   job" by collapsing them in the service.
2. **`consentLimiter` is mounted on four path PREFIXES, not on
   `/api/e-consent`.** The rest of that router is `authenticate`-gated
   operator surface; putting it behind a participant budget would 429 a
   coordinator doing bulk consent work. A CONTROL case pins this.
3. **`CONSENT_RATE_LIMIT_RELAXED` is deliberately separate from
   `AUTH_RATE_LIMIT_RELAXED`**, per the repo's own thrice-stated
   isolated-opt-in doctrine (RNF008.6/#359). A test pins that the auth flag
   does *not* relax it — without that pin, wiring them together passes
   everything else.

## The judgment a query cannot carry

- **#832 stays open for its items 2 and 3, which are genuinely Denise's.**
  Item 2, token reuse: `[read it]` `POST /update` never invalidates the JWT,
  so a link is replayable for its full lifetime — **two hours**,
  `CONSENT_EXPIRATION` at `eConsent.js:13` — and `[read it]` each replay
  runs `consent.service.js:839-843`'s
  `updateMany({participantId, status:'ACTIVE'}, {status:'REVOKED'})`, so it
  revokes the prior manifestation and writes a new one. Whether that is the
  feature or a defect is a question about what a Consent *means*. Item 3 is
  `CONSENT_SECRET`'s production posture, unestablishable from the repo
  (no deployment, #362/#682).
- **#1074 and #1089 are NOT fresh work, whatever a backlog scan suggests.**
  Both were worked to their owner-decision boundary before this sitting —
  #1074's shippable half shipped in `58779c2c`; #1089 carries a complete
  pre-deferral analysis ending in four dictionary-level questions. The
  previous handoff recommended #1089 as needing someone and cost me a full
  re-derivation cycle; reported upstream. **Read an issue's comments before
  picking it up.**
- **#823's body claim "no rate limiting anywhere in the backend" was false
  when written**, and the reason generalises: its sweep was scoped to
  `api/backend/src`, and the limiters live in `api/backend/app.js`, which is
  **not** under `src/`. Corrected on the issue.
- **#1127 is the one finding I filed and did not work.** An infrastructure
  failure inside the consent-token check (a Mongo outage under
  `getPatientsCollection`) reaches the same opaque 400 and tells the
  participant their link is invalid — while the controller three lines away
  *deliberately* 503s the analogous template-lookup failure, with a comment
  saying why. Pre-existing; `c52254dc` removed the last accidental signal of
  it. Direction 1 in its body (a marked error class) is the faithful fix and
  is a small change.

## Recommended next

**None queued by name.** Dennis named no specific issue.

1. **#1127** — small, direction settled, and it is this sitting's own debt.
2. **Shipping the integration branch** — still Dennis's call, never yours. The
   backend suite is now green on the whole tree; the **frontend** suite is
   the one that has not run since before the previous sitting.
3. **#1118** remains the live member of the temperature-policy cluster —
   zero comments, two `[not established]` items that look answerable
   natively (whether any consumer needs `sourceEventId` unique per
   notification; whether `docs/docs-7-27-2026/extracted/` states a
   notification cadence).
