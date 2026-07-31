# HANDOFF

**Written:** 2026-07-31, a `resolve-issue` session closing out **#361**
(dev-stack Mongo/Neo4j volume fixture accumulation) on
`feature/docker-e2e-backend-integration`, picked up from the same day's
#362 close-out session's standing candidate list.

## What happened this session

1. Read HANDOFF.md, routed **#361** via `work-issue` → `resolve-issue`
   (documentation/awareness item, not a bug/coverage/build item — the
   issue's own suggested directions left the fix choice, if any, to
   Dennis).
2. Confirmed #361 is a distinct problem from the already-fixed
   #320/#318/#360 Mongo/Neo4j credential-mismatch issues: this one is
   the dev stack's (`compose:up`) named volumes never being torn down
   with `--volumes`, so fixture data accumulates across sessions and
   causes intermittent failures in specs asserting "this is the
   only/first event of its kind" (`interop-monitoring.spec.ts`,
   `specimen-quality-inventory.spec.ts`). The credential fix cleared
   unrelated noise (24 → 13 failures) but didn't touch this class.
3. The actual fix — extending the `docker-workflow` overlay's existing
   `mongodb-test-data` gotcha to cover the dev stack too — lives in the
   `dyeallpies-skills-pack` repo (overlay files are an installed
   junction, only editable from a pack-repo session per skill-maintenance
   Rule 0). Filed **`dyeallpies-skills-pack#156`** with the exact
   verbatim text to add to `local-env/BioAvanceD-v2.md`.
4. Commented on #361 with the finding and link to #156, initially left
   open (case 5: "cannot be resolved from this repo"). Per Dennis's
   explicit instruction, closed #361 with a follow-up comment — the
   documentation fix is fully tracked in the pack repo, no product-code
   change was warranted.
5. `wrap-up` audit: no friction. No commits/branches/pushes this
   session — only a GitHub issue comment/close in this repo and one
   issue filed in the pack repo.

## Repo state

- `feature/docker-e2e-backend-integration`: unchanged this session,
  still at `bd486ac2`, working tree clean, pushed.
- **#361 closed** this session, referencing `dyeallpies-skills-pack#156`
  as the tracked follow-up.
- Standing inventory carried forward unchanged: `dyeallpies-skills-pack#154`
  (open, #360's doc fix) and `#155` (#362's finding, now unblocked)
  still pending in the pack repo, now joined by **`#156`** (this
  session's dev-stack volume-accumulation overlay text) — none of the
  three applied yet.
- Docker Desktop / dev stack: on this session per Dennis (carried from a
  prior session), not used for any build/run/compose this session (the
  work was doc/tracking only, no verification needed it).

## Recommended next steps

None queued explicitly by Dennis this session. Wave 2 work (#325, #326,
plus file-gap prerequisites #327–#330) remains the standing candidate
per `E2E_TRACEABILITY_PLAN.md`.

## Which skills to use

`work-issue` to route whichever open issue/track gets picked up next.
If Wave 2 work starts, expect `e2e-test-loop` for the individual specs
and eventually another `ship-integration-branch` pass for the Wave 2
tracking issue (#331). A pack-repo session should apply all three
pending pack issues (`#154`, `#155`, `#156`) to their respective
`docker-workflow`/`resolve-issue` overlay files — they're independent
edits and could be batched in one pack-repo session.
