# HANDOFF

**Written 2026-09-08, twenty-fifth queue sitting. INTERIM — no end signal
was given, so treat the session as CONTINUING.** Dennis asked to read the
handoff, pick the next *group* of issues, and said Docker was on. I took the
previous note's recommended list — **#1109, then #1104's `birthDate`-only
cutover, then #1110** — and have finished the first of the three.

## What shipped so far

Branch `feature/docker-e2e-backend-integration`. `main` untouched and still
frozen.

| commit | issue | what |
|---|---|---|
| `7bd72960` | **#1109** closed | `identityDocument` gets one canonical digits-only spelling, on the write side and the query side |

**Filed: #1111, #1112**, plus pack **#840** and a measured recurrence
commented onto pack **#814**. **Commented: #1103.** Query the tracker for
state — `gh issue list --state open`.

## The thing a next session must not undo

**`7bd72960` canonicalizes inside `encryptIdentityFields`, deliberately, and
not in `ParticipantIdentityModel.fieldsOf`.** #1109's own body proposed
`fieldsOf`; `[ran it]` only **6** of the **9** `participantIdentities`
writers go through the model, while **all 9** go through
`encryptIdentityFields`. `updatePatient`, `import.service.js:412`'s merge
`$set` and both `PatientIdentityService` branches build their identity
objects by hand. Moving the normalization to the model would silently
un-fix those three.

- **`normalizeForHash`'s `identityDocument` arm is load-bearing on its own** —
  don't fold it away as redundant with the write-side canonicalization.
  `[ran it]` `import.service.js:328` hands `computeBlindIndexCandidates` a
  raw, still-punctuated value, so the query side has to strip punctuation
  itself. Two tests pin it.
- **#1109's body says "every writer stores it verbatim"; that is wrong.**
  `[ran it]` `createPatient` normalizes at `patient.service.js:561`, which is
  why every existing fixture (`'11144477735'`) passed and why the bug was
  invisible. The issue carries the correction.

## Next in the group

1. **#1104's `birthDate`-only cutover** — the handoff before this one
   established it has no blocker left: its normalization agrees on both
   sides and all four query sites carry hash arms. **Unverified in this
   sitting** — re-enumerate before trusting it, per the note below.
2. **#1110** — do the dict-02 check on `Log.js`/`audit.middleware.js`'s
   `'Assistant'`/`'IntelligentAssistant'` entries first.

**#1104's `identityDocument` half is no longer blocked by #1109**, but read
**#1112** before cutting it over: that decision record asks whether the
typed formatting should survive, and the answer changes what the cutover
should store.

## Gates — Docker NOT run this sitting

- **`npm run test:architecture` 124/124.**
- **Consumer sweep 111 files / 3001 tests, exit 0.** 122 named; the 11 not
  executed are 10 `tests/architecture/**` (excluded by `vitest.config.js`)
  plus `tests/factories/cursor.factory.js`, a helper. That reconciliation is
  pack #840.
- **Can-it-fail probe: 5 red / 33 passed, 38 executed** — equal to the green
  baseline, so the probe is valid (#804), and N-shaped against the five
  #1109 assertions (#682).
- **Full native suite NOT run this sitting.** Last known green is the
  previous note's 466 files / 8783 tests.
- **Docker NOT run.** Dennis said it was on; the gate is end-loaded, so
  nothing was built or brought up. **No stack is running and no volumes were
  created by this sitting.** The previous note's 35 anonymous volumes and
  `api/backend/coverage/` (33MB) are untouched and still need Dennis.

## The judgment a query cannot carry

- **#1111 is the sharpest thing filed.** `[ran it]`
  `checkParticipantIdentityParity` reports **drift for every post-#575
  patient** — the gate #574's plaintext removal depends on can never open —
  and its 5 green tests all use pre-#363-shaped fixtures. It runs on no
  stack (its only caller is an unwired `src/scripts/` script), so it is
  latent, not live.
- **A `-- <path>` pathspec naming a file that does not exist returns empty
  at exit 0.** `[ran it]` this sitting wrote `:(top)docker-compose.yml` in a
  wiring sweep; this repo has `compose*.yml` and no such file, so the sweep
  proved nothing while reading like a clean zero. Same class as #654; the
  new half is that the *scope target itself* can be fictional. `ls` the path
  before trusting an empty pathspec-scoped result.
- **In a scratchpad script, `fs` paths are cwd-relative and `require` paths
  are script-relative.** `[ran it]` three patch scripts using only
  `fs.readFileSync('api/backend/...')` worked, then a probe script's
  `require('./api/backend/...')` died `MODULE_NOT_FOUND` — the working half
  builds confidence in the broken half. Use absolute paths for `require`.
  Pack #814's mechanism at a path its rule does not reach.
- **The previous note's warning still stands: do not run a second heavy
  workload while the native suite is backgrounded** (pack #828).
