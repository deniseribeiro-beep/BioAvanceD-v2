# 2026-11-06: a data class is a retention family, and records its purpose, sensitivity, policy, period and owner

Requirement RNF022 AC1, RF026 AC1; dictionary ELM-0018, ELM-0408..0410. Issue #1462.

## The question

RNF022 AC1 reads "Cada classe possui finalidade, sensibilidade, política, prazo e responsável." Nothing in the backend recorded a class's purpose or owner: `RetentionPolicy` holds a policy and its period, and the catalog records a sensitivity per field. The canonical model v2.0.0 has no data-class entity, and RetentionPolicy's rows (ELM-0408..0410) carry no purpose, sensitivity or owner. What is a data class, and where does each of the five live?

## Decided

By the coordinator for #1462, on 2026-11-06:

1. **`src/governance/dataClasses.js` is the data-class registry.** `listDataClasses()` answers one record per retention family, with its `code`, `purpose`, `ownerRole`, `entityTypes` and `sensitivity`.
2. **`GET /api/retention-policies/data-classes`** (`authenticate`, `requireRole(4)`) answers each record joined to its family's active RetentionPolicy: `retentionPolicyId` and `retentionPeriod`, both `null` when none is active.

`[inference]` The canonical model has no data-class entity, so the classes are the retention families (`auditTrail`, `specimen`, `dataFile`). RF026 AC1 binds "classes de dado e espécimes" to a versioned policy, and the families are what the system binds (the decisions of #1365 and #1321). A new family is a new class.

`[inference]` The registry is code, not a collection, as `governance/invariants.js` is: it is versioned by its commit, and needs no seed on any stack.

`[inference]` A class's purpose is the title of the requirement governing its records: RF012 for the audit trail, RF006 for specimens, RF007 for data files.

`[inference]` A class's sensitivity is the highest catalog Sensitivity among its catalog elements, in the order `Low/metadata < Baixa < Moderada < Alta < Crítica < Restricted`, with any note after `;` dropped. The catalog mixes the v1.3.0 Portuguese scale with the v2 `Low/metadata` and `Restricted` values; placing those two at the ends is itself the inference. An entity type with no catalog rows (`Log`, `Sample`) adds nothing.

`[inference]` A class's owner is a role: the audit trail's is the Administrador (RF014's actor, whose routes set every retention policy), the specimen's and the data file's the Coordenador (RF026's primary actor).

`[inference]` Policy and period are read live from the family's active RetentionPolicy, `null` when none is active, as `2026-10-23-data-file-retention-policy.md` item 4 does for a file.

## Not decided here

- **A class per `dataClassification` level (ELM-0018).**
- **A per-record owner.**
- **A UI for the registry.**
- **Refusing a write when a class has no active policy.**
