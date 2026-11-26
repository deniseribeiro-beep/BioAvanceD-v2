# 2026-11-25: Official MarkerDB import does not violate BiomarkerAssociation no-seed

Dictionary ELM-0275..0285. Follows `2026-10-23-biomarker-association-store.md` (#1206).

## The question

ADR #1206 forbids seeding `biomarkerAssociations` with fictitious operational data and leaves entry to an administrator. The dictionary names `SRC_MARKERDB`, `SRC_CPATH`, `SRC_FDA_PGX` as normative origins. May the RF028 pipeline import official dumps into that collection?

## Decided

`[decision]`, by the coordinator for the passo-3 / MarkerDB wave, on 2026-11-25:

1. **#1206 still forbids fictitious seed** of patient/operational rows and inventing associations without governed evidence (DOI/PMID).
2. **Official reference import is allowed.** Versioned MarkerDB (and redistributable C-Path / FDA PGx) dumps, converted offline to JSONL and imported via `reference:import:biomarker-associations`, are reference catalog data — the same class as HPO/ORPHA/HGNC RF028 imports — not “seed” in the #1206 sense.
3. **Admin “Nova Associação”** remains the path for institutional exceptions not present in the official dump.
4. **Mongo remains canonical**; Neo4j `POSSUI_BIOMARCADOR` is a derived projection via transactional outbox after import/upsert.

## Addendum 2026-11-26 (PHR-001 / PHR-002)

5. **MarkerDB full catalog** comes from https://markerdb.ca/downloads (release 2024-09-12): **all nine** datasets, each as **XML (authority)** and **TSV (fallback)**.
6. Rows without governed `associatedCondition` (ORPHA|ICD-11|MONDO) or `evidenceReferences` (DOI|PMID) are **rejected** to import issues — never invented.
7. If XML/TSV fields cannot map to ELM-0275..0285, **update the canonical model first**; block full import until the schema fits (C3=A).
8. **Redistribution rule (permanent):** official dumps that are legally redistributable for non-commercial research are versioned offline and fed through RF028. BioAvanceD use of MarkerDB in this project is **non-commercial**; cite Wishart et al. 2021 (PMID 33245771). Commercial redistribution requires MarkerDB authors’ written permission.
9. **Large binaries stay off GitHub.** Staging under `docs/data/` (local/GCP). Consolidated terminology pack (SIGTAP+ATC+HPO+MarkerDB+…) is prepared as a Zenodo-ready ZIP; the operator creates the Zenodo record and DOI manually. License of the pack: **CC BY-NC 4.0** (aligned with MarkerDB NC terms) plus per-source attributions.
10. **SRC_CPATH / SRC_FDA_PGX** follow the same redistribution + RF028 rule; converters/compose hooks ship in this release; dumps join the Zenodo pack when available.

## Consequences

- Compose/homolog production bring-up must run the biomarker-associations import after HGNC/LOINC.
- MANUAL_VERIFY `SKIP-SEED-BIO` / `SKIP-001` are retired once the catalog is populated from the official dump.
- Outbox event shape: see `2026-11-26-biomarker-association-neo4j-outbox.md`.
