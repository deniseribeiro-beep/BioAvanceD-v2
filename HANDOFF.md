# HANDOFF

**Written 2026-09-07, seventeenth queue sitting. INTERIM — no end signal
was given, so treat the session as CONTINUING.** Dennis asked for "the next
groups of issues, Docker is on." I picked two groups — secrets-at-rest and
the #1053 org-scope children — and **shipped five, filed six**.

**NEITHER GATE RAN THIS SITTING. That is the single most important line
here.** Docker was on and I did not use it. Five substantive commits have
landed since the last green gate at `01791b44`, so the previous handoff's
"both gates green" is now a statement about an older tree, not this one.

What DID run, every iteration:

- **Targeted consumer sets, derived two-hop and run bare** — 71 / 42 / 46 /
  39 / 27 files across the five iterations, all exit 0.
- **`npm run test:architecture` five times — 122/122, exit 0 each time**,
  including after the two commits that shifted arch-guard line keys.
- **Nothing left running.** No container was started; no image was built.

Re-derive all of it rather than trusting this paragraph.

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`, clean and matching
  origin. `main` untouched, no PR. `git status -sb` and `git log` are
  authoritative.
- **Five substantive commits**, last is the `#1074` policy-read gate.
- **One new file:** `api/backend/src/utils/tokenHash.js`.
- **One new env key:** `ALLOW_UNENCRYPTED_FIELD_STORAGE`, documented in both
  shipped templates. No new npm scripts, no new dependencies, no compose
  changes.

## What shipped

Query the board rather than trusting a list: `gh issue list --state open`.

`#1083` `#1084` `#1078` closed. `#1081` and `#1074` had their load-bearing
halves shipped and are **deliberately left open** — each has a comment
saying which half and why the remainder is a decision rather than a defect.

## The judgment a query cannot carry

- **`#1084` did not exist when the sitting started.** Research into #1078
  turned up that `resetPassword`'s "já utilizado" guard is short-circuited
  by its own `&&`: clearing `passwordResetToken` on use is what disables the
  check that refuses a used token, so the same reset JWT was replayable for
  the rest of its 1h–24h life. `[ran it]` Fixed and closed the same sitting.
- **The previous handoff's `#1072` claim was WRONG, and I corrected it on
  the issue.** It recorded the MFA fail-open as being in the login path.
  `[read it]` `processLogin` gates the challenge on `user.mfaEnabled` alone
  — a boolean no encryption touches — so it is **fail-CLOSED**. The real
  fail-open is `auth.service.js:789` and `:920`, on two **unauthenticated**
  first-login endpoints, and the outcome is worse: a keyless or rotated
  stack lets a password-only caller **overwrite** the victim's secret at
  `:852` and take a session. Do not re-derive from the old framing.
- **`#1072` gained a hard prerequisite, `#1086`.** `[read it]`
  `keyRegistry.getKeyEntries()` can hold exactly one key, so any rotation
  turns every existing envelope into a `decryptValue` null — which is what
  makes the fail-open above reachable by an operator action.
- **`#1081`'s body was factually wrong on its central premise.** It claimed
  the equipment PUT "has no fetch at all" and built its not-a-copy-paste
  argument on it. `[read it]` It fetches at `:311` and 404s at `:341-348`.
  Corrected on the issue.
- **`#1087` flipped on evidence.** `[ran it]` Gating the equipment GETs on
  `manageStorageTopology` would break **Técnico and UsuarioExterno** across
  three views, two of which are `ALL_ROLES`. `GET /:id` has zero frontend
  callers and is free to gate. The e2e cost is zero, which is why no test
  would have told you.
- **`#1085` is worse than filed.** `[read it]` `generate-env-docker-secrets.sh`
  refuses to overwrite an existing `.env.docker`, and the documented setup
  step is `cp .env.docker.example .env.docker` — so the generator is
  **unreachable** to anyone following the README. `[ran it]` And
  `validateAllEnv`/`validateAndHalt` have **no production caller**, so a
  boot warning added there today would print nothing.

## Conventions this sitting relied on / established

- **The CRLF tape.** This tree is CRLF. An anchored replacement script
  written with `\n` anchors matches **zero** times and the bounded-count
  assert catches it — but only if you wrote one. Normalise anchors to the
  file's dominant EOL. `[ran it]` cost one round trip on the first script.
- **Bound every replacement — it paid twice.** Once on the CRLF miss above,
  and once when a `catch`-block anchor in `equipment.routes.js` matched
  **2** (POST's catch is verbatim identical to PUT's). An unbounded replace
  would have silently edited both.
- **A derived consumer list can contain a `node --test` file, and vitest
  drops it at exit 0.** `[ran it]` 47 paths named, **46** reported — the
  missing one was `tests/architecture/rbac-actions.arch.test.js`. Compare
  the counts in the same command every time; this is pack#772 and it fired
  again here.
- **Write the consumer list to the SESSION SCRATCHPAD, not `/tmp`.**
  `full-suite-guard` reads the named file itself, and a native Node process
  resolves bare `/tmp` as `C:\tmp`. `[ran it]` the run was blocked until the
  list moved. Test-output redirects to `/tmp` are fine — only Bash reads
  those.
- **Long `gh` bodies go through `Write` + `--body-file`.** `[ran it]` an
  inline heredoc comment hit the ~8.1 KB command-assembly ceiling (#665).

## Pile-up

**3 issues closed and 2 partially shipped, against 6 filed** — `#1084`
through `#1089`. **The queue grew.** Agent slots were used throughout (7
read-only research agents, never above the cap of 2 concurrent), and the
research repeatedly earned its keep by closing issues' own
`[not established]` claims — which is this repo's documented
highest-value research shape.

**No `rabbit-hole` conversion is claimed.** `#1082` is unblocked and
undelegable-but-doable; **I chose to stop** rather than start a five-route
authorization edit I could not verify to the standard the other four got.
That is a choice, not a blocker, and it is said plainly here for that
reason.

## Recommended next

**Dennis named no successor**, so nothing is queued by him. In dependency
order, from what this sitting established:

1. **The gates.** Five unverified commits is the largest outstanding risk,
   and Docker is on.
2. **`#1082`** — its comment now carries a complete, per-route
   implementable plan, including two corrections a first reading would get
   wrong and the measured test cost (13 fixtures, 2 distinct shapes).
3. **`#1086` then `#1072`**, in that order and not the reverse.
