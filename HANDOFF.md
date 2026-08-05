# HANDOFF

**Written:** 2026-08-05, end of session on `feature/docker-e2e-backend-integration`,
after landing and merging #447, and correcting #446/#448/#439's premise.

## What happened this session

Picked up **#447** (Dennis: "Pick #447") via `resolve-issue`. Before
editing, the canonical-data-model guard hook required reading
`docs/docs-7-27-2026/extracted/dict-02_DICIONARIO.md` and
`requisitos-index.md` — that read overturned the premise both #446 and
#447 were filed on.

**Key finding: #446 had the canonical direction backwards.** The
dictionary (rows P1X-0326/P1X-0327) states `resourceType`/`resourceId`
are the canonical Log fields ("Substitui o alias entity"/"Substitui
entityID"), not `entityType`/`entityId` as #446 assumed and #447's body
took for granted. `resourceType`/`resourceId` have **always** been
written to the `logs` collection (predates #446, confirmed via
`git show abb04202:...Log.js` — no dual-write gap ever existed there).
Separately, `audit-v2.service.js`'s `audit_events` collection has its
own **already-established, hash-chained schema** (RNF009,
`schemaVersion: 'audit.event.v1'`) that also happens to use
`entityType`/`entityId` as field names — that schema is unrelated to
Log.js's fields and must not be renamed (would break the Merkle hash
chain).

Given this, #447's literal ask (migrate readers to canonical, delete all
legacy-alias fallback reads) was unsafe as written — real callers (tests,
legacy code) still pass `entity`/`entityID`/`status` directly, and
literal removal would break them. Routed through `divide-and-conquer`,
confirmed the narrowed scope with Dennis via `AskUserQuestion` (twice —
once on the chunking direction, once on the corrected fix itself) before
implementing.

**Implemented:** flipped the field-read precedence in
`audit-v2.service.js`'s `ingestLogRecord` (api/backend/src/services/audit-v2.service.js:114-115)
to prefer `logRecord.resourceType`/`logRecord.resourceId` over
`logRecord.entity`/`logRecord.entityID` when mapping into the
`audit_events` schema's `entityType`/`entityId` slots. This precedence
bug predates #446 (introduced by the unrelated #369 fix on 2026-08-01),
so it wasn't something #446 broke — just something #447's investigation
surfaced. Did **not** remove any fallback reads elsewhere (Log.js,
auditLogger.js, log.service.js's query filters) — those stay as
deliberate, still-needed dual-reads.

**Verification:** targeted tests only, per this session's scope —
`audit-v2.service.test.js`, `log.service.test.js`, `log.model.unit.test.js`,
`auditLogger.test.js`, `logger-audit-trail.test.js`: **153/153 passing**,
both pre-merge and re-run on the merged integration branch. No full-suite
sweep this session (not requested, not needed for a 1-file precedence fix).

**Shipped:** committed on `fix/447-canonical-log-readers` (`446ce757`),
pushed, issue commented and closed. Fast-forward merged into
`feature/docker-e2e-backend-integration`, pushed. Branch deleted (local +
remote).

**Corrected the record** on the two other issues in this cluster rather
than filing new ones (found #448 already exists and is the right home
for the redirected remainder):
- **#446** (closed, prior session): commented noting the dictionary
  contradicts its premise; no code was actually broken since Log.js's
  real output already favored `resourceType`/`resourceId` — #446 only
  changed *input*-alias read order and 26 call sites' parameter names to
  `entityType`/`entityId`, which is harmless but non-canonical naming.
- **#439** (tracking issue, still open): commented pointing at #446/#447
  for the correction; no other action.
- **#448** (open, now unblocked): commented correcting its scope
  direction — the "final sweep" should migrate remaining
  `entity`/`entityID`/`status`-passing call sites and `auditLogger.log()`'s
  non-canonical `entityType`/`entityId` options-contract naming **onto**
  `resourceType`/`resourceId`, not the reverse. Explicitly noted
  `audit_events`'s own `entityType`/`entityId` field names must stay
  unrenamed. This is the natural next pickup.

**Friction/process note (handled inline, not filed):** the
`resolve-issue`/`divide-and-conquer` skills' existing playbooks are
written for "issue is too big" or "premise depends on undone work" — this
session's actual shape (issue's premise is backwards per an authoritative
doc) fit awkwardly but `divide-and-conquer`'s general "re-scope out loud,
confirm with user, ship a load-bearing slice, file/correct the
remainder" loop still applied cleanly. No skill-file edit made; if this
shape recurs, `divide-and-conquer` may want a named case for it.

## Repo state

- **`feature/docker-e2e-backend-integration`**: has #447's commit
  (`446ce757`), pushed, clean working tree, up to date with `origin`.
- Issues: **#447 closed** (merged, commented, narrowed scope explained).
  **#446 closed** (prior session) — correction comment added, not
  reopened (no code was actually broken). **#448 open, now unblocked**
  (both #446 and #447 satisfied) — scope corrected via comment, ready to
  pick up. **#439** still open as the tracking issue.
- Backlog otherwise unchanged: older backlog (`#371`/`#373`/`#374`/
  `#378`/`#379`), **#389**. dyeallpies-skills-pack#216, #210 still open,
  not yet applied.
- Carried-forward `user.accessType` grep sweep — still not done, still
  tied to `user.model.unit.test.js`'s `getRoleName` failure (last
  reconfirmed present in #446's session full-suite run; not re-checked
  this session since no full suite was run).
- Merged remote branch `fix/444-retention-period-iso8601` — not
  re-checked this session, carried forward as still-probably-safe-to-
  delete housekeeping.

## Dev stack state

Untouched this session — all verification was native `vitest run`, no
Docker involved. Last known state (from #425's session): dev stack torn
down, named volumes kept, RBAC catalog seeded on that stack instance, 0
real users.

## Blocking next step

None. **#448** is the natural continuation — it's now unblocked and its
scope has been corrected in-thread to match the dictionary's actual
canonical-field direction (see comment above). A fresh session (or this
one, resumed) should start there: branch `fix/448-<slug>` off
`feature/docker-e2e-backend-integration`, sweep `api/backend` for
remaining `entity`/`entityID`/`status`-passing call sites and consider
whether `auditLogger.js`'s `entityType`/`entityId` options-contract names
(from #446) should be renamed to `resourceType`/`resourceId` for
consistency — while leaving `audit-v2.service.js`'s `audit_events` schema
field names (`entityType`/`entityId`) untouched, since those are a
separate, hash-chained, already-shipped schema.

## Recommended next steps

- **#448** — pick this up next; read this session's comment on it before
  starting, since it redirects the sweep's actual direction versus the
  issue's original body text.
- Everything else unchanged from the prior handoff: **#439**'s backlog
  neighbors, **#389** (route through `divide-and-conquer` first), the
  `user.accessType` grep sweep, and the `fix/444-retention-period-iso8601`
  branch housekeeping — none of these were touched this session.

## Which skills to use

- #448: `resolve-issue` directly (already classified as a repo-wide
  sweep, not a `work-issue` dispatch). Branch `fix/448-<slug>` per the
  branch-guard allowlist. **Read `dict-02_DICIONARIO.md` rows
  P1X-0326/P1X-0327 (or this handoff's summary of them) before assuming
  which field name is canonical** — #446 and #447's own issue bodies got
  the direction backwards, so don't trust the issue text's field-name
  framing at face value; verify against the dictionary directly.
- Any future edit to `api/backend/src/models/Log.js`,
  `api/backend/src/utils/auditLogger.js`, or
  `api/backend/src/services/audit-v2.service.js` will trigger the
  canonical-data-model guard hook requiring a read of
  `dict-02_DICIONARIO.md`/`requisitos-index.md` first — this is working
  as intended (it's what caught this session's finding) — don't try to
  route around it.
- No new local-env or repo-slug gotchas this session. Repo slug
  (`deniseribeiro-beep/BioAvanceD-v2`) confirmed correct for all issue
  operations (5 comments across #447/#446/#439/#448, 1 close via
  comment) — no classifier denials this time.
