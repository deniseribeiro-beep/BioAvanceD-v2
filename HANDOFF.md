# HANDOFF

**Written:** 2026-08-20. Picked up right after the prior rotation's close
(#654/#655/#653 landed, one regression caught). Dennis asked to continue
straight to RF024 (#646 Wave 3's next unstarted item) rather than address
the prior rotation's six follow-ups first. This sitting built and shipped
RF024 end-to-end and filed five more follow-ups.

## RF024 (Solicitações de acesso e distribuição) — shipped, merge `7ca99900`/`adbc1bd9`

Unlike RF014-017 (mostly wiring up pre-existing code), **zero code existed
for this RF at all** — dict-07/dict-08 don't flag it because it falls
outside those tables' curated domain list, not because it was partially
built. New `AccessRequest` entity (dict-02 ELM-0388..0395), built as a
plain validate/create class + raw-driver service/controller/routes,
matching the established pattern for this generation of entities
(`Study`/`PatientConsent`/`RetentionPolicy`/`TerminologyConcept`), not
Mongoose.

All 5 acceptance criteria proven against the real backend:
- **AC#1** — `POST /api/access-requests` registers requester/study/
  purpose/items.
- **AC#2** — `POST /:id/evaluate` checks three real dimensions: consent
  (the requested specimen's real linked participant needs an ACTIVE
  `PatientConsent`), DUO (an optional `duoCode` resolves against a real
  `TerminologyConcept` under DUO's systemUri), and access policy (the
  destination `Study` must be `active` — no dedicated `AccessPolicy`
  engine exists yet, so this reuses RF021's own Study-status gate as the
  honest available proxy; see #663).
- **AC#3** — `POST /:id/decision` records committeeDecision
  (approved/rejected/conditioned) + justification + approvalPeriod, only
  after compatibility has actually been evaluated.
- **AC#4** — `POST /:id/distribute` links approval to
  distribution/availability, gated on the access being currently
  allowed. Scoped to `AccessRequest`'s own `distributionStatus`, not the
  separate `Shipment` entity (dict-02 ELM-0396+, `Condicional` priority,
  a different domain) — see #660.
- **AC#5** — `GET /:id/access-check` computes allow/block live from
  stored state every time (pending/rejected/revoked/expired/
  not-yet-active all block); `POST /:id/revoke` reverses a previously-
  approved decision.

Gated behind one new permission, `manageAccessRequests` (coordinator +
administrator) — neither RF024's "Pesquisador" nor "comitê responsável"
actor maps to this repo's 4-role model. Whether that grant is too broad
for a real committee decision is flagged, not decided, in #662.

**Real bug found and fixed along the way:** `rbac-catalog-seed.service.js`'s
role-upsert returned an already-seeded role untouched, so granting
`manageAccessRequests` to the existing coordinator/administrator roles
never actually reached them on re-seed — this directly blocked the e2e
proof (403s until fixed). Fixed by merging freshly-computed
`permissionIds` into the existing role instead of skipping it outright;
`roleId` stays stable. **Re-seeding the RBAC catalog against the running
stack is a manual step** (`node src/scripts/seedRbacCatalog.js` inside
`backend-app-test`) — it is *not* triggered by a container rebuild or
restart on an already-bootstrapped stack; only a genuinely empty `users`
collection re-triggers it automatically. Filed as a workflow-precedent
note, `dyeallpies-skills-pack#351`, not a product issue (the fix itself
is already merged here).

Also fixed `tests/unit/config/collections.test.js`'s hardcoded
expected-defaults list — already stale by 3 keys
(`notificationRules`/`notifications`/`labelGenerations` from RF014/016)
before this slice's `accessRequests` made it 4. Pre-existing gap, not
this slice's regression, but it was failing and directly in the way of a
clean full-suite run.

Verification: unit 63/63 new (14 model + 25 service + 24 rbac-catalog-
seed, including a new test proving the merge-on-reseed fix) — full
native suite 6296/6296 (317/317 files) after the collections.test.js
fix. E2E 3/3 new in `specimen-quality-inventory.spec.ts`'s sibling file,
`scientific-data-access.spec.ts` — happy path (evaluate → approve →
distribute), rejected + revoked blocking, and expired-period blocking,
all live against Docker.

## Five follow-ups filed this sitting

- **BioAvanceD-v2#660** — `Shipment` entity (dict-02 ELM-0396+,
  sender/recipient/carrier/MTA tracking) not built; RF024 AC#4 satisfied
  via `AccessRequest`'s own lighter-weight `distributionStatus` instead.
- **BioAvanceD-v2#661** — `evaluateCompatibility`'s consent check only
  resolves a real participant for `itemType: 'specimen'` — `'dataset'`/
  `'file'` items silently skip consent verification (non-blocking null),
  not de-identified-by-design vs. genuinely unchecked.
- **BioAvanceD-v2#662** — question for Dennis/Denise: is
  `manageAccessRequests` (coordinator+administrator) too permissive for
  a "comitê responsável" decision, vs. this repo's own
  `reidentifyParticipant` precedent (administrator-only for a comparably
  sensitive action)?
- **BioAvanceD-v2#663** — AC#2's "políticas de acesso" leg has no real
  `AccessPolicy` entity to evaluate against (dict-02's P1X-0127 is only
  a P1X/not-yet-consolidated row); proxied via `Study.studyStatus`.
  Scoping question: Fase 1 gap to close now, or genuinely Fase 3 per
  RF024's own "F1 contrato / F3 operação" status line?
- **dyeallpies-skills-pack#351** — the RBAC-reseed-is-manual operational
  fact above, proposed as a new `build-loop` BioAvanceD-v2 overlay
  gotcha (not edited directly this sitting — `.claude/skills/` is a
  junction, editable only from a session in the pack repo itself).

Also commented on **dyeallpies-skills-pack#350** (still open): the
pre-action routing gate fired again mid-`build-loop`, third confirmed
occurrence and first one not involving `fix-bugs` — corroborates the
gate's detection window is too narrow generically, not
`fix-bugs`-specific.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed through the RF024
  merge (`adbc1bd9`). Working tree clean except the gitignored/junctioned
  `.claude/skills/` and the pre-existing untracked
  `api/backend/storage/assays/` (neither this sitting's doing).
- No PR to `main` exists.
- **Docker**: `backend-app-test` was rebuilt to pick up the RF024 code
  and re-verified (3/3 new e2e passing), and the RBAC catalog re-seeded
  against it (22 permissions, 5 roles, `manageAccessRequests` live) —
  then **torn down at end of session** (`compose down`, no `-v`, this
  sitting's own `clean-up` decision since it had been inherited
  already-running from the prior rotation with nothing queued needing
  it up). Per `docker-workflow`'s own `mongodb-test-data` gotcha, a
  plain `down` doesn't drop that named volume, so the RBAC seed
  (persisted in Mongo, not the image) should still be there on the next
  `docker compose ... up -d --wait <services>` bring-up — but confirm
  with a quick `manageAccessRequests`-gated call rather than assuming,
  since this wasn't re-verified by actually bringing the stack back up.
- Two pre-existing dangling local branches, still untouched:
  `test/377-docs-on-main`, `test/human-showcase-video`. Neither merged
  anywhere. (The slice branch this sitting used,
  `test/646-rf024-access-requests`, was deleted locally after merging —
  matching how `fix/654-*`/`fix/655-*` were handled last rotation.)

## Recommended next steps

None queued — Dennis hasn't said what to pick up next. **#646** (8-RF
Wave 3 tracking issue) is still the active thread: 5 of 8 done
(RF014/015/016/017/024), RF025/026/029 remaining. #646's own scope table
flags RF025 as needing a scope-overlap check against this session's own
`Assay` entity (#641/#643) before building, if it's picked up next.
