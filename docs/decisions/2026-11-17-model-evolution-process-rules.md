# 2026-11-17: RNF023 C2, RNF023 C5: an incompatible model change and its one-cycle update are held by the dictionary checks and review, not by Playwright

Requirements: RNF023 C2, RNF023 C5. Issue #1572.

## The question

Two criteria of RNF023 name how the model is changed, not what the running system does (`docs/extracted-v2.0.0/requisitos.md`, RNF023):

- RNF023 C2: "Alteração incompatível exige nova versão, migração, testes e rollback."
- RNF023 C5: "Atualizar dicionário, requisitos, modelo poliglota, pipeline, diagrams, código e testes no mesmo ciclo."

Neither has a real-backend Playwright case, and no record said what holds them. A browser sees one release at a time, so it cannot see how a change between releases was made. What in the repo holds each part, and which part does nothing hold?

## Decided

`[inference]`, from the specification and the repo's pattern, on 2026-11-17. The pattern: a criterion is held by the instrument that can reach it, and a part no instrument reaches is named rather than claimed (`2026-11-14-component-limits-tests.md`).

1. **The release and its version are pinned.** `[read it]` `api/backend/scripts/validate-dictionary-catalog.js` (`npm run dictionary:validate`, part of `current-state:ci`, which `backend-unit-runner` runs in CI's "Current-state validation" job) fails when `catalog.2.0.0.json` is stale against `docs/extracted-v2.0.0/dict-DICIONARIO.md`, when the v2.0.0 catalog is not complete (1644 elements, the 929 historical ids present), or when `release-manifest.2.0.0.json` is stale against `docs/RELEASE_MANIFEST.json`. `api/backend/tests/unit/governance/registry.test.js` ("refuses a manifest that no longer matches the checksum, a non-SemVer version and an unapproved active release") holds that the active release matches its manifest's checksum and is an approved SemVer version, and `api/backend/tests/unit/scripts/seed-essential-reference-data.test.js` ("registers the CanonicalModelRelease and its invariant catalog once, and a re-run writes neither again (#1304, F1.2)", "blocks readiness when the registered release carries a different checksum, and leaves it untouched (#1304)") holds that a changed release never rewrites a registered one. This holds C2's "nova versão" and, for C5, that the dictionary, the release manifest and the code's catalog change together.
2. **Code follows the dictionary.** `api/backend/tests/architecture/canonical-catalog-conformance.arch.test.js` ("#967: canonical catalog fields match the runtime shape ENTITY_TARGETS produce, modulo KNOWN_DRIFT") fails when a model's runtime shape and its catalog row part without a recorded drift, so a dictionary change that leaves the code behind, or the reverse, fails CI. This holds C5's "código" for the entities it lists.
3. **A migration is a script with its own test, and the retired shape stays retired.** A data change is a script under `api/backend/src/scripts/` (`migrateSpecimenStatusV2.js`, tested by `api/backend/tests/unit/migrateSpecimenStatusV2.test.js`, is one). Once migrated, an architecture test keeps the old shape from being read or written again: `api/backend/tests/architecture/legacy-facility-room-reads.arch.test.js` ("only the migration names the facilities and rooms collections (ELM-0168/0169)") and `api/backend/tests/architecture/legacy-storage-assignment-writes.arch.test.js` ("no backend code writes storageAssignments (RULE-026)"). This holds C2's "migração" and "testes" where they exist.

## Not decided here

- **That a change is incompatible, and that it carries all four parts.** Nothing classifies a change as incompatible, so nothing requires one to arrive with a new version, a migration, tests and a rollback together. That is a review-time process rule; no CI test can reach it.
- **Rollback of a data migration.** `[read it]` None of the migration scripts under `api/backend/src/scripts/` declares a rollback, so C2's "rollback" is not held for data migrations.
- **C5's requisitos, modelo poliglota, pipeline and diagrams.** The release manifest pins each approved document by checksum, so a changed artifact is seen, but nothing checks that a model change updated the requirements, the polyglot persistence model, the pipeline or the diagrams in the same cycle. That too is a review-time rule.
- **C5's tests.** That a model change updates its tests in the same cycle is held only where a conformance test compares the code with the catalog (item 2); elsewhere it is review.
