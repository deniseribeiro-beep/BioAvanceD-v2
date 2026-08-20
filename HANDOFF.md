# HANDOFF

**Written:** 2026-08-20, mid-session. **Still inside a `rabbit-hole` descent
on #646** — Dennis gave explicit go-ahead to divide-and-conquer at will on
Wave 3's remaining scope and is AFK for the whole sitting (asked not to be
prompted mid-workflow, questions saved for his return). This session is
**continuing autonomously past this rotation**, not paused waiting on
input — if you are reading this because the session got cut instead, resume
by picking up the next queued item below, same as any other rabbit-hole
resume.

## Rabbit-hole state

**Tracker: #646 itself** (the pre-existing Wave 3 tracking issue was reused
as the rabbit-hole tracker per its own text — no separate tracker issue was
filed; see the framing comment on #646).

- **RF025 (Ensaios, reagentes e não conformidades) — done.** Merged
  `1d8221b9`. New `ReagentLot`/`Nonconformance` entities, `Assay` extended
  with reagentLotIds/equipmentIds/structured controls. Unit 79/79 new,
  full native suite 380/380 files (7237/7237 tests). E2E 3/3 new in
  `specimen-quality-inventory.spec.ts`, full file 37/37 — live against
  Docker. Full writeup: #646's own progress comment (search "RF025 ...
  landed"). Three follow-ups filed and added to #646: **#664** (Assay's
  linkage fields are format-only, no FK-resolution check), **#665**
  (Técnico, RF025's own primary actor, can't actually create an Assay/
  ReagentLot — still gated `requireRole(3,4)`), **#666** (dict-02's
  `Device` entity is richer than the code's `Equipment` model).
- **RF026 (Retenção e destinação) — next up, not started yet this
  rotation.** Investigation already done (this same sitting): `RetentionPolicy`
  (RF014) is solid and reusable as-is; everything on the disposition/
  execution side (`DispositionAction`, `legalHold`, the record-to-policy
  link) is 100% greenfield. dict-02 gives a firm 5-field `DispositionAction`
  contract (ELM-0411..0415: `legalHold`, `dispositionAction`,
  `dispositionMethod`, `dispositionDateTime`, `dispositionCertificateUri`)
  but leaves "responsável"/"itens afetados" (AC#4) undefined — planned as
  local extensions (`performedBy`, `affectedRecordIds`), same precedent
  RF025 just used for Nonconformance's `capaId` gap. Planned shape (not yet
  built): new `LegalHold` entity mirroring `QuarantineAction`'s structure
  (targetEntityType/targetEntityIds/reason/imposedBy/status), a
  `dispositionAction.service.js` that blocks `destroy`-type dispositions
  while an active hold exists on the target, `requireRole(3,4)` gating
  (Coordenador is RF026's own primary actor). Certificate/evidence (AC#5)
  planned as a self-referential URI to the DispositionAction resource
  itself (no real object-storage/PDF generation exists to build against
  honestly) unless the caller supplies their own.
- **RF029 (Ingestão operacional e científica) — not started, expected to
  need its own `divide-and-conquer` split, not a single build-loop slice.**
  Full recon already done this sitting (parallel Explore agent): RF022 and
  RF028 (its stated dependency) are confirmed **genuinely complete** in
  code — `E2E_TRACEABILITY_PLAN.md`'s RED/MISSING status for both is stale
  (git-blamed to 2026-07-27, before #366/#370/#381/#549/#551/#552/#557/#374
  all landed and closed). RF029 itself needs a new ingestion gateway (no
  generic one exists — `/api/import/*` is file-upload-centric prior art,
  not a drop-in), extending the narrow existing canonical-contract
  validator (`api/backend/src/contracts/canonical/v1/`, only 4 schemas,
  wired into exactly one route), a new provenance/actor/purpose envelope
  (genuinely new), and per-entity code-validation against active reference
  releases. Recon's suggested split (foundation/gateway shape decision
  first, then participants-consents-specimens-clinical /
  telemetry / files / datasets-assays / workflows-omics as independent
  slices) — plan is to file this as issues under #646 via
  `divide-and-conquer`'s "design change too large" playbook, not build it
  inline, given the size. **Not yet filed as of this rotation** — if
  resuming here, that filing is the next concrete action for RF029.
- **Queued, low-priority:** `E2E_TRACEABILITY_PLAN.md`'s RF022/RF028/RF029
  status-table cells are stale (see above) — flagged in the framing comment
  on #646, planned to be fixed alongside the RF029 split work since it's
  the same investigation, not yet done.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed through RF025's merge
  (`1d8221b9`). Working tree otherwise clean except the gitignored/junctioned
  `.claude/skills/` and the pre-existing untracked `api/backend/storage/assays/`
  (neither this session's doing, carried from the prior rotation).
- No PR to `main` exists.
- **Docker:** the test stack (`compose.test.yml`) is currently **up**
  (`mongodb-test`/`neo4j-test`/`redis-test`/`mqtt-test`/`influxdb-test`/
  `smtp-test`/`tsa-test`/`witness-test`/`backend-app-test`/`worker-test`/
  `frontend-app-test`/`neo4j-projection-worker-test`, plus
  `admin-bootstrap-test` already run — exited 0, that's success despite the
  compose `--wait` command itself reporting exit 1, per the documented
  gotcha). Brought up fresh this session (rebuilt `backend-app-test`/
  `frontend-app-test` to pick up RF025's new files). Left running
  intentionally — RF026 needs it again immediately next. Tear down at the
  actual end of this sitting, not mid-rabbit-hole.
- Two pre-existing dangling local branches, still untouched:
  `test/377-docs-on-main`, `test/human-showcase-video`. The RF025 slice
  branch (`test/646-rf025-assay-quality-nonconformance`) was **not** yet
  deleted locally as of this rotation (merged but branch still present) —
  clean up at end of session per the established pattern.

## Recommended next steps

Dennis hasn't picked a next task beyond "continue #646" — this is the
autonomous continuation of that instruction, not a new ask. Next concrete
actions, in order: build RF026 (branch, model/service/routes per the shape
above, unit + e2e proof against the already-running Docker stack, merge,
progress-comment #646, rotate this file again), then run RF029's
divide-and-conquer split (design the breakdown, file sub-issues under #646,
fix the traceability-plan staleness in the same pass), then wrap up the
whole sitting (tear down Docker, clean up branches, final handoff rotation
marking the rabbit-hole either exited or explicitly still open with known
remaining members) and surface any accumulated design-call questions to
Dennis at that point — not before.
