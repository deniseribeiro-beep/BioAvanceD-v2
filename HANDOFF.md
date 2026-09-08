# HANDOFF

**Written 2026-09-08, twenty-fifth queue sitting. INTERIM — no end signal was
given, so treat the session as CONTINUING.** Dennis asked to read the handoff,
pick the next *group* of issues, and said Docker was on. I took the previous
note's recommended list — **#1109, #1104's `birthDate` cutover, #1110** — and
**all three are done.** Nothing further is queued by name.

## What shipped

Branch `feature/docker-e2e-backend-integration`, tree clean and matching
origin. `main` untouched and still frozen.

| commit | issue | what |
|---|---|---|
| `7bd72960` | **#1109** closed | `identityDocument` gets one canonical digits-only spelling, write side and query side |
| `40b8695a` | Refs **#1104** | `birthDate` cut over to ciphertext-only; plaintext arm removed from all four query sites |
| `ad422081` | **#1110** closed | the assistant scaffolding that outlived `5e571099`, across both npm roots |

**Filed: #1111, #1112, #1113, #1114**, plus pack **#840**. **Commented:
#1103, #1104**, and measured recurrences on pack **#814, #766, #683, #771**.
Query the tracker for state — `gh issue list --state open`.

## The three things a next session must not undo

**1. `40b8695a`'s plaintext drop is CONDITIONAL on having enciphered the
value, and that is a precondition, not defensive coding.** `[read it]` #1083
deliberately left this service degrading to plaintext on a keyless stack
*because the plaintext is still written* — its own comment says "that is right
for participantIdentity.service, whose map is deliberately additive pending
#574". Make the drop unconditional and a stack with no `ENCRYPTION_KEY` writes
**no plaintext, no ciphertext and no hash** and still answers 201. A test pins
it, and that test was green before the change too.

**2. `getCiphertextOnlyFields()` is a LIST, not the whole
`encryptedFieldMap`.** `patientName` cannot cut over — `listPatients` does
`$regex` substring matching, which a blind index cannot serve.
`identityDocument` should not until **#1112** is answered.

**3. `7bd72960` canonicalizes inside `encryptIdentityFields`, not in
`ParticipantIdentityModel.fieldsOf`.** `[ran it]` only **6** of the **9**
writers go through the model; all 9 go through `encryptIdentityFields`.

## #1104 is open on purpose, and its premise has been wrong four times

`[ran it]` the previous note recorded `birthDate` as having "no blocker left".
Everything it listed was true and still incomplete — #1083's interaction was a
**fourth** unrecorded blocker. **Three sessions, four blockers. Treat that as a
property of this issue** and re-enumerate `patientName`/`identityDocument` from
scratch rather than trusting this note either.

`[ran it]` **#1113 is unexpected supporting evidence**: the ciphertext-only
shape already occurs on a live write path by accident, and nothing breaks.

## Recommended next

Nothing is queued by name. In rough order of value:

1. **#1111** — `checkParticipantIdentityParity` reports drift for *every*
   post-#575 patient, so the gate #574's plaintext removal depends on can never
   open. Latent (runs on no stack), proven with a run.
2. **#1114** — `Log.js`'s `VALID_ENTITIES` gates nothing: both branches that
   consult it have empty bodies, so `LogModel.validate` accepts any
   `resourceType`. Its sibling in `audit.middleware.js` IS enforced, which is
   the trap.
3. **#1113** — small, and it stops a live import path nulling civil identity it
   never meant to touch.
4. **#1112** — needs Dennis, and it gates #1104's `identityDocument` half.

**The end-loaded gates have NOT run against these three commits** — see below.
That is the strongest candidate for the next sitting if Dennis wants to ship.

## Gates — Docker NOT run, full native suite NOT run

- **`npm run test:architecture` 124/124**, three times.
- **Consumer sweeps, all green:** #1109 111 files / 3001 tests; #1104 54 /
  1802; #1110 54 / 1715. Named-vs-executed reconciled every time (the
  shortfall is always `tests/architecture/**`, excluded by `vitest.config.js`).
- **Can-it-fail probes, all valid:** #1109 5 red / 38 executed; #1104 7 red /
  155 executed; #1110 3 red / 239 executed backend **and** 2 red / 16 executed
  frontend — each equal to its own green baseline (#804) and N-shaped (#682).
- **Frontend:** `typecheck` clean; 28/28 across its two consumer tests.
- **Full native suite NOT run this sitting.** Last known green is 466 files /
  8783 tests, and it predates all three commits.
- **Docker NOT run.** Dennis said it was on; the gate is end-loaded. **No stack
  running, no volumes created by this sitting** (`docker ps -a` → zero
  containers at cleanup). The previous note's 35 anonymous volumes and
  `api/backend/coverage/` (33MB, mtime 2026-09-04) are untouched and still need
  Dennis.

## The judgment a query cannot carry

- **A backgrounded command ending `; echo "exit=$?"` makes the task
  notification report exit 0 no matter what.** `[ran it]` a sweep whose
  notification said *"completed (exit code 0)"* had **5 genuinely failing
  tests**. The trailing `echo` is the pack's own anti-laundering idiom (#823)
  and is right in the foreground; backgrounded it launders the notification
  instead. **Drop the echo when backgrounding.** Pack #766.
- **A `-- <path>` pathspec naming a file that does not exist returns empty at
  exit 0.** `[ran it]` `:(top)docker-compose.yml` — this repo has
  `compose*.yml`. #654's class, new half: the *scope target itself* can be
  fictional.
- **In a scratchpad script, `fs` paths are cwd-relative but `require` paths are
  script-relative.** `[ran it]` three patch scripts using only `fs` worked,
  then a probe's relative `require` died `MODULE_NOT_FOUND`. Pack #814.
- **Any second interpreter is the same #583 block; the remedy is `Write`, not a
  different language.** `[ran it]` blocked on `node -e`, then reached for a
  `python3` heredoc rather than for the file. Pack #771.
- **Derive a consumer list with an explicit `\.(test|spec)\.js$` filter** —
  `git grep -l` filters by content, so helpers enter the list and the
  executed-count alarm trips benignly, which trains waving it off. Pack #840.
- **Grep failure detail on `^AssertionError`, anchored.** A bare `TypeError` in
  the alternation matched this repo's own stderr and buried two real failures.
  Pack #683.
- **`file -b` does not report CRLF for JSON.** `[ran it]` it called all three
  `api/backend/i18n/*.json` plain "JSON text data" while the in-script
  detection correctly found two CRLF and one LF. The in-script detection is the
  authority, as #836 says; the pre-check is the thing that lies.
