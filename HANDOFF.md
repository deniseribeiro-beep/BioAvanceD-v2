# HANDOFF

**Written 2026-09-07, twenty-second queue sitting. INTERIM — no end signal
was given, so treat the session as CONTINUING.** Dennis asked to read the
handoff and pick the next *group* of issues, and said Docker was on. I took
the previous note's recommendation #1 — the three encryption-rotation
follow-ups **#1099, #1100, #1101** — and all three shipped. Then the
end-loaded gate ran, Docker included. Three commits.

## What shipped: the rotation chain's follow-ups

| commit | issue | what |
|---|---|---|
| `07320216` | **#1100** | `decryptValue` falls through to the previous key when a resolved `keyId` fails |
| `fa0069a7` | **#1099** | blind indexes matched under EVERY registered key, via `$in` |
| `584ed3c5` | **#1101** | the templates stop promising a retirement step nothing implements |

**Dennis handed all three direction calls back** ("what do you think is
best?") rather than picking. All three were then settled from the source in
the same sitting — see "The judgment a query cannot carry" below, which is
the load-bearing lesson of this sitting.

## The one thing a next session must not undo

**#1099 and #1100 are the same idea — "try the keys you actually have" —
applied to the two artefacts `fieldEncryption.js` produces.** After them the
blind index and the envelope behave *identically* under rotation: both
survive while `ENCRYPTION_KEY_PREVIOUS` is populated, both stop matching once
it is emptied. That symmetry is the point, and #1101's template text now
documents the consequence. Don't "optimise" one half back to active-key-only.

- **#1100** — an UNKNOWN `keyId` deliberately still fails closed on its warn.
  The silent case was the id that *resolves*, to the wrong key. A control
  test pins this; do not widen that branch.
- **#1099** — **WRITES stay active-key only** (`encryptIdentityFields` still
  calls `computeBlindIndex`). Only queries fan out, via
  `computeBlindIndexCandidates`. Do not make writes multi-key.

**`[ran it]` the #1036/#952 CPU-amplification precedent does NOT transfer to
#1100**, and that is what decided it. `[read it]` #1036's own body: what it
refused was *"a bcrypt round per unauthenticated request"* — attacker-
triggerable, unbounded in rate, deliberately slow per unit. `decryptValue`'s
loop is bounded at **two** keys by configuration, fires only on a decrypt that
already returned `null`, and is triggered by stored data rather than request
volume. Re-measure only if `getFallbackKeys` ever stops being bounded by the
registry.

## Issue state

Query it — `gh issue list --state open` (114 open at rotation). What a query
cannot carry:

- **#1099, #1100, #1101 all closed.** Filed this sitting: **#1102, #1103**,
  plus dyeallpies-skills-pack **#816, #817, #818, #819**.
- **#1102** — `identityDocumentHash`/`birthDateHash` have **no Mongo index
  anywhere**, and `participantIdentities` is absent from `create-db.js`
  entirely (no model file either — it is a raw-driver collection). Distinct
  from #941 (declared-but-unbuilt Mongoose indexes — there is no declaration
  here to build) and #971 (the *unique* index for the dedup race). **This is
  the most workable of the two filed**: direction 2, a hand-rolled
  ensure-index on the `sampleIndexes.js`/`collectionResolver.js:48` precedent
  #936 established, needs no design round trip. **I chose to stop on it** to
  run the gate instead — not blocked.
- **#1103** — no re-encryption tooling and no encrypted-field inventory.
  Deliberately not built: no deployed data (#362/#682), so it would be
  written for zero rows. Two measurements in its body are the useful part:
  - `[ran it]` `encryptValue` has **SIX** production call sites, not the four
    #1101 recorded — #1072's two `mfaSecretCiphertext` writes in
    `auth.service.js` landed in `4fe66bee`, the sitting immediately before.
    **A hand-listed inventory drifted 50% in one sitting.**
  - `[ran it]` `encryptionKeyVersion` is written by
    `participantIdentity.service.js:50` **only**. Five of six sites leave no
    worklist marker, so a rewrite cannot be scoped by query anywhere but
    `participantIdentities`. This settles #1101's `[not established]`.

## Gates — ALL GREEN, Docker included

Run once at the end, as the end-loaded order requires:

- **Full backend native suite: `[ran it]` 465 files / 8754 tests, 0 failures,
  exit 0.** Supersedes the previous note's 464/8681. Backgrounded — it is
  past the 600s foreground ceiling.
- **`npm run test:architecture` 124/124** after every iteration.
- **Docker e2e: `[ran it]` 223/223 passed, `--workers=1`, 2.0 minutes, zero
  failures.** Recipe as the `docker-workflow` overlay documents it, with
  `--build` (mandatory — `api/backend/src` was touched). All 12 core services
  healthy, `mongo-rs-init-test` + `admin-bootstrap-test` + all 17 bootstrap
  chain services `Exited (0)`, nothing restarting.
- **Per-iteration consumer sweeps:** #1100 18 files / 535; #1099 51 files /
  1751; #1101 4 files / 116.
- **Can-it-fail probes, executed-count checked both runs (#804):** #1100
  22/22 with 1 red; #1099 **102/102 with 13 red across all five changed
  files**, all three query sites red independently (#682).

**Stack is DOWN and cleaned.** `[ran it]` at rotation: **zero containers**,
33 images / 8.697GB, 26 volumes / 928.9MB, **build cache 0**. `builder prune
-af` reclaimed 1.048GB — note `system df` had reported only 433MB, the exact
gap `-af` exists to close. `playwright-report/`, `test-results/`, the
scratchpad and every `/tmp` redirect target were removed.

**Not done, needs Dennis:** 21 anonymous Docker volumes remain and only ~7
are this sitting's; `docker volume prune` would take the other 14 too, so it
was left alone rather than guessed at.

## The judgment a query cannot carry

- **The central lesson: an issue body's own "this is the owner's call" is a
  CLAIM, and it is the one claim class no skill tells you to re-verify.** All
  three issues said some variant of it; I inherited that and asked Dennis,
  who handed all three back; all three then fell to one re-trace each. These
  bodies are unusually well-graded (`[ran it]`, `[read it]`,
  `[not established]` throughout), which is exactly what made the single
  UNGRADED sentence read as settled. Filed as pack **#816**. **Next session:
  re-run the trace before inheriting a deferral.**
- **#1099's cost estimate in its own body was wrong in our favour.** It
  costed direction 1 as "two fields plus every query site"; `[ran it]` all
  three query sites *and* the write path funnel through one
  `computeBlindIndex`, and `PatientIdentityService.js:6`'s
  `identityCryptoService` **is** `participantIdentity.service` under another
  name. No schema migration was needed.
- **`[ran it]` a multi-grep sweep chained with `&&` silently drops every
  later search when an earlier grep legitimately matches nothing** (exit 1 is
  grep's correct answer for no-match). It cost me the search that found the
  three tests pinning the filter shape I was changing. **Use `;`.** Filed as
  pack **#817** — distinct from #675/#760/#770, all of which are about a
  command that *failed*.
- **`fix-bugs`' inert-first split (#781) is scoped to statically-typed
  languages but is needed identically in JS**: a missing export throws
  `TypeError`, which #676 rejects as a setup-shaped red. `[ran it]` landing
  `hmacBlindIndexCandidates` returning `[active]` first gave a behavioural
  red naming my assertion instead. Pack **#818**.
- **Line endings stayed per-file and mattered again, twice in one script:**
  `intakeWizard.js` is **LF** while `fieldEncryption.js`,
  `participantIdentity.service.js`, `import.service.js` and
  `PatientIdentityService.js` are CRLF; `.env.docker.example` is CRLF and
  `.env.production.example` is LF. Detect per file, never per repo.
- **`node --check <script> && node <script>` before every generated patch
  script**, and put replacement payloads in their own plain files rather than
  a JS template literal — the payloads here contained backticks and
  `${keyId}` outright.

## Recommended next

Dennis named a *group* and the group is finished; **nothing further is queued
by name.** In rough order of value:

1. **#1102** — the sharpest of the two this sitting filed, and the one that
   needs no design round trip. Direction 2 (hand-rolled ensure-index on the
   `sampleIndexes.js` precedent).
2. **#1098** — pins the four `startServer()` boot postures (#972, #977,
   #1040, #1085); `RUN_SERVER_IN_TEST=1` already exists and nothing uses it.
   Unchanged from the previous note.
3. **#1094 + #1096 together** — same two files (`auditLogger.js`,
   `log.service.js`). #1096 carries an availability trade that is Denise's.
4. **#1092** — unchanged across four notes now. One query against a populated
   database answers it.

The four pack issues (**#816, #817, #818, #819**) can only be worked from a
`dyeallpies_skills_pack` session — Rule 0, and `junction-write-guard`
enforces it mechanically from here.
