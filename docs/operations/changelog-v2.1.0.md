# Changelog — BioAvanceD v2.1.0

## Summary

Release comercial **2.1.0**: tenant invite, Runbook + Termos/Privacidade, busca única de inventário + drawer, etiquetas Code128/DataMatrix, crosswalk MarkerDB→ORPHA/MONDO (híbrido), SIGTAP typeahead, hygiene sem mocks de runtime no aceite, ADRs G3/G10/G11.

## Added

- Tenant invite/activate (`tenantInvite.service`, `/invite/accept`)
- Product legal acceptance gate (`/legal/terms`, `/legal/privacy`, `/runbook`)
- Inventory lookup drawer (P5.5) + single search (G5)
- MarkerDB condition crosswalk offline + HITL unmatched queue
- SIGTAP procedure typeahead on clinical intake
- Ops: `SOT_2.1.md`, mock hygiene, support/SLA, SIGTAP import runbook

## Changed

- `/admin/dicionario` → redirect Runbook
- `/import` → FHIR import
- IAP documented as ops-only (not product auth)
- `GOVBR_OIDC_MOCK` only active in test/CI

## Deferred / N/A

- SRC_CPATH / SRC_FDA_PGX import — ADR N/A 2.1
- TLS #1465 — ADR defer post-2.1
- Zenodo DOI — not a go-live gate

## Upgrade notes

1. Align env with `runtime-mock-hygiene-v2.1.md` (mock off on acceptance).
2. Re-run MarkerDB crosswalk + biomarker import for ORPHA graph edges.
3. Import SIGTAP full dump when staged (`sigtap-full-import-v2.1.md`).
4. Complete G4 human smokes before production promote.
