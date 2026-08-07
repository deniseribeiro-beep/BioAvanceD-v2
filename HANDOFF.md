# HANDOFF

**Written:** 2026-08-07, end of session on `feature/docker-e2e-backend-integration`,
after splitting #390.

## What happened this session

Dennis said "pick #390". Routed via `work-issue`: #390 (migrate
remaining `Sample.js` consumers off embedded RCS/SPREC/storage/custody
fields once the new entities exist) is a large migration whose own body
says it needs its own `divide-and-conquer` pass per consumer group,
mirroring #368's approach. Classified as route 9 (too big for one
sitting) and routed straight to `divide-and-conquer`.

Re-audited the consumer list first (per #390's own instruction, since
#389's scoping had found the original field list understated reality) —
delegated the grep/doc-read sweep to an Explore agent, then verified its
findings. Corrections vs. the original issue body:
- `neo4jCanonicalProjection.service.js` dropped — already reference-based
  (only touches `qualityAssessmentId`, no embedded RCS/SPREC reads).
- `frontend/src/config/constants/specimen.constants.d.ts` itself has no
  RCS/SPREC content; real frontend consumers are the views.
- Several files not in the original list surfaced (`rcs-certification.service.js`,
  `quality-compatibility.service.js`, various routes/services named in
  `docs/architecture/canonical-data-contract-v1.md`'s "Known Residual
  Legacy Surfaces" section).

Proposed a 6-issue split to Dennis via `AskUserQuestion`; he confirmed
"file all 6 as proposed." Filed:

- **#491** — backend RCS consumers (MerkleService, quality-compatibility,
  import-lgpd wiring, rcs-certification, import.service JSON-branch RCS
  gap)
- **#492** — design decision: should live `POST /api/samples`
  registration compute RCS server-side, or accept a pre-computed
  assessment from the client? (needs owner call before implementation)
- **#493** — backend SPREC consumers (MerkleService, import.service
  JSON-branch SPREC gap, sampleMerkleIntegrity)
- **#494** — storage/custody consumers (storageService, sample.service,
  Allocate/Move/Release use-cases, MongoStorageRepository*, intakeWizard,
  NotificationService, sensor services)
- **#495** — frontend consumers. **Depends on #491, #493, #494 landing
  first** — the frontend needs the API responses to actually shape
  RCS/SPREC/storage data via the new entities before it can stop reading
  the old embedded shape.
- **#496** — remaining misc backend surfaces from
  `canonical-data-contract-v1.md`'s "Known Residual Legacy Surfaces"
  list not covered by #491-#495. Note in the issue: check per-file
  whether #491-#495's implementation already covers it before doing
  redundant work.

Commented on #390 with the breakdown and re-audit corrections; **left
#390 open** as the tracking issue (closes once all six sub-issues land,
same pattern as #389).

No branch created, no commits, no product code touched this session —
pure issue-tracker filing (`gh issue create` x6, `gh issue comment` x1).

## Repo state

- **`feature/docker-e2e-backend-integration`**: unchanged this session
  except for this HANDOFF.md rotation. Clean, pushed, up to date with
  origin.
- No dangling branches from this session.
- Issues this session: **#491, #492, #493, #494, #495, #496 filed**;
  **#390 commented, left open** as their tracking issue.

## Which issue is next

Dennis has not yet said which of #491-#496 to pick up next session; per
`handoff`'s "only if the user explicitly said so" rule, nothing is
queued. Recommended order if asked: **#491 (backend RCS) or #493
(backend SPREC) first** — both are foundational and independent of each
other; **#494 (storage/custody)** is also foundational and independent;
**#492 (registration design decision)** can happen in parallel since
it's a decision, not a refactor, but benefits from #491's pattern
existing first; **#495 (frontend)** explicitly depends on #491+#493+#494
landing; **#496 (misc surfaces)** should go last since some of its items
may turn out already covered by the other five.

Other backlog carried forward unchanged from prior handoffs (not
re-verified this session):
- **#489** — full-suite vitest flakiness (89/360 files fail on a bare
  `npx vitest run`, unrelated to any recent diff, broadened scope of
  closed #423).
- Older backlog: `#371`/`#373`/`#374`/`#378`/`#379`, `user.accessType`
  grep sweep, dangling merged branches (`test/440-*`, `test/441-*`,
  `fix/444-retention-period-iso8601`, `fix/450-*`,
  `fix/476-quarantine-status-design-call`,
  `fix/485-sample-details-storage-migration`,
  `test/486-storage-move-sample`, `test/488-inline-storage-movement-e2e`
  — all safe to delete, low priority housekeeping).
- **Next e2e slice** (per `E2E_TRACEABILITY_PLAN.md` and
  `playwright-specs`' spec inventory) — check issue #95's tracking
  thread once skills-pack#227 lands the new spec in the inventory.
- **#368** — the analogous Patient/ParticipantIdentity migration this
  session's split pattern mirrored — is itself still unsplit (still one
  large open issue, no per-consumer-group children filed yet). Not
  picked up this session; noting in case a future session wants to apply
  the same `divide-and-conquer` treatment to it.

## Dev stack state

Nothing started this session — pure `gh issue` create/comment work, no
native or Docker processes.

## Which skills to use

- `work-issue` -> `divide-and-conquer` (route 9, "too big for one
  sitting") was the correct route straight from #390's own body text
  rather than trying a narrower route first — the issue explicitly
  flagged its own size.
- `divide-and-conquer`'s "design change → split into a plan of issues"
  playbook worked as documented: re-audit → design breakdown → confirm
  with user via `AskUserQuestion` → file with `Originating issue:` lines
  → comment + leave tracking issue open. No deviation needed.
- Delegated the re-audit grep/doc sweep to an `Explore` agent (read-only,
  bounded to specific files/patterns) per `agent-delegation` — verified
  its claims against the actual code before using them in the issue
  bodies (e.g. confirmed `neo4jCanonicalProjection.service.js`'s
  drop-from-scope claim was correct rather than taking the agent's word).
- No friction this session (see `wrap-up`'s audit, run immediately
  before this rotation) — nothing to file against the pack or the repo.
