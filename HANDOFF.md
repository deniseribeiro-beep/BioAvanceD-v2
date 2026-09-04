# HANDOFF

**Written 2026-09-04, sixteenth queue sitting. INTERIM — no end signal
given, so treat the session as CONTINUING.** Dennis asked for "the next 10
issues, Docker is on." **8 of the 10 are closed**, a ninth (`#1053`) has its
load-bearing slice shipped and stays open as a tracking issue, and the tenth
(`#1072`) is researched but deliberately not shipped — see below.

**BOTH GATES RAN AND BOTH ARE GREEN.**

- **Native regression** `[ran it]` the sanctioned three-directory form:
  **462 files / 8615 tests / 0 failures, exit 0, 613s.** Past the Bash tool's
  600s ceiling, so background it and grep your own redirect. The count moved
  **8544 -> 8615** against the previous sitting; the 71 are this sitting's
  own additions.
- **Architecture suite** `[ran it]` `npm run test:architecture` natively —
  **122/122, exit 0.** Note vitest does NOT run these; they are `node --test`.
- **Docker gate** `[ran it]` the exact command CI's `current-state-validation`
  runs: `docker compose --env-file .env.test.example -f compose.test.yml run
  --rm --no-deps backend-unit-runner` -> **exit 0**, and all four chained
  steps completed: architecture **122 tests / 108 pass / 0 fail / 14
  skipped**, essential reference-data validation passed, dictionary catalog
  **929/929 (v1.3.0)**, compliance evidence generated. That four-step chain
  completing is the property #1059 restored, and it still holds.
- **Nothing left running.** `docker ps -a` empty. **No image was built** —
  the gate reused the 9-hour-old `backend-unit-runner` image — and the
  builder cache is **610.5MB, unchanged**.

Re-derive all three rather than trusting this paragraph.

Re-derive every count below rather than trusting it.

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`. `main` untouched, no PR.
  `git status -sb` and `git log` are authoritative.
- **8 substantive commits this sitting**, last is the `#1021` MFA fix.
- **No new env keys, no new npm scripts, no new dependencies, no compose
  changes.** Everything this sitting is application code and tests.
- Two new permission codes exist in `PERMISSION_CATALOG` — `manageSensor`
  (`Device`, CRUD) and `recordTemperature` (`Temperature`, CREATE) — both
  seeded to exactly the three roles that already held `viewTemperature`, so
  **no caller gained or lost a capability**. That was deliberate: it makes
  "should a Tecnico delete a sensor?" a catalogue edit rather than a code
  change, and that question is still Denise's.

## What shipped

Query the board rather than trusting a list: `gh issue list --state open`.

`#1073` `#1064` `#1058` `#1061` `#1050` `#1071` `#1062` `#1021` closed.
`#1053` slice A shipped, issue left open as the class tracker.

Three of those are one commit: `#1058`/`#1061`/`#1050` had to land together,
because fixing `#1058` alone would have made the export **wider** — the
custody-ledger rows it un-hides carry `ipAddress`, `userAgent` and the
ledger hash chain.

## The judgment a query cannot carry

- **`#1072` is not blocked — I chose to stop on it, and the reason changes
  the issue.** `[read it]` `auth.service.js`'s enrolment guards key on
  `user.mfaSecret` being **truthy**, and `decryptValue` returns `null` on
  every failure. So encrypting the field as `#1072` describes turns a
  rotated/missing key into a **silent MFA bypass** — the guard is skipped
  and the login proceeds with no second factor. Encryption must land with a
  re-keying of those guards, not before it. Sequencing is on the issue.
- **`ENCRYPTION_KEY_ID` cannot carry a rotation.** `[read it]`
  `config/keyRegistry.js` holds at most one key (`// Suporte a chave legada
  removido`), so RNF020 AC#5 ("rotacionados sem alteração de código") is
  unsatisfied and rotating orphans every envelope into a `null`.
- **`#1083` is the most serious NEW finding.** `[read it]` `encryptValue`
  fails **open** — a `warn` and a `null` — and every caller treats `null` as
  "skip", leaving the plaintext. Both shipped env templates ship
  `ENCRYPTION_KEY` blank and nothing validates it at boot. Field-level
  sibling of the closed `#938`/`#734`; the remedy shape is theirs (an
  `assert...Configured()` at the call site, **not** a change to
  `encryptValue`'s return contract).
- **An issue's "smallest change" can be broken by a mechanism it does not
  mention.** `#1073` proposed swapping onto `manageTemperature`; `[read it]`
  that code is `allowedActions: ['UPDATE']` and `requirePermission` enforces
  the derived action (#631), so the swap would have 403'd every CREATE and
  DELETE. `rbac-catalog-seed.service.js` already records the identical trap
  for `manageStorageTopology` (#929). **Read a permission's
  `allowedActions` before repointing a route at it.**
- **A comment on an adjacent file can dissolve a proposed slice.**
  `#1053` recommended `dataset-file.routes.js` as its cheapest first slice;
  `[read it]` that file's own header explains it omits org scope because
  Dataset has no organization field in dict-02 (ELM-0416..0423, verified).
  Recorded on `#1053`; the recommendation is struck.

## Conventions this sitting relied on / established

- **Under auto mode, write a non-trivial source edit as a script file via
  the `Write` tool and run the file.** Two independent guards stand in the
  heredoc path — the ~8.1 KB command-assembly ceiling and
  `backslash-collapse-guard` — and you meet them in sequence. Filed as
  pack#771. **And pass an explicit count on every replace**: `str.replace`
  replaces ALL occurrences where the `Edit` tool would have refused a
  non-unique match. One unbounded call reddened 27 tests here.
- **A derived consumer list can contain both test runners.**
  `tests/architecture/*.arch.test.js` is `node --test`; `npx vitest run
  $(cat consumers.txt)` silently ignores those entries and still exits 0.
  Compare the reported file count against `wc -l` every time. Hit twice.
  Filed as pack#772.
- **`git grep` flags must precede the pattern** — `git grep "pat" -A3`
  parses `-A3` as a *revision* and dies. GNU `grep` accepts either order,
  which is why it recurs. Filed as pack#770.
- **The `#682` all-sites probe earned its keep twice.** Both times a
  changed site turned out unpinned and only the whole-change revert showed
  it — the `#1062` scheduler stamp, and a "CONTROL" that had silently
  stopped being one.
- **`assertOrganizationIdResolves` is an EXISTENCE check, not a scope
  check.** It is the single most load-bearing correction of the sitting:
  naming a real organization you do not belong to passed it, on every
  create and every update. `resolveOrganizationIdForCreate` (#1071) and
  `assertOrganizationFieldNotReparented` (#1053 slice A) are the two
  helpers that now decide it, and they live beside the other scope
  primitives in `rbac-assignment.service.js`.

## Pile-up (the numbers `issue-loop` rung 3 asks for)

**8 discharged (+1 partial), 10 product issues filed** — `#1074` through
`#1083` — plus 6 pack issues filed and 2 reopened on recurrences. **The
backlog grew.** No `rabbit-hole` conversion is claimed: agent slots were
free throughout and unblocked work remained, which `#590` says disqualifies
one. Where the sitting stopped it says so plainly.

## Recommended next

**Dennis named no successor to the ten**, so: none queued.

Both gates are green, so nothing is owed there. `#1083` is the
highest-value open item (a live plaintext-at-rest defect with
a precedent-shaped remedy), and it is a **prerequisite for `#1072`**.
`#1081` (equipment PUT/DELETE, both failure modes) is the cheapest of the
`#1053` children.
