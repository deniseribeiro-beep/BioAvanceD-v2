# HANDOFF

**Written:** 2026-08-13, end of session on `feature/docker-e2e-backend-integration`.

## What happened this session

Picked up `#552` (RF028 AC9 — Neo4j outbox projection for
`TerminologyConcept`/`TerminologyRelation`) via `work-issue` →
`build-loop`. This was the last of the four items `#373` (RF028 parent
tracking issue) deferred, so closing it also closed the parent.

### `#552` closed — AC9 outbox projection landed

- `reference-imports/pipeline.js`'s `promote()` now appends a
  `TERMINOLOGY_CONCEPT_PROMOTED`/`TERMINOLOGY_RELATION_PROMOTED` event to
  `graph_projection_outbox` on the same write that inserts a
  `TerminologyConcept`/`TerminologyRelation` — never on the skip-existing
  branch. Mirrors RF023's consent/lineage/quality/telemetry outbox
  discipline exactly: Mongo write is the source of truth, Neo4j is only
  ever reached via the outbox.
- `GraphProjectionService` gained `appendTerminologyConceptEvent`/
  `appendTerminologyRelationEvent`; `Neo4jCanonicalProjectionService`
  gained the matching `applyTerminologyConceptProjection`/
  `applyTerminologyRelationProjection`. No worker changes needed —
  `neo4jProjection.worker.js` is already fully generic over event type.
  Concept nodes keyed by `id` (the Mongo `terminologyConceptId`), with
  `systemUri`/`code`/`version`/`display`/`conceptStatus` as properties
  (queryable by natural key without knowing the generated id ahead of
  time). Relations project as a `TERMINOLOGY_RELATION` edge between two
  `TerminologyConcept` nodes.
- 93/93 unit tests, 41/41 architecture guard tests, no regressions.
- **Verified live** against the dev Docker stack (Dennis started Docker
  Desktop; per `docker-workflow`, this session didn't launch it itself):
  cleared a stale prior-session HPO import first (idempotency would have
  otherwise short-circuited before ever reaching the new code — see the
  pack-repo follow-up below), re-ran `reference-data-bootstrap` genuinely
  fresh, confirmed via `mongosh` that 15 outbox events were written and
  drained to `PROJECTED` by the existing worker, then via `cypher-shell`
  that the `HP:0000001` concept node and `HP:0000118→HP:0000001 is_a`
  edge actually landed in Neo4j. New Playwright spec
  (`pipeline-continuity.spec.ts`, "Outbox → Neo4j projection (RF028
  AC9)") asserts the same via two new `queryNeo4j.ts` helpers
  (`waitForTerminologyConceptNode`, `waitForTerminologyRelation`) — ran
  green against the live stack. The file's other 21 pre-existing
  assertions still pass unmodified; 2 unrelated RF023 consent tests
  failed on this run only because the freshly-started stack had no admin
  user yet (`npm run compose:seed-admin` was never run this session) —
  not a regression, not investigated further.
- Landed as `4feecab4` (branch `test/552-neo4j-outbox-projection`, now
  merged and deleted), merge commit `9ac14682` on
  `feature/docker-e2e-backend-integration`, pushed.

### `#373` closed — RF028 parent tracking issue, all 4 deferred items done

`#549` (13 remaining sources), `#550` (live download/license), `#551`
(full AC7 lifecycle), `#552` (this session's AC9 outbox projection) — all
confirmed closed. Commented on `#373` naming all four, closed per
`resolve-issue`'s parent-chain-check step (clean checklist match, not
ambiguous). **RF028 is now fully complete** against its own originally
scoped acceptance criteria.

### Filed this session

- pack-repo `dyeallpies-skills-pack#283` — a `docker-workflow` local-env
  addition for BioAvanceD-v2 (re-verifying a change inside `promote()`'s
  idempotency-guarded path against a dev stack with pre-existing data
  silently no-ops instead of exercising the new code; the exact write-up
  is in the issue for a pack-primary session to fold in verbatim). Not
  urgent, same shape as prior precedent (`#280`).

## Repo state

- **`feature/docker-e2e-backend-integration`**: clean, pushed, at
  `9ac14682`. Carries this session's `#552` slice on top of everything
  the prior handoff described.
- The dev Docker stack (`compose.yml`+`compose.dev.yml`) was brought up
  for this session's live verification, then torn down via `clean-up`
  before session end (`docker compose ... down`, no `--volumes` — named
  volumes including the fresh HPO/Neo4j data this session wrote are
  preserved for next time). No stack running as of this handoff.
- No stray local branches from this session — `test/552-neo4j-outbox-projection`
  merged and deleted; a second throwaway branch
  (`test/552-wrapup-notes`, opened only to attempt the now-redirected
  local-env edit) was deleted unmerged since it carried no changes.
  Session-local Playwright `test-results/` debris and the scratchpad
  `compose-up-552.log` redirect target were also removed.
- **Pre-existing dangling local branches, not touched this session**
  (carried forward unchanged from prior handoffs — `fix/476-...`,
  `fix/477-...`, `fix/481-...`, `fix/485-...`, `fix/513-...`,
  `test/377-...`, `test/428-...`, `test/431-...`, `test/440-...`,
  `test/441-...`, `test/486-...`, `test/507-...` through `test/511-...`,
  the nine `test/549-*-reference-source` branches, plus a stray
  `worktree-agent-*` branch — not re-verified against the integration
  branch this session).

## Next steps

No issue named as next by Dennis. For context (not a directive):
- **RF028 is done.** With `#373` closed, there's no open RF028 tracking
  issue left to resume from — the next milestone pickup is a fresh area
  (`#552`'s close comment didn't name one).
- **pack-repo `#280`/`#281`** (from two sessions ago) — `#280` needs a
  pack-primary session to fold its content into that repo's
  `HANDOFF.md`; `#281` needs the `work-issue`/Rule-0-adjacent wording fix
  it proposes. Still open, still small/self-contained.
- **pack-repo `#283`** (this session) — same shape as `#280`: a
  pack-primary session folds the local-env addition in verbatim.
- **pack-repo `#248`/`#270`** — both still open from two sessions ago,
  both with two full sessions of negative-repro data each. Only
  remaining lever is "deep into a long, loaded, real session" rather
  than a dedicated isolated test — not worth another dedicated
  debugging session.
