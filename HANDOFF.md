# HANDOFF

**Written 2026-09-07, twenty-first queue sitting. INTERIM — no end signal
was given, so treat the session as CONTINUING.** Dennis asked to read the
handoff and pick the next *group* of issues. I picked the encryption chain
the previous note recommended first — **#1085 → #1086 → #1072** — and all
three shipped, in dependency order, three commits.

## What shipped: the whole encryption chain

| commit | issue | what |
|---|---|---|
| `0c40f7dd` | **#1085** | encryption posture validated at boot — warn always, fatal in production |
| `d5982b07` | **#1086** | decrypt-only previous-key slot, so `ENCRYPTION_KEY` rotates without a code change |
| `4fe66bee` | **#1072** | MFA seed encrypted at rest, `mfaSecret` → `mfaSecretCiphertext` |

All three directions were pre-settled by Dennis on 2026-09-07, so this was
implementation with no design round trips — the previous note's central claim,
and it held.

## The two facts from this work worth carrying forward

**1. The rename IS the security fix in #1072, not a cosmetic half of it.**
Every enrolment presence guard now tests `user.mfaSecretCiphertext` — a field
on the document — so gating on a *decrypted* value became structurally
impossible rather than merely discouraged. `decryptValue` returns null on any
failure, and `setupMFAFirstLogin`'s write is unconditional, so a guard keyed
on a decrypt result would let an unauthenticated caller replace an enrolled
user's secret. `readMfaSecret()` in `auth.service.js` is the single decrypt
point and carries the full argument in its docblock. **Do not "simplify" a
guard onto a decrypted value.**

**2. `[ran it]` `speakeasy.totp.verify({ secret: null })` returns `false`, it
does not throw** — for `null`, `undefined` and `''`. That is what makes
decrypting only at the three verify sites fail-closed, and it is the fact the
whole #1072 design rests on. Re-measure it if speakeasy is ever upgraded.

**3. `validateEncryptionAndHalt` is deliberately NOT a caller of
`validateAndHalt`.** Wiring the latter into the boot path would newly make an
invalid *Redis* config fatal for the backend in production, inverting the
posture #977 documents in both `server.js` and `worker.js`. The docblock says
so; change both ends or neither.

## The consequence a next session must not mistake for a regression

**A production stack built from `.env.production.example` no longer boots.**
`[ran it]` that template ships `ENCRYPTION_KEY` blank, and #1085 direction 3
makes that fatal when `NODE_ENV=production` — the backend and the import
worker both exit 1 on a `[SECURITY]` line. **That is the direction working.**
The fix is to mint a key, not to relax the gate; `ALLOW_UNENCRYPTED_FIELD_STORAGE=true`
is the explicit loud opt-out. Written up on #978, whose item 1 (no tracked
production secrets generator) is now load-bearing rather than merely a
repeatability concern.

`[read it]` The other two stacks are unaffected: `compose.test.yml:26` sets a
real key under `NODE_ENV: test`, and `compose.dev.yml` sets no `NODE_ENV` at
all — both pass the gate, dev with a loud warning if its key is blank.

## Issue state

Query it — `gh issue list --state open` (116 open at rotation). What a query
cannot carry:

- **#1085, #1086, #1072 all closed.** Filed this sitting: **#1097, #1098,
  #1099, #1100, #1101**, plus **dyeallpies-skills-pack #812, #813, #814**.
- **#1099, #1100 and #1101 are the direct follow-ups on the chain**, and they
  are genuinely independent of each other:
  - **#1099** — a rotation cannot repair the BLIND INDEXES. `hmacBlindIndex`
    keys off `getActiveKey()` and stores a bare hex string with **no keyId**,
    so #1086's slot has nothing to dispatch on. Masked today only by the `$or`
    plaintext fallback that #574/#1072 exist to remove. This is the sharpest
    of the three.
  - **#1100** — one rotation shape is still a silent null: rotating
    `ENCRYPTION_KEY` while KEEPING `ENCRYPTION_KEY_ID`. `[ran it]` measured.
    The boot gate reports `[]` and correctly cannot see it, so **warning
    harder is not available** — the remedy is a decrypt fall-through or
    documentation, and the trade is Denise's/Dennis's.
  - **#1101** — the previous-key slot's documented retirement step ("rewrite
    the old envelopes, then empty the slot") has **no tooling behind it**.
    Explicitly invited by #1086's own body.
- **#1097 is unrelated to the chain and cheap.** `eConsent.js:17` throws on a
  missing `CONSENT_SECRET` at MODULE LOAD, so the backend dies with a bare
  Node stack trace before `server.js:40` installs the #1040 handlers and
  before any of its critical-variable guards. Found by running a real boot
  probe. `[ran it]` The conventions skill already names this class as needing
  lazy init; the *service* half was done, this *route* half was not.
- **#1098** — `startServer()` is never invoked by any test. `server.js` IS
  loaded (`process-fatal-handlers.1040.test.js:39`) but that suite
  deliberately keeps the boot sequence from running, so four deliberate
  postures (#972, #977, #1040, #1085) sit unpinned. `worker.js` got
  `worker.entrypoint.test.js` for exactly this reason. `RUN_SERVER_IN_TEST=1`
  already exists and nothing uses it.

## Gates

- **Targeted native only, as the end-loaded order requires.** `[ran it]`
  per iteration: #1085 sweep 10 files / 180 passed; #1086 sweep 18 / 342;
  #1072 sweep **75 named / 73 ran / 1605 passed** (the two unrun are
  `tests/factories/*.factory.js` — fixture helpers, not suites; `[ran it]`
  neither mentions MFA). `npm run test:architecture` **124/124** after each.
  Frontend typecheck exit 0; `NewUserPage.test.tsx` 4/4.
- **Can-it-fail probes on all three, executed-count checked both runs**
  (#804): 45/45 with 13 red, 88/88 with 13 red, 248/248 with 28 red.
- **Docker NOT run this sitting, deliberately** — end-loaded gate, and this
  was a three-slice queue. Dennis noted Docker is on; the daemon is up and
  **nothing was started**. `[ran it]` at rotation: **zero containers**
  (`docker ps -a` empty). **33 images / 7.73GB, 19 volumes / 919MB, build
  cache 0** — unchanged from the previous note, none created this sitting.
- **Full backend native suite NOT run this sitting.** The 464 files / 8681
  tests figure is still the last measurement, not a fresh one.

## The judgment a query cannot carry

- **A 75-file consumer sweep DOES fit in a foreground Bash call** with
  `timeout: 600000` — `[ran it]` this sitting, it completed. The previous
  note's "84 files exceeds the 120s ceiling and gets auto-backgrounded" is
  about the *default* timeout, not a hard limit. Raising the timeout is the
  simpler move than backgrounding when you want the result in-line.
- **Writing the consumer list in a PRIOR tool call worked cleanly** — pack
  #809's fix is live and the idiom is now: write the list, then a separate
  call doing `wc -l < list && npx vitest run $(cat list)`. Split the
  `tests/architecture/` entries out first; vitest drops them silently.
- **`node --check <script>` before running a generated patch script.** A
  JSDoc backtick inside the script's template literal is a `SyntaxError`
  pointing at the *script's* line number, which reads like a logic bug. Cost
  one retry; filed as pack #813.
- **A SCRIPT written to bare `/tmp` resolves its own relative `require()`
  against `/tmp`.** The argv token translates fine and the run still dies.
  The `/tmp` reminder's "only Bash reads it back" blessing does not apply to
  an executable. Cost one retry; filed as pack #814.
- **Line endings stayed per-file and mattered:** `auth.service.js`,
  `User.js`, `user.routes.js`, `keyRegistry.js`, `validateEnv.js` and
  `.env.docker.example` are **CRLF**; `.env.production.example`, the
  integration tests and `auth.service.processLogin.unit.test.js` are **LF**.
  The EOL-detecting bounded-anchor script shape handled all of it; detect per
  file, never per repo.
- **`gh issue create` on the PACK repo needs `--label`** — the guard blocks
  without one and the whole body must be re-sent. The project repo's habit of
  always passing one is why this only bit on the pack.

## Recommended next

Dennis named a *group*, and the group is finished; nothing further is queued
by name. In rough order of value:

1. **#1099**, then **#1100/#1101** — the three follow-ups this chain
   generated. #1099 is the one with a real correctness consequence once the
   plaintext fallbacks retire; #1100 needs a direction call before it can be
   worked.
2. **#1097** — small, self-contained, and `[read it]` the remedy shape is
   already settled by precedent (#972's critical-variable block plus lazy
   init in the route).
3. **#1098** — pins four existing postures and is the natural home for the
   one #1085 guard that a runtime probe rather than a test currently covers.
4. **#1094 + #1096 together**, unchanged from the previous note and still
   untouched — same two files (`auditLogger.js`, `log.service.js`). #1096
   carries an availability trade that is Denise's call.
5. **#1092**, unchanged across three notes now. One query against a populated
   database answers it.
