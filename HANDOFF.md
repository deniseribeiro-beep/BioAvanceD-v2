# HANDOFF

**Written 2026-09-02, during a 10-issue queue sitting.** Dennis asked for
"the next 10 issues, Docker is on." **8 closed, 3 left open with a shipped
slice, 12 commits pushed, 10 issues filed (8 here, 2 on the pack).**

**INTERIM — the session was not declared over by the user.** It may
continue. Re-derive every count rather than trusting it.

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`. `main` untouched, no PR.
- Last substantive commit: `abaf40d9` (#946/#947).
- No new dependencies. No new env vars.
- **One behaviour change a reader should know about:** `npm --prefix
  frontend run typecheck` now aliases `typecheck:full` instead of a
  four-file subset (#946). It passes — but it is a genuinely wider gate
  than it was, so a future red there is not necessarily a new regression.

## Verification state

| Gate | Result |
|---|---|
| backend `tests/unit tests/integration tests/compliance` | **re-running at rotation time — see below** |
| `npm run test:architecture` | **110 / 110** [ran it] |
| `npm --prefix frontend run typecheck:full` | **clean** [ran it] |
| targeted per-issue vitest runs | green, named in each close comment |
| **e2e / Docker** | **NOT RUN** |

**The full backend suite result is not in this file on purpose.** An
earlier full run came back **2 failed / 8281 passed**, both failures caused
by this sitting's own #941 wiring; `b170b50b` fixed the cause and the
targeted consumer set went green. The re-run was still in flight when this
was written. **[not established] — confirm it before treating the native
gate as green.** Command:

```
cd api/backend && npx vitest run tests/unit tests/integration tests/compliance > <logfile> 2>&1
```

**Redirect it to a file; do not pipe it to `tail`.** A backgrounded
`... | tail -8` produced a 0-byte output file and stalled at ~18 CPU-seconds
over 35 minutes, indistinguishable from a hang. Re-running with plain
redirection worked immediately. [ran it, both ways] Recorded on pack #655.

## Docker state

**No containers, no stack, no bioavanced images.** Base images present
(`mongo:7`, `neo4j:5-community`, `redis:7-alpine`, `influxdb:2.7`); no
application image built this sitting, nothing brought up, no bootstrap run.

So the e2e gate needs a full image build **and** the full bootstrap chain —
`docker-workflow`'s bioavanced overlay carries the recipe (12 core services
+ `admin-bootstrap-test` + the 17-service reference-data chain, `--workers=1`).

**Two things want that gate:**

- **#948** — whether `node:22-alpine` ships an `openssl` CLI. One command:
  `docker run --rm node:22-alpine sh -c 'which openssl || echo MISSING'`.
  `Dockerfile.prod:12` installs only `mongodb-tools` while
  `audit-tsa.service.js:29` shells out to `openssl`; `Dockerfile.dev:8`
  installs it explicitly. **[not established]**
- **#947** — the `.dockerignore` change is unverified against a real build.

## What closed (8)

`#902 #893 #940 #939 #936 #881` from the queue, plus `#946` and (partly)
the work behind `#947` — both filed and worked in this sitting. Read each
close comment for evidence; six carry `premise-corrected`.

## Left open with a shipped slice (4) — the judgment a query cannot carry

Query the board (`gh issue list --state open`). What it will not tell you:

- **#933 — direction 1 was already built and reachable by nobody.**
  `clearMfaLockForUser.js` existed since `493962a0` with no npm script and
  no compose service. Now wired (`mfa:clear-lock`). Open on directions 2/3.
  Its body's "recovery requires direct database access" is now overstated.
- **#941 — two indexes built, ten declarations deliberately left.** The
  counts in the body are wrong (9 unique across *seven* files, 12 distinct
  specs, 45 sites) and **the explicit-null trap applies to none of them**.
  7 of 12 guard collections nothing writes; those should probably be
  *deleted*, not built. Do not reach for `syncIndexes()` — it drops
  indexes absent from the schema, and three collections would lose live
  natively-built ones.
- **#923 — the fork is still yours, but three things in its own prior
  comment did not survive checking.** The RF006 conditional is re-scoped
  rather than dropped; `/allocate/auto` has no audit row at all and bypasses
  the refusal entirely; and **`sensor.service.js:243` is a third instance of
  the defect, not the graceful-degradation precedent it was cited as**
  (filed as #951). The real cost of the replica-set option is keyfile auth,
  not `--replSet`.
- **#914 — item 1 (the per-group sweep) is done.** 0 enforced / 30
  shadow-enforced / 13 inert over 43 keys, and the body omits a real ninth
  group (`lgpd`). "Inert" is the wrong frame for 30 of them — they are
  redirects, not features to build. Suggested order: `session` first (it
  has RNF021 AC#3 behind it), `enhancedSecurity` last (it is an override
  layer).

## Filed this sitting (10)

Eight here — `#945 #946 #947 #948 #949 #950 #951 #952` — and two on the
pack, `#654` and `#655`. `#946` is closed; the rest are open.

**Read #952 first.** `failedLoginAttempts` is incremented **nowhere**, so
failed *password* logins are uncounted and there is no password brute-force
lockout — the existing lockout guards TOTP entry, after the password already
passed. **RF014 AC#2 mandates it explicitly** (*"Configurar tentativas,
bloqueios e regras de senha"*), so it is an unmet requirement at that
requirement's own priority, not optional hardening. [read it]

**#947 has a half only Denise can decide:** a named individual's CV PDF is
**tracked** under `api/backend/storage/samples/`. The build context now
excludes it; removing the file, or rewriting history, was deliberately not
done.

## Conventions this sitting relied on / established

- **A "confirmed, no change needed" resolution must be written into the
  code that looks wrong**, not left in a tracker comment — otherwise the
  next audit re-opens it. #936 is the worked example.
- **Verify the premise before building on it — it paid on every one of six
  research briefs.** Every issue whose premise was re-checked had something
  materially wrong: #893's was fixed weeks earlier, #940's "probably dead"
  block was live, #941's counts and null-trap were both wrong, #939's
  "maybe delete it" was reachable by a Técnico uploading a CSV, #923's cited
  precedent was a bug, #914 omitted a whole policy group.
- **The two-hop consumer sweep is not optional and one hop is not it.**
  Run one hop on #941 and the full native suite caught what it missed —
  `pipeline.test.js` reaches the changed module only through
  `graphProjection.service.js`.
- **`git grep -- ':(top)api/backend/src'` cannot see `app.js` or
  `server.js`** — they sit at `api/backend/` root, and `app.js` mounts every
  router. Scope to `api/backend` for wiring questions. Filed as pack #654.
- **An architecture guard here matches raw file text**, so a *comment*
  naming a forbidden token fails it exactly as an import would
  (`seed-boundary.arch.test.js:22`). Cost one red suite. Filed as #945; the
  `stripComments` remedy already exists twice in that directory.

## Recommended next

**None queued** — Dennis named no task beyond the 10.

If the session continues, the two strongest are **the Docker/e2e gate**
(nothing has exercised this sitting's twelve commits against a live stack,
and #948's one-line `openssl` check rides along) and **#952**, which is the
only open item with an explicit requirement behind it and a security
consequence.
