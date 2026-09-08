# HANDOFF

**Written 2026-09-08, twenty-fifth queue sitting. INTERIM — no end signal
was given, so treat the session as CONTINUING.** Dennis asked to read the
handoff, pick the next *group* of issues, and said Docker was on. I took the
previous note's recommended list — **#1109, #1104's `birthDate` cutover,
#1110** — and have finished the first two.

## What shipped

Branch `feature/docker-e2e-backend-integration`, tree clean and matching
origin. `main` untouched and still frozen.

| commit | issue | what |
|---|---|---|
| `7bd72960` | **#1109** closed | `identityDocument` gets one canonical digits-only spelling, write side and query side |
| `40b8695a` | Refs **#1104** | `birthDate` cut over to ciphertext-only; plaintext arm removed from all four query sites |

**Filed: #1111, #1112, #1113**, plus pack **#840**. **Commented: #1103,
#1104**, and measured recurrences on pack **#814, #766, #683**. Query the
tracker for state — `gh issue list --state open`.

## The three things a next session must not undo

**1. `40b8695a`'s plaintext drop is CONDITIONAL on having enciphered the
value, and that is not defensive coding — it is a precondition.** `[read
it]` #1083 deliberately left this service degrading to plaintext on a
keyless stack, *because the plaintext is still written*: its own comment
says "that is right for participantIdentity.service, whose map is
deliberately additive pending #574". Make the drop unconditional and a stack
with no `ENCRYPTION_KEY` writes **no plaintext, no ciphertext and no hash**
and still answers 201. A test pins it, and that test was green before the
change too.

**2. `getCiphertextOnlyFields()` is a LIST, not the whole
`encryptedFieldMap`.** The tempting cleanup is to drop the list and cut all
three fields over at once. `patientName` cannot: `patient.service.js
#listPatients` does `$regex` substring matching, which a blind index cannot
serve. `identityDocument` should not until **#1112** is answered.

**3. `7bd72960` canonicalizes inside `encryptIdentityFields`, deliberately,
not in `ParticipantIdentityModel.fieldsOf`.** `[ran it]` only **6** of the
**9** `participantIdentities` writers go through the model; all 9 go through
`encryptIdentityFields`. Moving it would silently un-fix `updatePatient`,
`import.service.js:412` and both `PatientIdentityService` branches.

## #1104 is open on purpose, and its premise has now been wrong four times

`[ran it]` the previous note recorded `birthDate` as having "no blocker
left". Everything it listed was true and it was still incomplete — #1083's
interaction above was a **fourth** unrecorded blocker, found by
re-enumerating rather than by inheriting. **Three sessions, four separate
unrecorded blockers. Treat that as a property of this issue.** Re-enumerate
`patientName`/`identityDocument` from scratch; do not trust this note either.

What remains:

- **`identityDocument`** — unblocked by `7bd72960`, but read **#1112**
  first. It asks whether the typed formatting should survive, and the answer
  changes what the cutover should store.
- **`patientName`** — still the real design fork, unchanged: `$regex`
  substring search versus an exact-match blind index. Dennis has the call.

**Unexpected supporting evidence:** `[ran it]` **#1113** shows the
ciphertext-only shape *already occurs on a live write path* by accident, and
nothing breaks — a stronger safety argument for the remaining cutover than
anything in #1104's body.

## Recommended next

1. **#1110** — the last of the named group. Do the dict-02 check on
   `Log.js`/`audit.middleware.js`'s `'Assistant'`/`'IntelligentAssistant'`
   entries first; RF012 AC#10 forbids IA/Assistente in the current scope.
2. **#1111** — `checkParticipantIdentityParity` reports drift for *every*
   post-#575 patient, so the gate #574's plaintext removal depends on can
   never open. Latent (runs on no stack), proven with a run.
3. **#1113** — small, and it makes a live import path stop nulling civil
   identity it never meant to touch.

## Gates — Docker NOT run, full native suite NOT run

- **`npm run test:architecture` 124/124**, twice.
- **Consumer sweeps, both green:** #1109 111 files / 3001 tests; #1104 54
  files / 1802 tests. Named-vs-executed reconciled both times (the shortfall
  is `tests/architecture/**`, excluded by `vitest.config.js`).
- **Can-it-fail probes, both valid:** #1109 5 red / 33 passed, 38 executed;
  #1104 7 red / 148 passed, 155 executed — each equal to its own green
  baseline (#804) and N-shaped (#682).
- **Full native suite NOT run this sitting.** Last known green is 466 files
  / 8783 tests, from the previous note, and it predates both commits here.
- **Docker NOT run.** Dennis said it was on; the gate is end-loaded.
  **No stack running, no volumes created by this sitting.** The previous
  note's 35 anonymous volumes and `api/backend/coverage/` (33MB) are
  untouched and still need Dennis.

## The judgment a query cannot carry

- **A backgrounded command ending `; echo "exit=$?"` makes the task
  notification report exit 0 no matter what.** `[ran it]` a sweep whose
  notification said *"completed (exit code 0)"* had **5 genuinely failing
  tests**; only reading the redirect caught it. The trailing `echo` is the
  pack's own prescribed anti-laundering idiom (#823) and it is correct in
  the foreground — backgrounded it launders the notification instead. Pack
  #766, recurrence commented. **Read your redirect, never the notification.**
- **A `-- <path>` pathspec naming a file that does not exist returns empty
  at exit 0.** `[ran it]` I wrote `:(top)docker-compose.yml` in a wiring
  sweep; this repo has `compose*.yml` and no such file, so the sweep proved
  nothing while reading like a clean zero. #654's class, new half: the
  *scope target itself* can be fictional.
- **In a scratchpad script, `fs` paths are cwd-relative but `require` paths
  are script-relative.** `[ran it]` three patch scripts using only `fs`
  worked, then a probe script's relative `require` died `MODULE_NOT_FOUND`.
  The working half builds confidence in the broken half. Pack #814.
- **Derive a consumer list with an explicit `\.(test|spec)\.js$` filter.**
  `git grep -l` filters by *content*, so helpers and factories enter the
  list and the executed-count alarm trips benignly — which trains waving it
  off. Pack #840; the filtered form reconciled exactly on the second sweep.
- **Grep failure detail on `^AssertionError`, anchored.** `[ran it]` a bare
  `TypeError` in the alternation matched this repo's own stderr and buried
  two real failures. Pack #683's class, in the *detail* grep rather than the
  summary one, where no anchored spelling is shipped.
