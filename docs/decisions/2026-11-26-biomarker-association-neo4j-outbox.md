# 2026-11-26: BiomarkerAssociation Neo4j outbox (RF023)

Follows RF023 transactional outbox and ADR `2026-11-25-biomarker-association-official-import.md` §4.

## The question

What event shape projects Mongo `biomarkerAssociations` into Neo4j `(:Doenca_ORPHA)-[:POSSUI_BIOMARCADOR]->(:Biomarcador)`?

## Decided

`[decision]`, coordinator, 2026-11-26 (PHR-003):

| Field | Value |
|-------|--------|
| `eventType` | `BIOMARKER_ASSOCIATION_UPSERTED` |
| `aggregateType` | `BiomarkerAssociation` |
| `aggregateId` | `biomarkerId` |
| `payload.orphaCode` | Normalized ORPHA code for the disease node |
| `payload.analyte` | `{ systemUri, code, display }` → `Biomarcador` |
| `payload.biomarkerRole` | Optional relation property |
| `payload.contextOfUse` | Optional relation property |
| Cardinality | **One outbox event per disease↔analyte pair** (expand multi-condition docs) |
| Cypher | `MERGE (d:Doenca_ORPHA)… MERGE (b:Biomarcador)… MERGE (d)-[:POSSUI_BIOMARCADOR]->(b)` |
| Rebuild | One-shot project-all from Mongo + continuous worker drain |
| Order | Wire outbox + projector **before** full MarkerDB import |

## Consequences

- `GraphProjectionService.appendBiomarkerAssociationEvent`
- `Neo4jCanonicalProjectionService.applyBiomarkerAssociationProjection`
- Producer in `importBiomarkerAssociations` after successful upsert
- `/dictionary/suggest` keeps Mongo merge when Neo4j biomarkers are empty
