# HANDOFF

**Written:** 2026-07-30, a planning-only session (no code/branch changes)
following the prior `ship-integration-branch` session that fast-forwarded
`feature/docker-e2e-backend-integration` to `a0c87eaf`.

## What happened this session

1. Read the prior HANDOFF.md (see git history / `069f82c9d`-style lookup
   for older detail if needed).
2. User asked for "the first next issue of Wave 2." Checked
   `E2E_TRACEABILITY_PLAN.md` Wave 2 issues via `gh issue list` — the
   lowest-numbered open Wave 2 issue is **#322**:
   `e2e: RF003 Gestao de usuarios - real-backend spec (Wave 2)`.
3. No branch created, no code touched, no `build-loop` iteration actually
   run this session — this is a handoff note only, queuing the work for
   next time.

## Repo state

- Unchanged from the prior handoff: `test/e2e-real-backend-foundation`
  and `feature/docker-e2e-backend-integration` both at `a0c87eaf`, pushed.
- `main` still not touched.

## Recommended next steps

Next session: work **issue #322** using the `build-loop` skill, with
**Docker on** for the iteration (per the issue's own gate: run at least
once against the real backend via `test:e2e:docker`).

Issue #322 detail (RF003 - Gestao de usuarios):
- **Spec file:** `auth-access-security.spec.ts` (existing file, add cases)
- **Priority (doc):** Critica (P-033)
- **Status today:** MISSING
- **Gate:** happy path + at least one rejection/edge case from RF003's
  Criterios de aceitacao, run at least once against the real backend
  (`test:e2e:docker`), assert the AuditEvent side effect where called for.
- **Cross-cutting:** use the shared RF012 `assertAuditEvent` helper once
  built; check RNF008 (RBAC - 403 on cross-role) alongside, since it's
  bucket-A for this same journey.
- If scope turns out too big for one iteration (e.g. user CRUD + role
  assignment + RBAC all needing real coverage), use `divide-and-conquer`
  to split rather than letting the diff grow unreviewable.

Other open Wave 2 issues queued behind #322 (not yet started): #323
(RF007), #324 (RF011), #325 (RF020), #326 (RF021). Tracking issue #331
covers integrating all Wave 2 specs onto
`feature/docker-e2e-backend-integration` once they land.

## Which skills to use

`build-loop` for #322 itself. `divide-and-conquer` if the RF003 scope
splits. `ship-integration-branch` only once Wave 2 is fully landed and
Dennis explicitly asks to graduate to `main` (see prior handoff's
caution — do not assume `main` is the target without confirming).
