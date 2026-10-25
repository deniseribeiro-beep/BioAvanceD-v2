# Security risk register

Answers RNF013 C1 ("Ativos, riscos, responsáveis e tratamentos são documentados"). Written 2026-10-25; describes the code and `compose.prod.yml` at this commit. Tracking issue: #1325.

The system does not claim ISO/IEC 27001 certification (RNF013 C4: "não declara certificação ISO/IEC 27001 sem auditoria formal da organização"). This register is risk-oriented practice compatible with that standard's principles.

## Assets

| Asset | Where it lives (`compose.prod.yml`) |
|---|---|
| MongoDB (operational data, audit trail) | `mongodb_data` volume |
| Neo4j (graph projection) | `neo4j_data` volume |
| InfluxDB (time series, temperature) | `influxdb_data` volume |
| Redis (queues, sessions, cache) | `redis_data` volume |
| File stores (uploads, stored files) | `uploads_data` and `storage_data` volumes; an object store when `OBJECT_STORE_DRIVER` configures one |
| MongoDB backups | `backups_data` volume (`BACKUP_DIR`) |
| Encryption keys | `ENCRYPTION_KEY`, `ENCRYPTION_KEY_ID`, `ENCRYPTION_KEY_PREVIOUS`, `ENCRYPTION_KEY_PREVIOUS_ID` in the production env file |
| TSA and witness key material | `tsa_certs`, `tsa_state`, `tsa_secrets` and `witness_secrets` volumes |
| Production env file | `.env.production` on the host (template: `.env.production.example`) |

## Risks

| ID | Asset | Risk | Likelihood | Impact | Owner | Treatment | Status | Tracking issue |
|---|---|---|---|---|---|---|---|---|
| R-001 | MongoDB, MongoDB backups | Loss of the Docker host loses the data and its only backup copy: the backups sit in `backups_data` on the same host, with no second medium and no off-site copy. | Low | High | deployment operator (host access; not an application role) | Open: tracked in #1325. | Open | #1325 |
| R-002 | Neo4j, InfluxDB, Redis, file stores | These stores are not backed up at all, so their loss is unrecoverable. | Low | High | deployment operator (host access; not an application role) | Open: tracked in #1325. | Open | #1325 |
| R-003 | Encryption keys | A lost key makes encrypted fields, encrypted files and encrypted backups unreadable; the key is not in the backup and the code escrows it nowhere. | Low | High | deployment operator (host access; not an application role) | Open: tracked in #1325. Partly mitigated: rotation keeps the previous key decrypt-only (`ENCRYPTION_KEY_PREVIOUS`) until `npm run encryption:rewrite` reports it safe to empty. That verdict does not read the on-disk backup folders: keep the previous key until every backup taken under it has aged out of retention or been re-taken. | Open | #1325 |
| R-004 | MongoDB | A restore from an unchecked or corrupt backup replaces the live collections (`mongorestore --drop`), with no checksum check and no safety backup first. | Low | High | Administrador (`manageBackup`) | Open: tracked in #1325. Partly mitigated: the weekly restore test recomputes the checksum and restores into a scratch database, and `POST /api/backup/restore-test/:fileName` lets the operator test a folder before restoring it (runbook section 8). | Open | #1325 |
| R-005 | TSA and witness key material | Loss of the TSA/witness key volumes invalidates previously issued timestamps and signatures; the volumes are not backed up. | Low | High | deployment operator (host access; not an application role) | Open: tracked in #1325. | Open | #1325 |
| R-006 | MongoDB backups | A backup run whose policy lookup fails is written unencrypted, with only an error log. | Low | Medium | Administrador (`manageBackup`) | Open: tracked in #1325. Partly mitigated: with the policy readable and no key configured, the backup aborts instead of writing plaintext. | Open | #1325 |

Owner names a role, never a person (RNF006 C6: no personal data). Inference, not stated in the requirements: `Administrador` owns a risk that an application permission (`manageBackup`, `manageSystem`) covers, and otherwise the deployment operator owns it; this follows the requirements naming responsibilities by role.

Likelihood and impact are this register's first estimate, to be revised at each review.

The backup facts behind R-001 to R-006 are in `docs/operations/backup-restore-runbook.md`, section 10.

## Review

The register is reviewed when an issue it lists closes, and at each release. Each review updates the rows it touches and records its date in the history below.

## History

- 2026-10-25: created.
