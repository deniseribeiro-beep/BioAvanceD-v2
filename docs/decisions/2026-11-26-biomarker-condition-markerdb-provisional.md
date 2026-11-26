# 2026-11-26: MarkerDB free-text conditions (model bump)

## The question

MarkerDB Downloads (2024-09-12) name diseases in free text (`Diabetes Mellitus Type 2`, `Obesity`, …). Almost no ORPHA codes appear in the dumps. ELM-0277 / ENUM-0096..0098 only allow ORPHA|ICD-11|MONDO. C3=A requires updating the model before full import.

## Decided

1. Keep ORPHA|ICD-11|MONDO as **preferred governed** condition systems.
2. Add provisional system URI `https://markerdb.ca/condition` for MarkerDB source labels when no ORPHA/MONDO/ICD-11 can be parsed (`code` = stable slug of the label; `display` = original text).
3. Import **requires** at least one associatedCondition coding (governed or provisional) **and** at least one DOI|PMID evidence reference. Rows without evidence are rejected (no fictitious PMID).
4. A later wave may replace provisional codings with ORPHA/MONDO via terminology crosswalk; until then `/dictionary/suggest` only surfaces associations whose `associatedCondition` includes an ORPHA coding (existing Mongo finder already filters by orpha).

## Crosswalk (G1, 2026-11-26)

**Decisão:** híbrido — matching automático offline (texto ORPHA embutido → rótulo ORPHA exato → sinônimo ORPHA → rótulo/sinônimo MONDO → ponte MONDO→ORPHA por xref ou rótulo alinhado). Sem inventar código (#1206). Entradas provisórias `https://markerdb.ca/condition` e evidência permanecem; codings governados são **acrescentados** em `associatedCondition`.

**Fila HITL:** linhas ainda sem match vão para `docs/data/markerdb/crosswalk-unmatched-<YYYY-MM-DD>.jsonl` (versão de fila `1.0.0`).

**Script:** `api/backend/src/reference-data/reference-imports/lab/crosswalkMarkerDbConditions.js` (wrapper CLI `api/backend/scripts/reference-imports/crosswalk-markerdb-conditions.js`). Terminologia offline via JSONL ORPHA/MONDO (`--orpha-jsonl`, `--mondo-jsonl`) ou `--mongo` em `terminologyConcepts`. Reimport com `import-biomarker-associations.js` re-emite outbox ORPHA via `orphaCodesOf`.

## Consequences

- `BiomarkerAssociationModel.CONDITION_SYSTEMS` includes the provisional URI.
- FONTES / dicionário: document ENUM provisional for MarkerDB staging.
- Full import unblocked after this bump.
