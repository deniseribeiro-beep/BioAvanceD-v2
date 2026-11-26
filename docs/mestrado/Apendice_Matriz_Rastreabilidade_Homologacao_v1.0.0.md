# Apêndice Técnico — Matriz de Rastreabilidade e Homologação Runtime

| Controle | Valor |
|---|---|
| Documento | Apêndice técnico de rastreabilidade RF/RNF ↔ código ↔ testes ↔ homologação |
| Projeto | BioAvanceD |
| Baseline documental | Requisitos v4.0.0; Modelo canônico v2.0.0; Matriz de rastreabilidade do modelo v2.0.0 |
| Baseline de código | Repositório `BioAvanceD-v2` (runtime atual) |
| Data de consolidação | 2026-11-03 |
| Objetivo | Fechar a matriz de rastreabilidade **sem lacunas 1:1** entre requisito, entregável de código, caso de teste e status de homologação |
| Escopo | RF001–RF029; RNF001–RNF032; RULE-001–RULE-037; checklist GOV/CFG/BIO/CON/SPM/IDF/RCS/… |

> **Nota de interpretação.** A aprovação documental da release canônica v2.0.0 (2026-09-12) cobre o **modelo**. Este apêndice cobre o **runtime** (implementação + evidência de validação automatizada). Homologação operacional ex ante de identificação física permanece `approved_for_execution` / `not_executed` conforme `docs/RELEASE_MANIFEST.json`.

---

## 0. Critérios de status de homologação

| Status | Significado neste apêndice |
|---|---|
| **Aprovado** | Entregável de código ativo + cobertura automatizada (unit/integration e/ou e2e e/ou architecture) alinhada ao requisito; incluso no gate `current-state:ci` ou e2e-gate quando aplicável |
| **Em Teste** | Código presente e testes existem, porém cobertura parcial, dependente de ambiente controlado, ou sem fechamento e2e completo no gate oficial |
| **Pendente** | Sem evidência automatizada suficiente; requisito de desempenho/operacional ainda sem campanha; ou artefato **futuro condicionado** (inativo por desenho) |

Vocabulário de papéis (RBAC): 1 Externo · 2 Técnico · 3 Coordenador · 4 Administrador.

---

## 1. Componentes de arquitetura e módulos do BioAvanceD

### 1.1 Camadas de runtime

| Componente | Tecnologia | Autoridade |
|---|---|---|
| API HTTP | Node.js / Express (`api/backend`) | Contrato operacional |
| SPA | React 18 / Vite (`frontend`) | Apresentação e fluxos UI |
| MongoDB | Fonte operacional | Persistência canônica |
| Neo4j | Projeção via outbox | Linhagem / grafo (não SoT) |
| InfluxDB | Séries temporais | Telemetria bruta |
| Redis / BullMQ | Filas e suporte | Import, jobs |
| TSA + Witness | RFC3161 + coassinatura | Âncoras de auditoria |
| Object store | Filesystem / S3 | Binários (`DataFile`) |
| FHIR R4 | Serialização | Fronteira pura (sem dual-write) |

### 1.2 Módulos lógicos ↔ pastas de código

| Módulo lógico | Backend (principais) | Frontend (principais) |
|---|---|---|
| Autenticação / MFA / sessão | `interface/routes/auth.routes.js`, `user-security.routes.js`, `services` de auth/session | `LoginPage`, `MFASetupPage`, `UserSecurityPage`, `AuthContext` |
| RBAC / tenancy | `infrastructure/middleware/rbac.js`, `auth.js`, `organization.routes.js` | `ProtectedRoute`, `rolePermissions`, `Dashboard` |
| Participantes / identidade | `patient.routes.js`, `patient.service.js`, `participantIdentity.service.js` | `PatientsPage`, intake wizard |
| Amostras / custódia | `sample.routes.js`, `sample.service.js`, use-cases Register/Allocate/Move | `SamplesPage*`, `SampleDetailsPage`, custody/movements |
| Storage físico | `storage.routes.js`, `physical-chain.routes.js`, `physicalChain.service.js` | `InlineStorageMovementPanel`, facility/storage UI |
| eConsent / TCLE | `routes/eConsent.js`, `consent.service.js`, `consentQuarantine.service.js` | `TcleBuilderPage`, `EConsent*`, `ConsentForm` |
| Import / quarentena | `import.routes.js`, `import-lgpd.routes.js`, `import-worker.js` | `ImportForm`, `ImportLGPDPage`, `ImportQuarantinePage` |
| Telemetria / IoT | `temperature.routes.js`, `iot.routes.js`, `TelemetryMonitor` | `FacilityManagementPage`, sensores/políticas |
| Relatórios | `reports.routes.js`, `reportTemplates.routes.js` | `ReportsPage*`, `ReportQueryPage` |
| Auditoria / Merkle | `audit.routes.js`, `daily-merkle.job.js`, Merkle services | `LogsPage`, compliance views |
| Backup | `backup.routes.js`, `scheduler.service.js` | `BackupPage` |
| Foundation / refs | `foundation/*`, `reference-data/*`, scripts RF028 | Foundation `/next`, dicionário |
| Ingestão RF029 | `ingestion.routes.js`, `productionIngestion` | `ingestion-records` e2e / admin |
| Interoperabilidade | `fhir-export*`, FHIR staging, MIABIS | `FhirImportPage`, interop monitors |
| Governança / retenção | `retentionPolicy`, `legalHold`, `dispositionAction`, access-request | Access requests, system management |

### 1.3 Workers e jobs

| Processo Compose | Função |
|---|---|
| `backend` | API + `scheduler.service` (backup, retenção, monitores) |
| `worker` | BullMQ import + Merkle diário |
| `neo4j-projection-worker` | Drena `graph_projection_outbox` |
| `foundation-bootstrap` / `essential-reference-bootstrap` / cadeia RF028 | One-shots de prontidão e referências |

---

## 2. Catálogo de Requisitos Funcionais (RF001–RF029)

| ID | Módulo | Aplicação | Entidades-chave | Entregável / código (âncora) | Casos de teste / validação (âncora) | Homologação |
|---|---|---|---|---|---|---|
| **RF001** | Segurança e autenticação | F1/F3 | UserAccount; Session; SecurityConfiguration | `/api/auth`, `/api/user/security`; `auth.routes.js`; MFA Speakeasy | `auth-access-security.spec.ts`; `auth.routes.test.js`; `auth.service.*.test.js`; `user-security.*` | **Aprovado** |
| **RF002** | Dashboard e autorização | F1/F3 | Role; Permission; AccessPolicy | `Dashboard.tsx`; `rolePermissions.ts`; gates RBAC nas rotas | `rf002-role-views.spec.ts`; `reports.external-grants.rf002.test.js`; `rbac*.test.js` | **Aprovado** |
| **RF003** | Gestão de usuários | F1/F3 | UserAccount; UserRoleAssignment | `/api/users`; `user.routes.js`; org-scope | `user-management-tenancy.spec.ts`; `users*.test.js`; `users.org-scope.routes.test.js` | **Aprovado** |
| **RF004** | Cadastro integrado / governança | F1/F3 | Participant; Specimen; Collection; Consent | `/api/intake-wizard`; `ClinicalIntakeWizard`; collection governance | `intake-wizard.spec.ts`; `cadastro-amostra.spec.ts`; `collection-governance-ui.spec.ts`; `RegisterSampleUseCase.test.js` | **Aprovado** |
| **RF005** | Participante e clínicos | F1/F3 | Participant; ParticipantIdentity; ClinicalObservation | `/api/patients`; identidade cifrada; reidentify gate | `patients*.api.test.js`; `reidentification-boundary.arch.test.js`; `participant-canonical*.arch.test.js` | **Aprovado** |
| **RF006** | Custódia / quantidade / estados | F1/F3 | Specimen; Custody; DispositionAction | `/api/samples` withdraw/return/close; `Sample.js` statuses v2 | `specimen-status-v2.spec.ts`; `sample-storage-lifecycle.spec.ts`; `physical-chain.spec.ts`; `sample.service.test.js` | **Aprovado** |
| **RF007** | Arquivos científicos | F1/F3 | DataFile; SampleFile | upload criptografado; object store; `/api/file-access` | `scientific-data-access.spec.ts`; `sample-files-section-ui.spec.ts`; `linked-file-routes.api.test.js` | **Aprovado** |
| **RF008** | Relatórios | F1/F3 | Report; ReportTemplate | `/api/reports`, `/api/report-templates` | `report-inventory-filters.spec.ts`; `reports.api.test.js` | **Aprovado** |
| **RF009** | Telemetria ambiental | F1/F2/F3 | TelemetryReading; Sensor; Policy; ExposureSummary | `/api/temperature`, `/api/iot`, `/api/sensors`, exposure chain | `rf009-exposure-chain.spec.ts`; `rf009-chain-quarantine.spec.ts`; `facility-temperature-readings.spec.ts`; `telemetryBinding.api.test.js` | **Aprovado** |
| **RF010** | TCLE amplo/dinâmico | F1/F3 | ConsentTemplate; PatientConsent; ConsentRevocation | `/api/e-consent`; TcleBuilder; páginas públicas | `tcle-dinamico.spec.ts`; `participant-e-consent-page.spec.ts`; `consent-*.spec.ts`; `eConsent.routes.test.js` | **Aprovado** |
| **RF011** | Interoperabilidade FHIR R4 | F1/F2/F3 | InteroperabilityMappingRelease; FHIR adapters | `/api/export/fhir`; FHIR import staging; namespaces | `interop-monitoring.spec.ts`; `e-consent-import-page.spec.ts`; `fhir-*.test.js` | **Em Teste** |
| **RF012** | Auditoria criptográfica | Transversal | AuditEvent; Merkle roots | `/api/audit`; `daily-merkle.job.js`; TSA/witness | `audit-chain-integrity.spec.ts`; `audit-v2.service.test.js`; architecture audit coverage | **Aprovado** |
| **RF013** | Backup e restauração | F1/transversal | BackupPolicy; dumps criptografados | `/api/backup`; `scheduler.service.js` | `backup.api.test.js`; `backup.service.test.js`; `BackupPage.test.tsx` | **Aprovado** |
| **RF014** | Políticas / configuração | F1/transversal | SecurityConfiguration; ConfigurationRelease; RetentionPolicy | `/api/security`; releases; retention | `security.routes.test.js`; `security-permissions-readonly.spec.ts`; `retentionPolicy.routes.test.js` | **Aprovado** |
| **RF015** | Alertas e notificações | F1/F3 | NotificationRule; Notification | `/api/notification-rules`, `/api/notifications` | `notificationRule.routes.test.js`; `notificationDispatch.service.test.js` | **Em Teste** |
| **RF016** | Identificação física unificada | F1/F2/F3 | LabelIdentifier; ScanEvent; IdentificationPolicy | `/api/physical-chain` labels/scan; `CryoLabelPrinter`; barcode services | `physical-chain.spec.ts`; `labelIdentifier`/`scanEvent` model tests; protocolo ex ante **não executado** | **Em Teste** |
| **RF017** | Equipamentos e armazenamento | F1/F2/F3 | StorageLocation; Container; Device; Datastream | `/api/storage`, `/api/devices`, topology authoring | `storage-topology-authoring.spec.ts`; `storage-allocation-tenancy.spec.ts`; `device.api.test.js` | **Aprovado** |
| **RF018** | SPREC / RCS | F1/F2/F3 | RcsAssessment; RcsRulePackage; snapshots | `/api/quality`; RCS services; imutabilidade | `specimen-quality-inventory.spec.ts`; `rcs-results-immutable.arch.test.js`; RCS model/unit tests | **Aprovado** |
| **RF019** | Quarentena lógica | F1/F2-F3 | QuarantineAction; IngestionQuarantineRecord | sample quarantine release; import quarantine; consent quarantine | `async-import-quarantine.spec.ts`; `rf009-chain-quarantine.spec.ts`; `quarantine-*.test.js` | **Aprovado** |
| **RF020** | Metadados / MIABIS | F1/F2/F3 | Biobank; Collection; governance contexts | master-data biobanks/collections; `/api/biobanks/miabis` | `miabis-export.spec.ts`; `miabis-export.api.test.js`; `organization-collection-management-ui.spec.ts` | **Aprovado** |
| **RF021** | Estudos / ética / custódia | F1/F3 | Study; Protocol; CustodianshipAssignment | master-data studies/protocols; physical-chain custody | `study-protocol-collection-crud.spec.ts`; `CustodianshipAssignment` tests; custody API | **Aprovado** |
| **RF022** | Foundation Data Pipeline | Fase 1 | FoundationDataRun; ReadinessReport | compose foundation bootstraps; `seed:essential`; readiness | `pipeline-continuity.spec.ts`; `foundation/readiness.test.js`; `seed-boundary.arch.test.js`; `current-state:ci` | **Aprovado** |
| **RF023** | Outbox / Neo4j | F1/F2-F3 | GraphProjectionOutboxEvent | `neo4jProjection.worker.js`; outbox services | `neo4j-boundary.arch.test.js`; `neo4jProjection.worker.test.js`; helpers `queryNeo4j.ts` | **Aprovado** |
| **RF024** | Acesso e distribuição | F1/F3 | AccessRequest; AccessPolicy; Shipment | `/api/access-requests`, `/api/access-policies`, `/api/shipments` | `access-requests-ui.spec.ts`; `accessRequest.service.test.js` | **Em Teste** |
| **RF025** | Ensaios / NC | F1/F3 | Assay; ReagentLot; Nonconformance | master-data assays; `/api/nonconformances`; equipment | `diagnostic-reports.spec.ts`; nonconformance routes; equipment API | **Em Teste** |
| **RF026** | Retenção / destinação / close | F1/F3 | RetentionPolicy; LegalHold; DispositionAction | `/api/retention-policies`, `/api/legal-holds`, `/api/disposition-actions`; sample close | retention/disposition unit+integration; specimen close paths | **Em Teste** |
| **RF027** | Workflows / ômicos | F1/F3 | WorkflowRun; OmicsRun; OmicsQualification | `/api/workflow-runs`, `/api/omics-*` | `workflow-run*.api.test.js`; `omics-*.api.test.js` | **Em Teste** |
| **RF028** | Importação de referências | F1/F2 | ReferenceDatasetRelease; CoverageManifest | scripts `reference:import:*`; compose bootstrap cadeia 16 fontes | `reference-import-boundary.arch.test.js`; `reference:live-verify` workflow; coverage/pipeline unit | **Aprovado** |
| **RF029** | Ingestão operacional/científica | Fase 3 | Ingestion gateway; quarantine | `/api/ingestion`; `productionIngestion` | `ingestion-records.spec.ts`; `ingestion.routes.api.test.js`; `ingestion-civil-data-boundary.arch.test.js` | **Aprovado** |

---

## 3. Catálogo de Requisitos Não Funcionais (RNF001–RNF032)

| ID | Categoria | Tema | Entregável / evidência de código | Casos de teste / validação | Homologação |
|---|---|---|---|---|---|
| **RNF001** | Desempenho | p95 UI ≤ 2 s | `scripts/rnf001-ui-p95.mjs` + `rnf001-ui-p95-results.json` (GCP 2026-11-04) | CT-RNF001-LOAD-01 (N=30; p95 max rota 390 ms ≪ 2000 ms) | **Aprovado** |
| **RNF002** | Desempenho | Lookup IDs ≤ 3 s @100k | Índices `sampleIndexes` / identifier lookup scripts | `identifier-lookup-explain.test.js`; gaps reports | **Em Teste** |
| **RNF003** | Disponibilidade | 99,5% / health | `GET /api/health`; Compose healthchecks | `health.api.test.js`; `dependencyHealth.test.js` | **Em Teste** |
| **RNF004** | Resiliência | Buffer telemetria | edge buffer scripts/services | `telemetry-edge-buffer.spec.ts`; unit buffer | **Em Teste** |
| **RNF005** | Usabilidade | Curva de aprendizado | `docs/user-guides/*` | Revisão documental / showcase | **Em Teste** |
| **RNF006** | Documentação | Técnica + usuário | OpenAPI `docs/api/openapi.json`; user-guides; README | `openapi-routes.arch.test.js` | **Aprovado** |
| **RNF007** | Privacidade | Segregação identidade | `ParticipantIdentity`; encryption; Neo4j sem PII | `reidentification-boundary.arch.test.js`; patients identity tests | **Aprovado** |
| **RNF008** | Segurança | RBAC + escopo + rate-limit | `rbac.js`; auth/consent limiters | `auth-access-security.spec.ts`; rate-limiter integration | **Aprovado** |
| **RNF009** | Auditoria | Append-only verificável | audit chain + Merkle + logs | `audit-chain-integrity.spec.ts`; `audit-entity-coverage.arch.test.js` | **Aprovado** |
| **RNF010** | Continuidade | Backup/restore | backup services + policy + restore-test cron | backup unit/integration; `BackupPage` | **Aprovado** |
| **RNF011** | Integridade | Qualidade / missingness / quarentena import | batch-validation; import-lgpd quarantine | `async-import-quarantine.spec.ts`; quarantine unit suite | **Aprovado** |
| **RNF012** | Qualidade biobanco | Alinhamento ISO 20387 | cadeia física, custódia, labels | coberturas RF006/016/017/021 | **Em Teste** |
| **RNF013** | Segurança ISMS | Alinhamento ISO 27001 | security config releases; secrets; helmet | security routes + decisions | **Em Teste** |
| **RNF014** | Reprodutibilidade | Conteinerização | `compose*.yml`; Dockerfiles | `pipeline-continuity.spec.ts`; CI compose.test | **Aprovado** |
| **RNF015** | Observabilidade | Métricas / filas / alertas | httpMetrics; platformAlerts; monitoring routes | `monitoring.api.test.js`; metrics unit | **Em Teste** |
| **RNF016** | Escalabilidade | Autoridade poliglota + object store | Mongo/Neo4j/Influx/S3 routing | objectStorage unit; FILE/DataFile tests | **Aprovado** |
| **RNF017** | Qualidade | Automação e gates CI | `.github/workflows/ci-pipeline.yml`; `e2e-gate.sh` | jobs current-state + e2e-tests | **Aprovado** |
| **RNF018** | Validação | Múltiplas camadas | arch + unit + integration + e2e | `validation-422-details.arch.test.js`; suíte ampla | **Aprovado** |
| **RNF019** | Integração | Outbox durável | Neo4j worker + reconcile scripts | `neo4jProjection.worker.test.js`; boundary arch | **Aprovado** |
| **RNF020** | Criptografia | Chaves / rotação / segredos | `ENCRYPTION_KEY*`; fieldEncryption; rewrite script | encryption unit suite; keyRegistry | **Aprovado** |
| **RNF021** | Sessão | Tokens / logout / refresh | Session model; refresh flow | `session.service.unit.test.js`; auth e2e | **Aprovado** |
| **RNF022** | Minimização | Retenção / destinação | RetentionPolicy + disposition | retention routes; RF026 overlap | **Em Teste** |
| **RNF023** | Evolução | Schemas / migrações | `src/scripts/migrate*.js` | migrações versionadas; testes pontuais | **Em Teste** |
| **RNF024** | Interop | FHIR sem side-effects | `fhir-boundary.arch.test.js`; export puro | fhir round-trip / export tests; interop e2e | **Aprovado** |
| **RNF025** | Tempo | Timestamps / clock sync | telemetria receivedAt/persistedAt; UTC noon birthDate decision | cobertura parcial em telemetria/identity | **Em Teste** |
| **RNF026** | Notificações | Latência alertas críticos | notification dispatch + temp alerts | notification unit; interop-monitoring | **Em Teste** |
| **RNF027** | Acessibilidade | UI inclusiva | contraste/viewport decisions; axe | `rnf027-axe.spec.ts`; `rnf027-interface.spec.ts` | **Aprovado** |
| **RNF028** | Modularidade | Governança arquitetural | ADR `docs/decisions/*`; arch tests | `configurationValidation.service.test.js`; arch suite | **Aprovado** |
| **RNF029** | Object storage | Integridade binários | object store + access tokens | `file-access.routes.api.test.js`; SampleFile/crypto tests | **Aprovado** |
| **RNF030** | Proveniência ômica | Workflows AI-ready inativos | modelos analíticos preparados; gate inativo | `inactive-analytical-structures.arch.test.js` | **Pendente** (futuro condicionado) |
| **RNF031** | Foundation | Pipeline governado | ReadinessReport; CFG/PIP checklist | `pipeline-continuity.spec.ts`; foundation tests | **Aprovado** |
| **RNF032** | Referências | Proveniência / promoção / rollback | reference release routes + live-verify | `reference-imports/pipeline.test.js`; live-verify workflow | **Aprovado** |

### 3.1 Síntese de homologação

| Conjunto | Aprovado | Em Teste | Pendente | Total |
|---|---:|---:|---:|---:|
| RF001–RF029 | 22 | 7 | 0 | 29 |
| RNF001–RNF032 | 19 | 12 | 1 | 32 |
| **Total** | **41** | **19** | **1** | **61** |

Lacuna explícita remanescente: **RNF030** (estruturas de modelo/IA inativas por desenho — ver exceção de publicação).

---

## 4. Matriz 1:1 — Requisito ↔ Caso de teste (validation)

Convenção de ID de caso: `CT-<REQ>-<camada>-<n>` (camada: `E2E` | `INT` | `UNIT` | `ARCH` | `CI`).

### 4.1 Funcionais (amostra canônica por RF; cada RF possui ≥1 CT)

| ID Requisito | ID Caso de Teste | Artefato de validação | Tipo |
|---|---|---|---|
| RF001 | CT-RF001-E2E-01 | `tests/e2e/auth-access-security.spec.ts` | E2E |
| RF001 | CT-RF001-INT-01 | `api/backend/tests/integration/auth.routes.test.js` | INT |
| RF001 | CT-RF001-UNIT-01 | `api/backend/tests/unit/auth.service.login.unit.test.js` | UNIT |
| RF002 | CT-RF002-E2E-01 | `tests/e2e/rf002-role-views.spec.ts` | E2E |
| RF002 | CT-RF002-INT-01 | `api/backend/tests/integration/reports.external-grants.rf002.test.js` | INT |
| RF003 | CT-RF003-E2E-01 | `tests/e2e/user-management-tenancy.spec.ts` | E2E |
| RF003 | CT-RF003-INT-01 | `api/backend/tests/integration/users.org-scope.routes.test.js` | INT |
| RF004 | CT-RF004-E2E-01 | `tests/e2e/intake-wizard.spec.ts` | E2E |
| RF004 | CT-RF004-E2E-02 | `tests/e2e/collection-governance-ui.spec.ts` | E2E |
| RF005 | CT-RF005-ARCH-01 | `api/backend/tests/architecture/reidentification-boundary.arch.test.js` | ARCH |
| RF005 | CT-RF005-INT-01 | `api/backend/tests/integration/patients.expanded.api.test.js` | INT |
| RF006 | CT-RF006-E2E-01 | `tests/e2e/specimen-status-v2.spec.ts` | E2E |
| RF006 | CT-RF006-E2E-02 | `tests/e2e/sample-storage-lifecycle.spec.ts` | E2E |
| RF007 | CT-RF007-E2E-01 | `tests/e2e/scientific-data-access.spec.ts` | E2E |
| RF008 | CT-RF008-E2E-01 | `tests/e2e/report-inventory-filters.spec.ts` | E2E |
| RF009 | CT-RF009-E2E-01 | `tests/e2e/rf009-exposure-chain.spec.ts` | E2E |
| RF009 | CT-RF009-E2E-02 | `tests/e2e/rf009-chain-quarantine.spec.ts` | E2E |
| RF010 | CT-RF010-E2E-01 | `tests/e2e/tcle-dinamico.spec.ts` | E2E |
| RF010 | CT-RF010-E2E-02 | `tests/e2e/participant-e-consent-page.spec.ts` | E2E |
| RF011 | CT-RF011-E2E-01 | `tests/e2e/interop-monitoring.spec.ts` | E2E |
| RF011 | CT-RF011-INT-01 | `api/backend/tests/integration/fhir-export.api.test.js` | INT |
| RF012 | CT-RF012-E2E-01 | `tests/e2e/audit-chain-integrity.spec.ts` | E2E |
| RF013 | CT-RF013-INT-01 | `api/backend/tests/integration/backup.api.test.js` | INT |
| RF014 | CT-RF014-E2E-01 | `tests/e2e/security-permissions-readonly.spec.ts` | E2E |
| RF015 | CT-RF015-INT-01 | `api/backend/tests/integration/notificationRule.routes.test.js` | INT |
| RF016 | CT-RF016-E2E-01 | `tests/e2e/physical-chain.spec.ts` | E2E |
| RF016 | CT-RF016-UNIT-01 | `api/backend/tests/unit/models/labelIdentifier.model.test.js` | UNIT |
| RF017 | CT-RF017-E2E-01 | `tests/e2e/storage-topology-authoring.spec.ts` | E2E |
| RF018 | CT-RF018-E2E-01 | `tests/e2e/specimen-quality-inventory.spec.ts` | E2E |
| RF018 | CT-RF018-ARCH-01 | `api/backend/tests/architecture/rcs-results-immutable.arch.test.js` | ARCH |
| RF019 | CT-RF019-E2E-01 | `tests/e2e/async-import-quarantine.spec.ts` | E2E |
| RF020 | CT-RF020-E2E-01 | `tests/e2e/miabis-export.spec.ts` | E2E |
| RF021 | CT-RF021-E2E-01 | `tests/e2e/study-protocol-collection-crud.spec.ts` | E2E |
| RF022 | CT-RF022-E2E-01 | `tests/e2e/pipeline-continuity.spec.ts` | E2E |
| RF022 | CT-RF022-CI-01 | `npm --prefix api/backend run current-state:ci` | CI |
| RF023 | CT-RF023-ARCH-01 | `api/backend/tests/architecture/neo4j-boundary.arch.test.js` | ARCH |
| RF023 | CT-RF023-UNIT-01 | `api/backend/tests/unit/neo4jProjection.worker.test.js` | UNIT |
| RF024 | CT-RF024-E2E-01 | `tests/e2e/access-requests-ui.spec.ts` | E2E |
| RF025 | CT-RF025-E2E-01 | `tests/e2e/diagnostic-reports.spec.ts` | E2E |
| RF026 | CT-RF026-INT-01 | `api/backend/tests/integration/retentionPolicy.routes.test.js` | INT |
| RF027 | CT-RF027-INT-01 | `api/backend/tests/integration/workflow-run.api.test.js` | INT |
| RF028 | CT-RF028-ARCH-01 | `api/backend/tests/architecture/reference-import-boundary.arch.test.js` | ARCH |
| RF028 | CT-RF028-CI-01 | `.github/workflows/reference-data-live-verify.yml` | CI |
| RF029 | CT-RF029-E2E-01 | `tests/e2e/ingestion-records.spec.ts` | E2E |
| RF029 | CT-RF029-ARCH-01 | `api/backend/tests/architecture/ingestion-civil-data-boundary.arch.test.js` | ARCH |

### 4.2 Não funcionais (vínculo 1:1 mínimo)

| ID Requisito | ID Caso de Teste | Artefato | Tipo | Homologação |
|---|---|---|---|---|
| RNF001 | CT-RNF001-LOAD-01 | `docs/evidencias/homologacao-runtime/rnf001-ui-p95-results.json` (GCP VM) | LOAD | Aprovado |
| RNF002 | CT-RNF002-UNIT-01 | `identifier-lookup-explain.test.js` | UNIT | Em Teste |
| RNF003 | CT-RNF003-INT-01 | `health.api.test.js` | INT | Em Teste |
| RNF004 | CT-RNF004-E2E-01 | `telemetry-edge-buffer.spec.ts` | E2E | Em Teste |
| RNF005 | CT-RNF005-DOC-01 | `docs/user-guides/*` + showcase | DOC | Em Teste |
| RNF006 | CT-RNF006-ARCH-01 | `openapi-routes.arch.test.js` | ARCH | Aprovado |
| RNF007 | CT-RNF007-ARCH-01 | `reidentification-boundary.arch.test.js` | ARCH | Aprovado |
| RNF008 | CT-RNF008-E2E-01 | `auth-access-security.spec.ts` | E2E | Aprovado |
| RNF009 | CT-RNF009-E2E-01 | `audit-chain-integrity.spec.ts` | E2E | Aprovado |
| RNF010 | CT-RNF010-INT-01 | `backup.api.test.js` / policy | INT | Aprovado |
| RNF011 | CT-RNF011-E2E-01 | `async-import-quarantine.spec.ts` | E2E | Aprovado |
| RNF012 | CT-RNF012-E2E-01 | `physical-chain.spec.ts` (proxy ISO 20387) | E2E | Em Teste |
| RNF013 | CT-RNF013-INT-01 | `security.routes.test.js` | INT | Em Teste |
| RNF014 | CT-RNF014-E2E-01 | `pipeline-continuity.spec.ts` | E2E | Aprovado |
| RNF015 | CT-RNF015-INT-01 | `monitoring.api.test.js` | INT | Em Teste |
| RNF016 | CT-RNF016-UNIT-01 | `objectStorage/*.test.js` | UNIT | Aprovado |
| RNF017 | CT-RNF017-CI-01 | `ci-pipeline.yml` + `e2e-gate.sh` | CI | Aprovado |
| RNF018 | CT-RNF018-ARCH-01 | `validation-422-details.arch.test.js` | ARCH | Aprovado |
| RNF019 | CT-RNF019-UNIT-01 | `neo4jProjection.worker.test.js` | UNIT | Aprovado |
| RNF020 | CT-RNF020-UNIT-01 | `fieldEncryption*.test.js` | UNIT | Aprovado |
| RNF021 | CT-RNF021-UNIT-01 | `session.service.unit.test.js` | UNIT | Aprovado |
| RNF022 | CT-RNF022-INT-01 | retention/disposition routes | INT | Em Teste |
| RNF023 | CT-RNF023-DOC-01 | inventário `migrate*.js` + testes pontuais | DOC/UNIT | Em Teste |
| RNF024 | CT-RNF024-ARCH-01 | `fhir-boundary.arch.test.js` | ARCH | Aprovado |
| RNF025 | CT-RNF025-UNIT-01 | telemetria timestamps / birthDate noon UTC | UNIT | Em Teste |
| RNF026 | CT-RNF026-UNIT-01 | `notificationDispatch.service.test.js` | UNIT | Em Teste |
| RNF027 | CT-RNF027-E2E-01 | `rnf027-axe.spec.ts` | E2E | Aprovado |
| RNF027 | CT-RNF027-E2E-02 | `rnf027-interface.spec.ts` | E2E | Aprovado |
| RNF028 | CT-RNF028-UNIT-01 | `configurationValidation.service.test.js` | UNIT | Aprovado |
| RNF029 | CT-RNF029-INT-01 | `file-access.routes.api.test.js` | INT | Aprovado |
| RNF030 | CT-RNF030-ARCH-01 | `inactive-analytical-structures.arch.test.js` | ARCH | Pendente\* |
| RNF031 | CT-RNF031-E2E-01 | `pipeline-continuity.spec.ts` | E2E | Aprovado |
| RNF032 | CT-RNF032-UNIT-01 | `reference-imports/pipeline.test.js` | UNIT | Aprovado |

\*RNF030: o teste **aprova a inatividade** das estruturas; a homologação do recurso de IA permanece Pendente por escopo.

---

## 5. Matriz 1:1 — Requisito ↔ Entregável de código

| ID | API / superfície | Serviços / use-cases | Modelos | UI |
|---|---|---|---|---|
| RF001 | `/api/auth`, `/api/user/security` | auth/session/MFA services | User, Session | Login, MFA, UserSecurity |
| RF002 | gates em todas as rotas protegidas | `rbac.js`, permission catalog | Role assignments | Dashboard, Sidebar, ProtectedRoute |
| RF003 | `/api/users`, `/api/organizations` | user + org-scope services | User, Organization | SystemManagement / NewUser |
| RF004 | `/api/intake-wizard`, samples/patients | intakeWizard, RegisterSample | Patient, Sample, Collection | ClinicalIntakeWizard |
| RF005 | `/api/patients` | patient + participantIdentity | Patient, ParticipantIdentity | PatientsPage |
| RF006 | `/api/samples`, physical-chain custody | sample.service withdraw/return/close | Sample, custody models | Samples*, Chain, Movements |
| RF007 | sample files, `/api/file-access`, analysis-files | SampleFile / objectStorage | SampleFile, DataFile* | SampleFilesSection |
| RF008 | `/api/reports`, `/api/report-templates` | reports services | ReportTemplate | Reports* |
| RF009 | temperature/iot/sensors/policies/incidents | TelemetryMonitor, exposure | Sensor, Telemetry*, Incident | FacilityManagement |
| RF010 | `/api/e-consent` | consent + quarantine | ConsentTemplate, PatientConsent | TcleBuilder, EConsent* |
| RF011 | `/api/export/fhir`, import FHIR | fhir-export/staging/mappings | InteroperabilityMappingRelease | FhirImportPage |
| RF012 | `/api/audit`, `/api/logs` | Merkle, auditLogger | Audit envelopes | LogsPage |
| RF013 | `/api/backup`, `/api/backup-policy` | backup + scheduler | BackupPolicy | BackupPage |
| RF014 | `/api/security`, retention | security config releases | ConfigurationRelease, RetentionPolicy | Security tabs |
| RF015 | `/api/notifications*` | notificationDispatch | NotificationRule | (API-first; UI parcial) |
| RF016 | physical-chain labels/scan | labelResolver, specimenLabel | LabelIdentifier, ScanEvent | CryoLabelPrinter, SampleLabel |
| RF017 | `/api/storage`, devices, datastreams | storageService, physicalChain | Storage*, Container*, Device* | storage UI / facility |
| RF018 | `/api/quality` | rcs-assessment, quality-domain | RcsAssessment, RcsRulePackage | quality inventory |
| RF019 | quarantine endpoints + import quarantine | quarantine-action/release | QuarantineAction, IngestionQuarantineRecord | ImportQuarantinePage |
| RF020 | biobanks/collections/miabis | miabisExport, collectionGovernance | Biobank, Collection | org/collection UI |
| RF021 | studies/protocols + custody | custodianship services | Study, Protocol, CustodianshipAssignment | study-protocol UI |
| RF022 | foundation scripts / compose bootstraps | readiness, seed essential | FoundationDataRun, ReadinessReport | Foundation `/next` |
| RF023 | outbox writer + projection worker | neo4jCanonicalProjection | graph outbox collections | — (backend) |
| RF024 | access-requests/policies/shipments | accessRequest.service | AccessRequest, AccessPolicy, Shipment | AccessRequestsPage |
| RF025 | assays, nonconformances, equipment | nonconformance/equipment services | Assay, Nonconformance | diagnostic/facility |
| RF026 | retention/legal-hold/disposition + close | dispositionAction, retention | DispositionAction, LegalHold | close specimen actions |
| RF027 | workflow-runs, omics-* | workflowRun services | WorkflowRun, Omics* | (API-first) |
| RF028 | `/api/reference-releases` + import scripts | reference-imports pipeline | ReferenceDatasetRelease | DataDictionary (consulta) |
| RF029 | `/api/ingestion` | productionIngestion | Ingestion quarantine models | e2e ingestion |

---

## 6. Regras de negócio e processos (rastreáveis)

### 6.1 Regras canônicas (RULE-*) ↔ RF/código

| Rule ID | Domínio | RF(s) | Consequência | Homologação |
|---|---|---|---|---|
| RULE-001/002 | Regime biobank vs biorepository | RF004, RF020 | Contexto 1..1; rejeita incompatível | Aprovado |
| RULE-003–005 | quantityStatus derivado | RF006 | full/partial/depleted; write manual rejeitado | Aprovado |
| RULE-006/007 | close / DispositionAction executed | RF006, RF026 | bloqueio sem evidência/autorização; legal hold | Em Teste |
| RULE-008/009 | Consent decision / revocation | RF010, RF019 | permit\|deny\|review; quarentena prospectiva | Aprovado |
| RULE-010–011, 019–022 | RCS admissibilidade e grades | RF018 | snapshot imutável; gate governança | Aprovado |
| RULE-012 | Label sem PII | RF016, RNF007 | bloqueia promoção/impressão | Em Teste |
| RULE-013/028/029 | Neo4j só via outbox; sem PII/raw telemetry | RF023, RNF019 | block + audit | Aprovado |
| RULE-014 | FHIR fronteira pura | RF011, RNF024 | sem dual-write | Aprovado |
| RULE-015/016 | Config/Foundation gates | RF014, RF022, RNF031 | não promove inválido; zero ops fictícios | Aprovado |
| RULE-017 | Reference promotion | RF028, RNF032 | license/checksum/coverage | Aprovado |
| RULE-018 | ModelArtifact | RNF030 | permanece inativo | Pendente (por desenho) |
| RULE-023–025 | TelemetryReading | RF009, RNF004 | Influx only; idempotência; sem PII | Aprovado |
| RULE-026 | Legacy StorageAssignment | RF017 | reject new writes | Aprovado |
| RULE-027 | ExposureSummary | RF009 | path hashes + reproducibilidade | Aprovado |
| RULE-030–035 | Cadeia física temporal | RF016, RF017 | exclusividade de ocupação | Aprovado |
| RULE-035† / 036 | Mapping FHIR / namespaces | RF011 | bioadvanced.dev | Em Teste |
| RULE-037 | Protocolo ex ante sintético | RF016 | sem espécime real | Pendente execução |

†IDs duplicados no extrato documental RULE-035 (rack + mapping) — preservar ambos os sentidos na matriz documental original.

### 6.2 Processos operacionais (pipelines)

| Processo | Passos | RF/RNF | Evidência |
|---|---|---|---|
| Intake clínico | Demografia → pré-analítica → biomarcadores/TCLE → `POST /intake-wizard` | RF004, RF005, RF010 | `intake-wizard.spec.ts` |
| Ciclo do espécime | register → allocate/move → withdraw/return → quarantine → close | RF006, RF017, RF019, RF026 | lifecycle + status e2e |
| eConsent | template → link/token → validate/update → ACTIVE/REVOKED → quarantine on revoke | RF010, RF019 | e-consent e2e suite |
| Import LGPD | upload → fila BullMQ → validação → persist/quarantine → resubmit | RF007, RF019, RNF011 | import e2e + unit |
| Telemetria | device/datastream → ingest → Influx → thresholds → incident/exposure | RF009, RNF004 | rf009 + facility e2e |
| Foundation | seed essential → readiness → reference chain RF028 | RF022, RF028, RNF031 | pipeline-continuity + CI |
| Auditoria diária | Merkle root → sign → TSA/witness backlog | RF012, RNF009 | audit-chain e2e + worker job |
| Projeção grafo | write outbox → lease → Cypher → PROJECTED | RF023, RNF019 | neo4j worker tests |

---

## 7. Checklist da matriz documental do modelo (ponte para o runtime)

A matriz aprovada do modelo (`docs/extracted-v2.0.0/matriz-MATRIZ.md`) contém **97** ações (73 P0). Este apêndice **não substitui** essa planilha; estabelece o vínculo runtime:

| Família checklist | RF/RNF principais | Status runtime agregado |
|---|---|---|
| GOV-001–006 | RF022, RNF031, RNF015 | Aprovado (contratos canônicos + CI) |
| CFG-001–008 | RF014, RNF031 | Aprovado |
| BIO-001–007 | RF020, RF021 | Aprovado / Em Teste (MIABIS round-trip) |
| CON-001–009 | RF010, RF011 | Aprovado |
| SPM-001–007 | RF006, RF026 | Aprovado |
| IDF-001–010 | RF016 | Em Teste (+ ex ante Pendente execução) |
| RCS-001–007 | RF018 | Aprovado |
| REF-001–003 | RF028, RNF032 | Aprovado |
| INT-001–004 | RF011, RNF024 | Em Teste / Aprovado (boundary) |
| AUD/EVT/DB/FILE | RF012, RF023, RF007, RNF016 | Aprovado |
| SEC/POL/RET | RF003/005, RF014, RF024, RF026 | Aprovado / Em Teste |
| AIR-001–015 | RF029, RNF030, RNF031 | Parcial; AIR-008–012 Pendente (inativos) |
| PIP/DOC | RF022, DOC checklist | Aprovado documentalmente; runtime coberto por foundation |

Validações estruturais do workbook (VAL-001–VAL-028) permanecem **PASS** no extrato documental; são pré-condição de consistência do modelo, não substitutas dos CT-* de runtime.

---

## 8. Gates oficiais de evidência

| Gate | Comando / artefato | Cobre |
|---|---|---|
| Arquitetura + seeds + dicionário | `npm --prefix api/backend run current-state:ci` | RF022, RF028, RNF017/018/031 |
| Typecheck/build frontend | `npm --prefix frontend run typecheck && build` | RNF006/027 (parcial) |
| E2E containerizado | `bash scripts/e2e-gate.sh <out>` | RF/RNF com specs Playwright |
| Live-verify referências | `reference-data-live-verify.yml` | RF028 / RNF032 |
| CI agregado | `.github/workflows/ci-pipeline.yml` | current-state + unit frontend + e2e |

---

## 9. Encerramento da matriz (declaração de completude)

1. **ID do Requisito vs. Caso de Teste:** cada RF001–RF029 e RNF001–RNF032 possui pelo menos um `CT-*` explícito (Seções 4.1 e 4.2). Lacunas restantes estão nomeadas (RNF030 futuro; RF016 ensaio físico opcional — evidência sintética publicada).
2. **Requisito vs. Entregável/Código:** Seção 5 fecha o vínculo módulo/API/serviço/modelo/UI por RF.
3. **Status de Homologação:** Seções 2 e 3 atualizam o estado para **Aprovado / Em Teste / Pendente** com contagem agregada.
4. **RF/RNF por módulos, regras de negócio e arquitetura:** Seções 1, 2, 3 e 6 consolidam o catálogo operacional alinhado a `requisitos.md` v4.0.0 e à matriz do modelo v2.0.0.

### 9.1 Itens remanescentes conscientes (não são omissões)

| Item | Ação recomendada | Prioridade |
|---|---|---|
| RNF001 — campanha p95 UI | **Concluído** — `rnf001-ui-p95-results.json` @ `2026-11-04T13:47:59Z` (p95 ≤ 390 ms) | Fechado |
| RF016 — ensaio ex ante físico | Evidência sintética em `RF016-ex-ante-sintetico-v1.0.0.md` (RELEASE_MANIFEST `executed_synthetic`); ensaio físico opcional | P1 científico |
| RF011/024/025/026/027 — fechar e2e | **Concluído** — gate GCP `exit 0` / 402 passed (#1440) | Fechado |
| RNF030 / AIR-008–012 | Manter inativos até projeto ético dedicado — ver `RNF030-excecao-publicacao.md` | Condicionado |
| e2e-gate GCP 2026-11-04 | **Concluído** — Mongo exit 14 mitigado; gate verde | Fechado |

### 9.2 Decisão GO/NO-GO (2026-11-04)

| Critério | Estado |
|---|---|
| e2e-gate GCP `exit 0` | **GO** — `E2E_GATE_EXIT=0` / 402 passed @ `09:16:24Z` (#1440 closed) |
| #1436 Status Atual unknown | **GO** — PR #1439 merge `43399189` |
| #1428 coverage ≥90% quieto | **GO** — PR #1441 merge `c75fe4e0` (94.37/90.08/94.37/94.9) |
| Mongo exit 14 lab | **GO** — `wiredTigerCacheSizeGB 1.5` + `nofile 65536` |
| Binding UI↔Mongo | Spec + checklist; gate verde cobre jornadas UI correlatas |
| Showcase fluxo (vídeo) | Reel 2026-11-01 + gate 402 passed |
| RNF030 exceção | **GO** por desenho |
| RNF001 p95 UI | **GO** — CT-RNF001-LOAD-01 `overallPass=true`; p95 `/login` 85 ms, `/dashboard` 390 ms, `/samples` 274 ms, `/next/intake` 155 ms |
| Zenodo v1.0.3 pacote | **GO** para upload (zip inclui apêndice + `rnf001-ui-p95-results.json`) |
| UI import/intake 2026-11-06 | **GO parcial** — menu Importação em lote → FHIR; paginação quarentena/access/backup; CSS SPREC + biomarcadores do dicionário no intake; empty state de associações. Evidência unitária PASS; smoke homolog e ui-gold após tip-deploy (`docs/qa/MANUAL_VERIFY_20261106_import_intake.md`) |

**Publicação runtime “padrão ouro”:** **GO** — única lacuna consciente remanescente: RNF030 Pendente por desenho. Atualização UI 2026-11-06 (import FHIR + intake) entra no pacote Zenodo seguinte após captura ui-gold na homolog.

---

## 10. Referências

- `docs/extracted-v2.0.0/requisitos.md` — RF/RNF v4.0.0  
- `docs/extracted-v2.0.0/matriz-MATRIZ.md` — checklist 97 ações  
- `docs/extracted-v2.0.0/matriz-REGRAS.md` — RULE-001…  
- `docs/extracted-v2.0.0/matriz-TESTES_E_VALIDACOES.md` — VAL-001…028  
- `docs/architecture/canonical-data-contract-v1.md`  
- `docs/api/openapi.json`  
- `docs/RELEASE_MANIFEST.json`  
- `README.md` — status de implementação e gates  

---

*Fim do Apêndice Técnico — Matriz de Rastreabilidade e Homologação Runtime v1.0.0.*
