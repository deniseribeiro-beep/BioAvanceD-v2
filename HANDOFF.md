# HANDOFF

**Written:** 2026-07-29, a docs-audit session (no issue picked via
`work-issue` this time — Dennis asked to sweep the open "needs a design
call" backlog against current docs first).

**Branch:** `test/e2e-real-backend-foundation`, unchanged this session
(still at 4212f7c2, clean, matches previous handoff).

## What happened this session

1. Read the prior handoff (#316/#317 closed, real-backend e2e Docker
   verification fully unblocked; recommended sweeping other specs for
   the same env-var gap class, and re-checking the open design-call
   backlog: #313, #314, #295, #297, #307, #293, #115).
2. Pulled all seven issues via `gh issue view` and cross-checked each
   against current code and the newer `docs/docs-7-27-2026/extracted/`
   doc set (dictionary v1.3.0 + requirements v3.0.0 — the higher-
   authority source per the project's own conventions overlay).
3. Findings:
   - **#295** (Study/Protocol/Collection linkage) — largely answered.
     `dict-02_DICIONARIO.md` now defines `Study` (ELM-0053–0067),
     `Protocol` (ELM-0068–0075), `Collection` (ELM-0039–0052) as full
     entities, with `Specimen.collectionId`/`Specimen.studyIds` typed
     as `Reference` to them (ELM-0118/0119). Docs say: real modeled
     entities, not free-text fields.
   - **#297** (RF006 AC#6 atomicity) — largely answered. The
     requirement text itself (`requisitos-index.md`, RF006 AC#6) says
     "Atualizar a quantidade disponível por **transação controlada**"
     — a plain transaction requirement, not an open judgment call.
   - **#313** (silent metadata-link failure), **#314** (maintenanceStatus
     enum mismatch), **#307** (run-cycle route auth) — checked docs and
     code, found nothing that answers these. Still genuine, unpicked
     design calls for Dennis.
   - **#115** — not a live design call; Denise already left an explicit
     decision on the issue thread (defer union/dedupe to the canonical
     terminology-modeling phase, Option A already implemented). Staying
     open per her own instruction, nothing to re-ask.
   - **#293** (TOTP helper) — an implementation gap, not a design call;
     no doc cross-check applicable.
4. Did **not** yet post the #295/#297 findings as issue comments —
   paused there when Dennis redirected to a bigger-picture gap: the
   skills pack's docs-check discipline (already solid inside
   `fix-bugs`'s "verifying before deferring" checklist and the
   `bioavanced-v2` conventions overlay) doesn't carry into
   `resolve-issue`/`work-issue`, so design-call issues filed by
   `build-loop`/`test-loop` sessions never get re-traced against docs
   later. Filed that gap as
   [dyeallpies-skills-pack#141](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/141),
   citing #295/#297 as the concrete evidence.
5. No code changes this session; no Docker used.

## Repo state

- Working tree clean, `test/e2e-real-backend-foundation` unchanged at
  4212f7c2, still pushed and up to date.
- `test/migrate-rcs-governance-indexes-coverage` (untouched, #285
  coverage work) and the possibly-undeleted remote
  `origin/fix/mongo-audit-repo-generate-movement-id` both carried
  forward untouched, same as last handoff.
- **#316, #317 closed** (from the prior session) — real-backend e2e
  Docker verification for Mongo-seeding specs remains unblocked.
- **#295, #297 still open** but now have doc citations ready to post
  as comments (not yet posted) recommending they be de-scoped from
  "needs Denise's call" and picked up directly via `build-loop`/
  `resolve-issue` instead.
- **#313, #314, #307** still open, confirmed still genuinely
  undocumented — still need Dennis's call.
- **#115** still open, not actionable — Denise's decision is already
  on record; revisit only at the canonical terminology-modeling phase.
- **#293** still open, an implementation gap not a design call.
- `dyeallpies-skills-pack#141` filed this session, open, unassigned.

## Recommended next steps

1. Decide whether to post the #295/#297 doc-evidence comments (drafted
   in this session's conversation, not yet written to the issues) and
   re-scope them out of the "needs owner call" bucket into
   `build-loop`/`test-loop` pickups.
2. Pick up `dyeallpies-skills-pack#141` at some point — generalizing
   the docs-check step out of `fix-bugs` into `resolve-issue`/
   `work-issue` is itself a small, well-scoped skill-maintenance task.
3. Still queued from last handoff, untouched: sweep other e2e specs for
   the same env-var-gap class #317 fixed; check
   `E2E_TRACEABILITY_PLAN.md` fresh for the next Wave 2 RF pickup;
   #313/#314/#307 still need Dennis's actual call (not resolvable from
   docs); #301, #302, #304 untouched.

## Which skills to use

`skill-maintenance` for #141 in the pack repo. `resolve-issue` for
#295/#297 once/if de-scoped from "needs owner." `bioavanced-v2-legacy`
and the `bioavanced-v2` conventions overlay (docs-primacy section) are
exactly what drove this session's cross-checks — keep leaning on them
before labeling anything a design call. `test-loop` for whichever Wave
2 RF comes next per `E2E_TRACEABILITY_PLAN.md`.
