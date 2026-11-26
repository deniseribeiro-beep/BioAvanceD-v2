# 2026-11-17: RNF028 C6: the legacy surfaces and their plan are kept in one inventory

Requirements: RNF028 C6. Issue #1574.

## The question

RNF028 C6 asks for an inventory and a plan for the legacy surfaces (`docs/extracted-v2.0.0/requisitos.md`). The only inventory, `docs/architecture/canonical-active-surface.md`, is dated 2026-07-08 and stale, and the retirement decisions and the architecture tests that guard them are scattered, listed nowhere together. What holds the list, and how does it stay current?

## Decided

`[inference]`, from the specification and the repo's pattern, for #1574, on 2026-11-17. The pattern: each retirement has its own dated decision and, where code could regrow it, an architecture test (the facility/room, StorageAssignment and `temperatures` guards).

1. **`docs/architecture/legacy-surface-inventory.md` is the inventory:** one row per surface, with its status, plan, guard and source.
2. **A surface found legacy is added to it in the change that finds it,** and a row's plan changes with the decision that changes it.
3. **`docs/architecture/canonical-active-surface.md` is superseded** and kept as history.

## Not decided here

The rows whose status is `open` or whose plan is `open` in the inventory:

- Result files and consent evidence written to local disk, outside the object store (`listed, not moved`): moving them onto the object store is not decided.
- `api/backend/src/models/Result.js`, `Sensor.js`, `Equipment.js`, `Temperature.js` and `Reports.js`: no replacement is decided.
- `api/backend/scripts/migrate-patients-to-modular.js`: its fate is not decided.
- `api/backend/src/controllers/import-async.controller.js`, `import-batch.controller.js` and `fhir-import-staging.controller.js`: the July inventory marked them for deletion after import verification; they are still required by the import routes, and no deletion is decided.
- The July inventory's class F catch-all, scripts under `api/backend/scripts` that only support retired contracts: none is identified beyond `migrate-patients-to-modular.js`.
- `api/backend/src/services/quality-compatibility.service.js`: the compatibility layer between legacy and canonical quality fields; no removal is decided.
- The rest of the July inventory's "Known Residual Legacy Surfaces" (the routes, services, views and use cases its row names): no plan is decided, and whether each still carries a legacy alias is not rechecked.
- `frontend/src/components/v2/intake/ClinicalIntakeWizard.jsx`: still the live intake wizard.
- `frontend/src/components/v2/DataDictionaryModal.jsx`: imported by nothing, so the July inventory's frontend catch-all marks it for deletion; no deletion is decided.

Not legacy, and so not decided here either: `api/backend/src/services/fhir-import-staging.service.js`, which the July inventory keeps as a narrow boundary helper (`listed, not moved` in the inventory).
