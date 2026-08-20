# HANDOFF

**Written:** 2026-08-20. Picked up right after the prior rotation's close
(RF024 landed, five follow-ups filed). Dennis gave explicit go-ahead to
continue #646 as a `rabbit-hole` descent — divide-and-conquer at will,
no mid-workflow prompts, questions saved for his return. This sitting
built RF025 and RF026 end-to-end, split RF029 into 6 buildable slices,
and fixed a stale status table found along the way.

## What landed this sitting

- **RF025 (Ensaios, reagentes e não conformidades) — shipped, merge
  `1d8221b9`.** New `ReagentLot`/`Nonconformance` entities; `Assay`
  (#641) extended with `reagentLotIds`/`equipmentIds`/structured
  `controls`. Unit 79/79 new, e2e 3/3 new (`specimen-quality-inventory.spec.ts`,
  live Docker). Full writeup: #646's "RF025 ... landed" comment.
- **RF026 (Retenção e destinação) — shipped, merge `365808f4`.** New
  `LegalHold`/`DispositionAction` entities; `RetentionPolicy` (RF014)
  reused as-is. `DispositionAction.retentionPolicyId` is checked against
  a real policy document (not just format-validated) — the referential-
  integrity discipline #664 flags as *missing* elsewhere. Unit 49/49
  new, e2e 4/4 new, live Docker. Full writeup: #646's "RF026 ... landed"
  comment.
- **RF029 (Ingestão operacional e científica) — split, not built.**
  Confirmed its stated dependency (RF022/RF028) is satisfied — both are
  genuinely complete in code; `E2E_TRACEABILITY_PLAN.md`'s RED status for
  them was stale (git-blamed to 2026-07-27, before #366/#370/#381/#549/
  #551/#552/#557/#374 all landed). RF029 itself is structurally
  different from RF014-026 (10 ACs, ~10 non-uniform entity kinds, one
  with a real external dependency) — ran `divide-and-conquer`'s
  design-split playbook instead of forcing a build-loop slice. Filed
  **#668** (RF029's own tracking issue) with 6 dependency-ordered
  sub-issues: **#669** (foundation — gateway shape, provenance envelope,
  contract validation, active-code check, idempotency, quarantine;
  blocking for the rest), **#670** (participants/consents/specimens/
  clinical), **#671** (telemetry), **#672** (files), **#673** (datasets/
  assays), **#674** (workflows/omics — additionally blocked on **RF027**,
  Wave 4, not yet started, which is the RF that actually defines the
  `Workflow`/`Omics*` entities RF029 AC#5 names).
- **Doc fix**: `E2E_TRACEABILITY_PLAN.md`'s RF014/015/016/017/022/024/
  025/026/028/029 status cells were stale (some since 2026-07-27) —
  corrected in the same pass, separate small commit.

Full native suite re-run after RF026: **384/384 files, 7282/7282 tests
green** — no regressions from either slice.

## Nine follow-ups filed this sitting (all still open)

- **#664** — Assay's specimen/protocol/operator/laboratory/reagentLot/
  equipment links are format-only, no referential-integrity check.
- **#665** — Técnico (RF025's own primary actor) can't actually create
  an Assay or ReagentLot today (`requireRole(3,4)` via the shared
  `createMasterDataRouter`), even though this slice's own Nonconformance
  "open" route correctly lets them.
- **#666** — dict-02's `Device` entity (calibration/qualification/
  firmware tracking) is richer than the code's `Equipment` model.
- **#667** — `RetentionPolicy`'s `ALLOWED_ENTITY_TYPES` (`AuditEvent`/
  `Log` only, from RF014) limits what RF026's new `DispositionAction`/
  `LegalHold` can practically govern to log housekeeping, not the
  specimens/samples/participant records RF026's own text implies.
- **#668-#674** — RF029's tracking issue + 6 sub-slices (see above).

## Rabbit-hole state: still open, not exited

**#646 stays open** (8/8 Wave 3 RFs won't be done until #668's 6 slices
land) and **so does #668** (RF029's own tracker, same reason one level
down). Next concrete pickup whenever this resumes: **#669** (RF029's
foundation slice) — everything else in #668 is blocked on it. Both
issues carry the full queue state; this file is a snapshot, not the
source of truth for what's left.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed through the doc-fix
  merge (latest: `69ae8d08` plus this rotation's own commit). Working
  tree clean except the gitignored/junctioned `.claude/skills/` and the
  pre-existing untracked `api/backend/storage/assays/` (neither this
  sitting's doing).
- No PR to `main` exists.
- **Docker**: test stack (`compose.test.yml`) was up most of this
  sitting (rebuilt twice — RF025's new files, then RF026's), **torn down
  at end of session** (`compose down`, no `-v` — `mongodb-test-data` and
  other named volumes untouched, so prior fixtures/RBAC seed persist for
  the next bring-up). Builder cache pruned (`docker builder prune -af`,
  889.3MB reclaimed). WSL2 vhdx checked: 15.63GB physical — unremarkable,
  no reset needed.
- All 3 of this sitting's slice branches (`test/646-rf025-...`,
  `test/646-rf026-...`, `test/646-traceability-plan-staleness-fix`) were
  merged and deleted locally; none were ever pushed remotely, so no
  remote cleanup needed.
- The two pre-existing dangling local branches (`test/377-docs-on-main`,
  `test/human-showcase-video`) remain untouched, as before.

## Open questions for Dennis (saved for his return, not asked mid-sitting)

1. **#665** — should a Técnico actually be able to create an Assay/
   ReagentLot directly, or is Coordenador-only creation intentional
   (e.g. a Técnico works under a Coordenador's registration)?
2. **#666** — worth extending `Equipment` with dict-02's fuller `Device`
   shape (calibration/qualification/firmware tracking), or leave that
   aspirational until a requirement actually needs it?
3. **#667** — is RF026 intentionally scoped to log/audit retention for
   now (matching RF014's existing `ALLOWED_ENTITY_TYPES` restriction),
   or should real biobank records (specimens/samples/participant data)
   be in scope for a near-term follow-up?
4. **RF029/#668 sizing** — the 6-slice split is designed but nothing is
   built yet; confirm this is still the right next thing to pick up
   versus other backlog priorities, and whether #674 (workflows/omics)
   should wait for RF027 to be scheduled first or stay parked
   indefinitely until then.

None of these blocked this sitting's work — each is flagged on its own
issue and safe to leave open indefinitely; surfacing them together here
since Dennis asked not to be interrupted for them individually.

## Recommended next steps

Dennis hasn't picked a next task beyond "continue #646," which this
sitting did to a natural stopping point (two RFs shipped, the third
properly scoped rather than half-built). Next session: either build
**#669** (RF029's foundation slice, unblocks 4 of the remaining 5), or
pick up something else entirely — both #646 and #668 will still be there
with accurate state either way.
