# HANDOFF

**Written 2026-09-03, seventh 10-issue queue sitting. Dennis asked for "the
next ten issues, Docker is on."** All 10 addressed — **5 closed, 5 open with
their remainders named**. 7 commits pushed. 6 issues filed here, 6 on the
pack. **The Docker gate ran and was green (12/12 healthy); the stack is
down.**

**This is an INTERIM rotation — the session was not declared over.** Dennis
gave one further instruction mid-sitting (a pack review of prose/token cost,
filed as pack#684) and may give more. Re-derive every count rather than
trusting it.

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`, clean and matching origin.
  `main` untouched, no PR.
- Last substantive commit: `490077f4` (#986's lockout fix).
- **New npm scripts:** none. **New dependencies:** none. **New env keys:**
  none — one was *removed* (`AUDIT_MERKLE_SIGN_PRIVATE_KEY_PEM`, from
  `config/env.js` and `.env.docker.example`).
- New frontend i18n key `results.metrics.skipped` in all three catalogs.

## Docker state — nothing is running

- `compose.test.yml` brought up **with `--build`** and torn down.
  `docker ps -a` is empty.
- **The five `bioavanced-test-*` named volumes survive** (`down` without
  `--volumes`). Bootstrap state: **present, inherited from an earlier
  sitting, not re-verified here** — no bootstrap service was started; the
  gate needed only the 12 core services.
- **Test-stack images are CURRENT** — rebuilt this sitting from this tree.
  **Build cache was NOT pruned.**
- **The images predate `490077f4`.** Anything verifying #986 against a live
  stack must rebuild `backend-app-test` first.

## Verification

| Gate | Result |
|---|---|
| `compose.test.yml` bring-up | **12 services, 12/12 `(healthy)`** |
| `npm run test:architecture` | 120 / 120 |
| Targeted native suites | every touched file plus its two-hop consumer sweep, all green |

**No full native suite and no e2e run this sitting.** Both are outstanding
before a PR.

## What closed (5)

`#982` `#991` `#992` `#993` `#994`.

## What is open, and what each still needs

- **#994 is closed but spawned #1000** — `db.factory`'s `createDbMock` has no
  `client`/`startSession`, so `tests/integration/` still cannot cover a Mongo
  transaction at any of six call sites.
- **#989** — the `_PEM` branch is deleted. Open on the half that matters: **no
  key file reaches any stack.** The generator still writes `_PEM` +
  `NODE_ENV=development`; `.env.docker.example` points `_FILE` at
  `/run/secrets/merkle_signing_key.pem`, which **nothing creates**.
- **#986** — item 1 shipped. Open on item 2 (`blockIPAfterAttempts`), a
  missing mechanism, `0..1 Condicional`, spec-compliant to defer.
- **#974** — open on the audit-row half only. Its comment now carries the full
  scoping; read it before writing code.
- **#988** part 3 and **#990** — open, and **they are one decision, not two.**
- **#979** unchanged, still the owner's call.

Query the board for everything else (`gh issue list --state open`).

## The judgment a query cannot carry

- **#994's endpoint had never worked, since 2026-02-18. [ran it]**
  `git log -S getMongo --follow` puts `this.db.getMongo()` in the file's
  *first* commit, whose `package.json` already declared `mongodb ^6.3.0`.
  Not a driver migration — there was no migration.
- **[ran it] On the live stack, `typeof db.getMongo` is `undefined` and
  `db.client` is an object**, and `autoAssignSampleToBox` now reaches
  `BOX_NOT_FOUND` instead of throwing. That probe is the close criterion, and
  it is cheap to repeat: `docker compose exec -T backend-app-test node -e`.
- **The mock fabricating `getMongo` was FOUR sites, not one. [ran it]**
  Removing the obvious one (the shared `makeDb` default) changed nothing —
  41/41 still green. The load-bearing one was a block-local override; two more
  were tests replacing `db.client` wholesale; the fourth was found only by
  grepping the changed literal and was passing while never being consulted.
  **A green suite after removing one fabrication certifies nothing about the
  others.**
- **#993's exploit was narrower AND wider than its body. [read it]**
  `mfaSecret` was already deleted for non-admin targets, so it needed an
  admin target plus `mfaEnabled: true` — but `isBecomingAdmin` is satisfied by
  `roleName: 'Administrador'` in the *same* request, so the precondition was
  self-serviceable. That promotion path is **#998** and is the sharper issue.
- **The fix for #993 is a `delete` from `req.body`, NOT an allowlist removal**,
  and the issue's own suggestion would have shipped a defect: the route's only
  legitimate write to those fields is a server-set `null` (the disable-MFA
  clear), which reaches the `$set` *through* the allowlist.
- **#986's guard must carry the `mfaEnabled` term. [read it]**
  `setupMFAFirstLogin` writes `mfaSecret` without setting `lastLogin`, so a
  guard on `!isFirstLogin` alone breaks two unit tests and **five e2e call
  sites**.
- **The three storage siblings all run Neo4j BEFORE Mongo and compensate in
  the opposite direction. [read it]** *The fallible external system goes
  first, the transactional one goes last.* `autoAssignSampleToBox` is the only
  one that inverted it, and that inversion is the entire reason #988 part 3
  and #990 exist. **Reordering deletes both.** The obstacle: the raw inline
  `MERGE` has no event id to compensate, and the position is known only after
  the Mongo scan.
- **#974's step 2 is worth re-scoping before doing. [ran it]** The audit row
  is *less* durable than the session document — `retentionSweep` hard-deletes
  from `logs` and `sessions` is in no policy and has no TTL. What the row adds
  is reachability and tamper-evidence, not durability, so an audit-UI read
  path over `sessions` is a real alternative. That inversion is **#996**.
- **[ran it] `compose.dev.yml` and `compose.test.yml` contain no `restart:`
  key at all** — file-wide, not merely on the workers.
- **[ran it] `compose.dev.yml` only parses layered** (`-f compose.yml -f
  compose.dev.yml`); `compose.prod.yml` fails on *interpolation* alone. An
  `error while interpolating` proves the YAML parsed — don't read either as a
  change having broken something.

## Filed this sitting

Here: **#995 #996 #997 #998 #999 #1000**.
On the pack: **#683 #684 #685 #686 #687 #688**, plus recurrence comments on
pack #639 and #657.

**Worth reading first: #998** (a Coordenador can promote anyone to
Administrador), then **#684** (Dennis's own ask: a prose/token review of the
pack).

**None of the six filed here was worked** — a choice, recorded on each.

## Conventions this sitting relied on / established

- **Grep the changed literal across the tree, not just the failing tests.**
  It is what found #994's fourth mock fabrication, which no test run could.
- **A `delete` from the request body and a removal from an allowlist are not
  interchangeable** when the route itself writes the field.
- **Two agents were killed mid-task by a session rate limit**; one left five
  modified files with no report. `git status --porcelain` on any failed-agent
  notification, before anything else — pack#685.
- **Use a heredoc (`--body-file -`) for every `gh issue` body.** An unescaped
  backtick inside `--comment "..."` runs as command substitution and silently
  deletes the phrase — it happened once here, on a published comment. pack#688.
- **A multi-line `sed`/`python` pattern cannot match this machine's CRLF
  files** while single-line ones do — pack#687. Use the Edit tool.
- **Anchor grep patterns on `^ +Tests +[0-9]`** — an unanchored `FAIL` matches
  this repo's own `AUDIT_TRAIL_WRITE_FAILURE` log lines. Recurred here despite
  being in the previous handoff; pack#683 is about *where* that rule lives.

## Recommended next

**None queued** — Dennis named no task beyond the ten and the pack review.

The cheapest high-value work is **#998** (three lines for a role floor, and it
is a live escalation path), then **#999**'s `mfaEnabled` half. **#989**'s
remaining half and **#959** item 2 are one piece of work, not two.
