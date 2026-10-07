# BioAvanceD_Matriz_Rastreabilidade_Modelo_v2.0.0.xlsx :: TESTES_E_VALIDACOES

| Validation ID | Validation | Result | Observed | Expected | Evidence | Notes |
|---|---|---|---|---|---|---|
| VAL-001 | All 929 historical elements accounted for | PASS | 929 | 929 | Automated structural validation and workbook rules |  |
| VAL-002 | No historical identifier reused for a new element | PASS | pass | pass | Automated structural validation and workbook rules |  |
| VAL-003 | All new identifiers unique | PASS | pass | pass | Automated structural validation and workbook rules |  |
| VAL-004 | Checklist actions covered | PASS | 97 | 97 | Automated structural validation and workbook rules |  |
| VAL-005 | P0 actions treated | PASS | 73 | 73 | Automated structural validation and workbook rules |  |
| VAL-006 | Physical identification actions treated | PASS | 10 | 10 | Automated structural validation and workbook rules |  |
| VAL-007 | All relationships have cardinality | PASS | pass | pass | Automated structural validation and workbook rules |  |
| VAL-008 | Operational specimen status excludes DISPOSED/DESTROYED/PARTIAL/DEPLETED | PASS | pass | pass | Automated structural validation and workbook rules |  |
| VAL-009 | SPREC 2.0 is current RCS baseline and 4.0 roadmap only | PASS | pass | pass | Automated structural validation and workbook rules |  |
| VAL-010 | FHIR is boundary, not parallel persistence | PASS | pass | pass | Automated structural validation and workbook rules |  |
| VAL-011 | Neo4j is controlled outbox projection | PASS | pass | pass | Automated structural validation and workbook rules |  |
| VAL-012 | No PII authorized for labels or Neo4j | PASS | pass | pass | Automated structural validation and workbook rules |  |
| VAL-013 | Future AI structures are inactive and conditional | PASS | pass | pass | Automated structural validation and workbook rules |  |
| VAL-014 | RCS input preserves explicit matrix, five axes, SPREC codes, severities, weights and immutable snapshot | PASS | pass | pass | Automated structural validation and workbook rules |  |
| VAL-015 | RCS governance gate preserves all six individual evidence results | PASS | pass | pass | Automated structural validation and workbook rules |  |
| VAL-016 | RCS result preserves P_bio, score-based grade, final grade and classification route | PASS | pass | pass | Automated structural validation and workbook rules |  |
| VAL-017 | Every TelemetryReading element is authoritative in InfluxDB | PASS | pass | pass | Automated structural validation and workbook rules |  |
| VAL-018 | TelemetryReading has unique idempotent identity and storage location correlation | PASS | pass | pass | Automated structural validation and workbook rules |  |
| VAL-019 | TelemetryExposureSummary is reproducible from normalized assignment path, coverage and hashes | PASS | pass | pass | Automated structural validation and workbook rules |  |
| VAL-020 | Legacy StorageAssignment is deprecated and the normalized physical chain is complete | PASS | pass | pass | Automated structural validation and workbook rules |  |
| VAL-021 | Temporal graph projection has version, checkpoint, idempotency and rebuild rules | PASS | pass | pass | Automated structural validation and workbook rules |  |
| VAL-022 | Raw telemetry and PII are prohibited in Neo4j | PASS | pass | pass | Automated structural validation and workbook rules |  |
| VAL-023 | Withdrawn experimental extension is absent and its former identifier range is not reused | PASS | pass | pass | Automated structural validation and workbook rules |  |
| VAL-024 | Empty container is distinct from specimen and can occupy a storage position | PASS | pass | pass | Automated structural validation and workbook rules |  |
| VAL-025 | FHIR mapping release preserves profiles, namespaces, conformance, coverage, losses and approval | PASS | pass | pass | Automated structural validation and workbook rules |  |
| VAL-026 | Internal identifier namespaces use the approved bioadvanced.dev authority | PASS | pass | pass | Automated structural validation and workbook rules |  |
| VAL-027 | Ex ante physical identification protocol prohibits real specimens | PASS | pass | pass | Automated structural validation and workbook rules |  |
| VAL-028 | No active physical or telemetry relationship depends on StorageAssignment | PASS | pass | pass | Automated structural validation and workbook rules |  |
