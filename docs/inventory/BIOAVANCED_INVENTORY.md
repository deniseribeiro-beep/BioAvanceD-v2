# Inventário Técnico do BioAvanceD

## 1. Metadados do commit
- Data de geração: 2026-05-19
- Branch atual: deploy/google-vm-post-inpi
- Commit atual: 5b10bc3915036c7f6d59a1e6a77fec5606831bef
- Status git (resumo): modificações e arquivos não rastreados presentes; alterações recentes em `api/backend` e `frontend` (resumo do `git status --short`).
- Observação: Inventário gerado para branch pós-INPI, sem alterar a tag imutável v1.0.0-inpi-rcs-gov.

## 2. Visão geral do software
BioAvanceD é um sistema de gestão, rastreabilidade e certificação de qualidade de biospecimens em biobancos. Suporta RCS-GOV 1.0, TCLE/e-consent, auditoria de integridade (Merkle), sincronizações entre MongoDB e Neo4j, e telemetria (InfluxDB). Arquitetura baseada em Node.js/Express (backend), React/Vite (frontend) e containers Docker para serviços (MongoDB, Neo4j, Redis, InfluxDB). Integrações externas controladas (Resend, opcionais Cloud/HPO/terminologias).

## 3. Arquitetura macro
- Frontend: `frontend/` — React + Vite, views e componentes organizados em `src/views` e `src/components`.
- Backend: `api/backend/` — Node.js/Express (CommonJS), `server.js`/`app.js`, `src/` com controllers, services, models, routes e infraestrutura.
- Bancos/serviços: MongoDB, Neo4j, Redis, InfluxDB (definidos em `docker-compose.yml`).
- Docker: orquestração via `docker-compose.yml` e `./scripts` auxiliares para ambiente local.
- Testes: backend unit/integration em `api/backend/tests`, frontend e2e com Playwright (`frontend/tests` e `frontend` scripts).
- Documentação: `docs/` e `api/backend/COMPLIANCE_EVIDENCE.json`.
- Integrações externas permitidas (controladas): Resend (email), opcional HPO/Orphanet/terminologias, MQTT (opcional), serviços cloud desabilitados por padrão.

## 4. Backend
Tabela representativa (path relativo ao repositório) — rotas, controllers, services, models, middlewares, config, scripts, testes.

| Pasta / Arquivo | Tipo | Finalidade resumida |
|---|---:|---|
| `api/backend/server.js` | entry | Ponto de entrada do servidor Express.
| `api/backend/app.js` | config/app | Inicialização do Express, middlewares globais, i18n, audit middleware.
| `api/backend/src/interface/routes/*.js` | routes | Definem endpoints HTTP (ex.: `patient.routes.js`, `sample.routes.js`, `auth.routes.js`, `temperature.routes.js`, `intakeWizard.routes.js`, `import.routes.js`).
| `api/backend/src/controllers/*.js` | controllers | Lógica de orquestração por rota (ex.: `auth.controller.js`, `import.controller.js`, `consent.controller.js`, `fhir-import-staging.controller.js`).
| `api/backend/src/services/*.js` | services | Regras de negócio e integrações (ex.: `patient.service.js`, `sample.service.js`, `rcs-certification.service.js`, `MerkleService.js`, `fhir.service.js`, `consent.service.js`, `mqtt-telemetry.service.js`, `resend`-related services).
| `api/backend/src/models/*.js` | models | Mongoose schemas / modelos (ex.: `Patient.js`, `Sample.js`, `StorageContainer.js`, `Temperature.js`, `PatientConsent.js`, `ImportJob.js`, `fhir/*.fhir.model.js`).
| `api/backend/src/infrastructure/middleware/*.js` | middleware | Autenticação/authorization/consent/audit/rbac (ex.: `auth.js`, `authConsent.js`, `rbac.js`, `audit.middleware.js`).
| `api/backend/src/database/mongo.js` | config/db | Conexão MongoDB.
| `api/backend/src/database/neo4j.js` | config/db | Conexão Neo4j.
| `api/backend/config/env.js` | config | Carrega variáveis de ambiente e defaults.
| `api/backend/scripts/*.js` | scripts/seeds | Seeds, migrações e utilitários (ex.: `seed-synthea.js`, `import-orphanet.js`, `import-hpo.js`, `sync-collections.js`, `migrate-rcs-governance-indexes.js`).
| `api/backend/src/workers/` | workers | Processamento assíncrono para IoT/telemetria/consent/batches (ex.: `worker.js`, `temperature-worker.js`, `sample-worker.js`).
| `api/backend/tests/unit/*` | test | Testes unitários (módulos de middleware, serviços, models, Merkle, etc.).
| `api/backend/tests/integration/*` | test | Testes de integração cobrindo endpoints e fluxos principais (patients, samples, auth, import, consent, compliance).

Observação: rotas e controllers relacionados a importação FHIR (`import.controller.js`, `fhir-import-staging.controller.js`), TCLE/e-consent (`consent.*`), e RCS-GOV (`rcs-certification.service.js`, `rcs-reference-data.js`) estão presentes e ativos.

## 5. Frontend
Tabela representativa de views, components, serviços e hooks.

| Item | Tipo | Finalidade resumida |
|---|---:|---|
| `frontend/src/views/*` | views/pages | Páginas/rotas principais (ex.: `Dashboard.tsx`, `PatientsPage.tsx`, `SamplesPage.tsx`, `SampleDetailsPage.tsx`, `ConsentPage.tsx`, `TcleBuilderPage.tsx`, `ImportPage.tsx`, `ReportsPage.tsx`, `UserSecurityPage.tsx`).
| `frontend/src/components/*` | components | Componentes reutilizáveis (ex.: `ConsentForm.tsx`, `AssinaturaDigitalTCLE.jsx`, `BarcodeLabel.tsx`, `CryoLabelPrinter.tsx`, `StorageHierarchy.tsx`, `ClinicalIntakeWizard.jsx`).
| `frontend/src/api/*.ts|js` | services/api | Clientes API e adaptadores (ex.: `client.ts`, `import.service.ts`, `intake.service.js`).
| `frontend/src/contexts/*` | contexts/hooks | Contextos para auth e i18n (ex.: `AuthContext.tsx`, `LanguageContext.tsx`).
| `frontend/tests` & `frontend/e2e` | testes E2E | Playwright tests; `test:e2e` e `test:vm` scripts em `package.json`.

Finalidade: UI para operar módulos críticos — consentimento, intake wizard, gerenciamento de pacientes/amostras, inventário de armazenamento, relatórios e auditoria.

## 6. Módulos funcionais
- Autenticação
- Pacientes
- Amostras (Sample management)
- Intake Wizard (fluxo de entrada/registro)
- RCS-GOV (governance / certificação)
- Importação FHIR (importadores e staging)
- TCLE / e-consent (assinaturas digitais e reenvio)
- Segurança / RBAC
- Auditoria / logs / Merkle (integridade)
- Storage (containers, boxes, armazenamento físico)
- Sensores / IoT (telemetria, temperatura)
- Temperatura / incidentes térmicos
- Incidentes / alerts
- Relatórios / compliance
- Backup / scripts de seed e restore
- Terminologias / Orphadata / HPO
- Merkle / integridade dos biomarcadores
- Mongo→Neo4j sync (scripts e serviços)
- Resend (integração externa de email)

## 7. Infraestrutura Docker
Serviços declarados em `docker-compose.yml`:
- `mongodb` (mongo:7) — armazenamento primário (dados aplicacionais).
- `neo4j` (neo4j:5-community) — grafo para relações/lineage.
- `influxdb` (influxdb:2.7) — telemetria e séries temporais.
- `redis` (redis:7-alpine) — caching / filas (BullMQ/ioredis).
- `backend` — container do backend (build: `api/backend`, expõe 3000).
- `frontend` — container do frontend (build: `frontend`, expõe 5173).

Observação: não listar senhas ou valores de variáveis de ambiente reais; envs são fornecidos via `.env.docker` em tempo de execução (exemplo em `.env.docker.example`).

## 8. Variáveis de ambiente documentadas (a partir de `.env.docker.example`)
As variáveis abaixo foram extraídas apenas de `.env.docker.example` e agrupadas por responsabilidade.

- App / runtime:
  - `NODE_ENV`, `PORT`, `FRONTEND_URL`, `API_URL`, `APP_DOMAIN`

- Auth / security:
  - `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`, `ENCRYPTION_KEY_ID`, `USER_ANON_SALT`, `TRUST_PROXY`

- MongoDB:
  - `MONGO_ROOT_USERNAME`, `MONGO_ROOT_PASSWORD`, `MONGO_DB`, `MONGO_DB_NOVO`, `MONGO_URI`

- Neo4j:
  - `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, `NEO4J_DATABASE`, `NEO4J_REQUIRED`, `LINEAGE_MODE`, `NEO4J_CONNECT_MAX_RETRIES`, `NEO4J_CONNECT_INITIAL_DELAY_MS`, `NEO4J_CONNECT_MAX_DELAY_MS`

- Redis:
  - `REDIS_HOST`, `REDIS_PORT`, `REDIS_URL`, `REDIS_TLS`

- InfluxDB:
  - `INFLUXDB_INIT_USERNAME`, `INFLUXDB_INIT_PASSWORD`, `INFLUXDB_ORG`, `INFLUXDB_BUCKET`, `INFLUXDB_TOKEN`, `INFLUXDB_URL`

- Resend / Email:
  - `RESEND_API_KEY`, `EMAIL_FROM`, `ALERT_EMAIL_TO`

- CORS / Frontend:
  - `ALLOWED_ORIGINS`, `CORS_ALLOW_ALL`, `VITE_API_BASE_URL`, `VITE_HMR_HOST`, `VITE_HMR_PROTOCOL`, `VITE_HMR_CLIENT_PORT`

- MQTT / Telemetry / IoT:
  - `MQTT_ENABLED`, `MQTT_URL`, `MQTT_TLS_ENABLED`, `WATCHPACK_POLLING`

- Feature flags / sync / import:
  - `ALLOW_CLOUD_INTEGRATIONS`, `ALLOW_EXTERNAL_TERMINOLOGY_SYNC`, `ALLOW_EXTERNAL_HPO_LOOKUP`, `ALLOW_EXTERNAL_DRUG_LOOKUP`

Observação: não foram lidos `.env` reais; somente o arquivo de exemplo. Não copiar valores sensíveis.

## 9. Testes existentes
- Backend unit tests: `api/backend/tests/unit/` (ex.: `authConsent.test.js`, `merkle*.test.js`, `sample.models.test.js`).
- Backend integration tests: `api/backend/tests/integration/` (ex.: `patients.api.test.js`, `fhir-import.test.js`, `consent-integration.test.js`).
- Frontend E2E: Playwright tests referenciados em `frontend/package.json` / `frontend/tests` (`test:e2e`, `test:vm`).
- Deploy / smoke: existem testes de smoke/VM em `frontend/tests/deploy/vm-smoke.spec.ts` (script `test:vm`).

Comandos recomendados (local, sem alterar código):
 - Backend (local): `npm --prefix api/backend run dev` ou `npm --prefix api/backend start`
 - Frontend (local): `npm --prefix frontend run dev`
 - Frontend VM smoke (Playwright): `npm --prefix frontend run test:vm`

## 10. Status pós-INPI
- Tag protegida: `v1.0.0-inpi-rcs-gov` (imutável conforme solicitado).
- Branch de evolução: `deploy/google-vm-post-inpi` (branch atual do inventário).
- URL frontend VM: http://34.60.170.17:5173
- URL backend VM: http://34.60.170.17:3000
- Observação: não alterar ZIP/hash/tag do INPI.

## 11. Itens opcionais / desabilitados por padrão
- `MQTT_ENABLED=false` (padrão no exemplo, habilitar somente com broker configurado).
- `ENABLE_CONSENT_SYNC` (pode existir/ser usado; controlar conforme ambiente: true/false conforme necessidade).
- `CORS_ALLOW_ALL=false` recomendado para produção (usar `ALLOWED_ORIGINS`).
- Integrações externas em `.env.docker.example` permanecem desabilitadas por padrão — exceção: `RESEND` documentado como integração permitida.

## 12. Pendências técnicas observáveis
- Nenhum TODO explícito crítico encontrado no escopo superficial. Arquivos de teste e scripts indicam áreas de manutenção contínua (importadores FHIR, migrações RCS, Merkle tests). Não foram inventariadas pendências não confirmadas por código ou issues.

---
Inventário gerado automaticamente (resumo) com base em arquivos versionados e exemplos de ambiente. Não foram abertos arquivos de `.env` reais nem valores secretos.
