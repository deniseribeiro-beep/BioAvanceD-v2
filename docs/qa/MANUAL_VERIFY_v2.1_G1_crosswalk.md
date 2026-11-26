# MANUAL_VERIFY v2.1 — G1 MarkerDB crosswalk + reimport

**Goal:** Provisional MarkerDB conditions enriched with ORPHA/MONDO; suggest real; outbox projected.

| Step | Result | Evidence |
|------|--------|----------|
| Before ORPHA-coded associations | **16** (fixture) | `bioavanced_test` prior to reimport |
| Convert | TSV preferred over XML | `docs/data/markerdb/2024-09-12/` → 42001 rows |
| Crosswalk | **59.78%** mapped (25108/42001) | unmatched `docs/data/markerdb/crosswalk-unmatched-2026-11-26.jsonl` (16893) — HITL, no invented codes |
| Reimport | `recordsUpdated=42001`, `outboxEnqueued=13206` | `import-biomarker-associations.js --in enriched.jsonl` |
| After ORPHA-coded | **13222** | mongosh count |
| Outbox drain | PENDING **0** | `graph_projection_outbox` |
| Neo4j | `POSSUI_BIOMARCADOR` **13173** | cypher-shell |
| Suggest Fabry | `orphaCode=324` → **135** biomarkers | tip `:8080` auth |

Date: 2026-11-26. Stack: compose.test + access-proxy.
