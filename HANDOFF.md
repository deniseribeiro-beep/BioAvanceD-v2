# HANDOFF

**Written:** 2026-08-25 (second sitting of the day). Dennis asked for a
group of 5-10 issues; ran `issue-loop` **queue mode** over a self-picked
6-issue queue and closed every member. All six were RF008 (reports) or
RF013 (backup) findings filed by earlier sittings.

## What closed this sitting

Each landed as its own `fix/<slug>` branch, merged `--no-ff`, closed,
branch deleted local+remote.

- **#741** (`d399b3e3`) -- `handleSamplesByPatient`/`handlePatient` gated
  the `participantId: {$in: ...}` clause on the id list being non-empty.
  `getMatchingPatientIds` returns `[]` for two different situations, so an
  active-but-unmatched filter silently stopped applying, and
  `status=QUARANTINE` on a clean database returned the whole patient
  directory. Now gates on `sampleQuery` being non-empty.
- **#739** (`b5cbda23`) -- RF008 AC#1's other five filter dimensions wired
  into `buildSampleQuery`: periodo (`$or: [registeredAt, createdAt]`),
  colecao (`collectionId`), tipo/origem (`sampleType`/`sampleOrigin`,
  upper-cased MIABIS ids), localizacao (`storageLocation.boxId` plus
  `.position`, unparseable boxId fails closed).
- **#732** (`01f59e5d`) -- `GET /:type/filters` resolves `:type` through
  the ReportTemplate `handlerKey` and returns a per-handler catalog
  derived from what each handler actually reads off `filters`. Six
  handlers correctly return an empty list. Also fixed the `status`
  options, which were Ativo/Inativo and could never match anything.
  **Two behaviour changes:** unknown type is now 404 (was a confident
  wrong 200), and the route gained a 503 guard since it now reads the DB.
- **#740** (`89344e96`) -- BackupPage renders run status (badge) and
  checksum (12-char prefix, full value on `title`). Two exported pure
  helpers, unit-tested per this repo's frontend-test convention. 6 i18n
  keys across 3 locales.
- **#731** (`8470b63f`) -- `startRestoreTestSchedule(db)` runs the
  sandboxed restore test weekly (`0 5 * * 0`, override
  `RESTORE_TEST_CRON`). **Cadence was my call** -- RNF010 AC#5 says
  "periodicamente" and names none; offset past the daily backup (03:00)
  and retention sweep (04:00) because a restore test replays every
  collection into a scratch db.
- **#738** (`ace3e5c0`) -- `mongodb-tools` added to `Dockerfile.dev` and
  `Dockerfile.prod`, and the JSON fallback now serializes with canonical
  Extended JSON so BSON types survive a restore. Legacy plain-JSON
  backups still restore (pinned by a test).

No product-source change was made outside these six issues' own scope.

## Filed this sitting, all open

- **#748** -- ReportQueryPage exposes none of #739's five new dimensions
  in the UI. Was `Depends on: #732`, which is now closed, so it is
  unblocked; tipo/origem want #732's catalog rather than a hardcoded copy.
- **#749** -- `RETENTION_SWEEP_CRON` is read by `scheduler.service.js`
  but never registered in `env.js`, so that override has always been dead
  and the sweep is pinned to `0 4 * * *`. One-line fix. Reproduced with a
  registered sibling as control.
- **#750** -- `runControlledRestoreTest` leaks its scratch database on
  **both** failure paths (`dropScratchDatabase` is only called on the two
  success paths). Was a rare manual artifact; #731 makes it recurring and
  unattended. **Worth landing before the new schedule is relied on.**
- **#751** -- decision record: #738 put `mongodb-tools` in
  `Dockerfile.prod`'s runtime stage. Necessary (the backup runs inside
  that container) but it is a production attack-surface change nobody
  signed off. Needs an accept/reject, not code.

Skills-pack: **#408** (auto-mode Bash edits flatten CRLF; plus heredoc
escape-mangling and a `git add -A <dir>` trap, added as comments),
**#409** (auto mode routes every edit through Bash, so all
Edit/Write-scoped gates are inert for a whole session -- routing is only
caught at the close gate, after the work has shipped), **#410**
(fix-bugs overlay's "remote branch deletion is commonly denied" -- 6/6
succeeded this session), **#411** (`typecheck:full` is clean, exit 0, so
the overlay's grep-your-own-filenames workaround is now worse than just
running it). Earlier: #404-#407 still open.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed, in sync with
  origin at `ace3e5c0` plus this rotation. No `fix/`/`test/` branches
  from this sitting remain.
- **Four older local branches still exist** and the previous handoff was
  wrong to say none did: `fix/599-ci-trigger-integration-branch` and
  `fix/599-hold-ci-trigger-for-milestone` are both merged into the
  integration branch (safe to delete); `test/377-docs-on-main` and
  `test/human-showcase-video` are **not** merged and were left alone.
  #599 itself is intentionally open, held by the CI milestone's
  sequencing.
- **Docker is DOWN and the gate has NOT been run this sitting.** Every
  native check is green, but four e2e assertions were un-weakened and
  none has been executed:
  - `scientific-data-access.spec.ts` -- RF008 AC#1 now asserts the
    participant row is *absent* under a non-matching status (#741), and
    proves tipo both ways (#739).
  - `pipeline-continuity.spec.ts` -- the RF013 UI test now asserts the
    status badge and checksum cell (#740), and **requires
    `mode === 'mongodump'` (#738)**.
  - **The #738 assertion needs the backend image rebuilt (`--build`).** A
    json-fallback result there means the rebuild did not happen, not that
    the fix is wrong.
- Two untracked paths still present and deliberately untouched:
  `.claude/skills/` and `api/backend/storage/assays/`. **Do not
  `git add -A` a directory containing them** -- a file under the second
  one was swept into a commit this sitting and had to be amended out
  before push.
- No open PR; nothing pushed to `main`; `main` stays frozen.

## Carried forward, re-confirmed this sitting

- **Don't use `npx tsc`** -- reproduced again; the root has no
  `typescript` dep, so npx fetches an unrelated prank package that prints
  a banner and exits 0. Use `npm run typecheck`, or
  `node frontend/node_modules/typescript/bin/tsc --noEmit -p <config>`.
- `npm run typecheck:full` (from `frontend/`) is **clean, exit 0** as of
  today -- this contradicts the skill overlay; see pack #411.
- `npm run test:smoke` refuses any change touching `env.js` (228 affected
  files by require-graph) and points at the full unit suite instead.
- Host Playwright run against the stack:
  `PLAYWRIGHT_BASE_URL=http://localhost:5173 PLAYWRIGHT_API_BASE_URL=http://localhost:3000 PLAYWRIGHT_SKIP_WEBSERVER=1 TEST_USER=admin TEST_PASS=Admin@123 E2E_MONGO_URI="mongodb://localhost:27017?directConnection=true" E2E_MONGO_DB=bioavanced_test E2E_NEO4J_DATABASE=neo4j TEST_SUPPORT_SECRET=e2e-test-support-secret npx playwright test [spec] --workers=1`
- Older open findings from earlier sittings: #733, #734, #735, #729.

## Recommended next steps

None queued -- Dennis has not named the next piece of work. The obvious
candidate is the **Docker gate**, since this sitting shipped four un-run
e2e assertions and a Dockerfile change; that needs his go (it is
expensive, and the backend image needs `--build`). After that,
`ship-integration-branch` is the natural follow-on, which needs his
explicit go separately because it means a PR.

If he wants more backlog instead: **#750** is the most time-sensitive of
the newly filed set (it degrades weekly now that #731 has landed),
**#749** is a one-line fix, and **#751** needs a decision rather than
code. **#733/#734/#735** were deliberately excluded from this sitting's
queue -- each one's body states it is a product/design call, and they
were left rather than stalling the queue on owner questions.
