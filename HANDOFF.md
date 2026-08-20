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

**Tracker: #646 itself** (reused, not a separate rabbit-hole tracker issue).

- **RF025 (Ensaios, reagentes e não conformidades) — done.** Merged
  `1d8221b9`. Full writeup: #646's "RF025 ... landed" comment. Three
  follow-ups filed: **#664**, **#665**, **#666**.
- **RF026 (Retenção e destinação) — done.** Merged `365808f4`. New
  `LegalHold`/`DispositionAction` entities; `RetentionPolicy` (RF014)
  reused as-is. Full writeup: #646's "RF026 ... landed" comment. One
  follow-up filed: **#667** (RetentionPolicy's `ALLOWED_ENTITY_TYPES` —
  `AuditEvent`/`Log` only — limits what the new entities can practically
  govern today). Verification: unit 49/49 new, e2e 4/4 new + full file
  41/41 (live against Docker) — **both green, confirmed**. The full
  *native* suite re-run was still in progress when this slice merged
  (running ~4x slower than the RF025 baseline, likely Docker CPU
  contention from the stack sitting up this whole session) — check
  whether it finished; if resuming here and it hasn't been confirmed
  green yet, that's the one loose end from this slice (log at
  `<scratchpad>/rf026-full-native-suite.log`, or just re-run
  `npx vitest run` from `api/backend/`).
- **RF029 (Ingestão operacional e científica) — not started.** Full recon
  already done (this sitting, an earlier rotation): RF022/RF028 (its
  stated dependency) are confirmed genuinely complete — see the
  framing comment on #646 for the full evidence trail. RF029 itself needs
  a new ingestion gateway (no generic one exists), extends the narrow
  existing canonical-contract validator
  (`api/backend/src/contracts/canonical/v1/`), needs a new provenance/
  actor/purpose envelope, and per-entity code-validation against active
  reference releases. **Next concrete action: run `divide-and-conquer`'s
  "design change too large" playbook** — design the breakdown (recon's
  suggested split: foundation/gateway shape decision first, then
  participants-consents-specimens-clinical / telemetry / files /
  datasets-assays / workflows-omics as independent slices), file as
  issues under #646 (each with `Depends on:` the foundation slice), leave
  #646 open. **Not yet filed as of this rotation.**
- **Queued, low-priority:** `E2E_TRACEABILITY_PLAN.md`'s RF022/RF028/
  RF029 status-table cells are stale (git-blamed to 2026-07-27, before
  substantial completion work landed) — flagged in the framing comment on
  #646, planned to be fixed alongside the RF029 split work since it's the
  same investigation. Not yet done.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed through RF026's
  merge (`365808f4`). Working tree otherwise clean except the
  gitignored/junctioned `.claude/skills/` and the pre-existing untracked
  `api/backend/storage/assays/` (neither this session's doing).
- No PR to `main` exists.
- **Docker:** the test stack (`compose.test.yml`) is still **up** from
  earlier this session (rebuilt twice — once for RF025's new files, once
  for RF026's). Left running intentionally through both slices; tear down
  at the actual end of this sitting (after RF029's split work, which
  doesn't need it), not before.
- Two pre-existing dangling local branches, still untouched:
  `test/377-docs-on-main`, `test/human-showcase-video`. Both RF025's and
  RF026's slice branches were **not** yet deleted locally as of this
  rotation (merged but branches still present) — clean up at end of
  session.

## Recommended next steps

Dennis hasn't picked a next task beyond "continue #646" — this is the
autonomous continuation of that instruction, not a new ask. In order:
confirm the RF026 native-suite result (above), run RF029's
divide-and-conquer split (design + file sub-issues + fix the
traceability-plan staleness), then wrap up the whole sitting (tear down
Docker, delete the two merged slice branches, final handoff rotation
marking the rabbit-hole either exited or explicitly still open with known
remaining members — RF029's actual sub-slices would remain unbuilt even
after the split is filed, so "exited" is unlikely this sitting) and
surface accumulated design-call questions to Dennis at that point.
