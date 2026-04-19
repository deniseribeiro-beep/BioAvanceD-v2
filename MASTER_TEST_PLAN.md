# MASTER TEST PLAN - BioAvanceD v2

Fonte: varredura direta dos arquivos fisicos do projeto (frontend + backend + models).
Escopo: modulos reais encontrados em `frontend/src`, `backend/src/interface/routes`, `backend/src/routes`, `backend/src/services`, `backend/src/models`.

---

## 📦 Autenticacao e Sessoes
Arquivos Analisados: frontend/src/views/LoginPage.tsx; frontend/src/views/MFASetupPage.tsx; frontend/src/views/ResetPasswordPage.tsx; frontend/src/services/api.ts; backend/src/interface/routes/auth.routes.js; backend/src/infrastructure/middleware/auth.js; backend/src/services/session.service.js; backend/src/models/Session.js; backend/src/models/User.js

Arquitetura & Regras:

Telas/Acoes:
- Login (`/login`): autenticar com usuario/email + senha + possivel `twoFactorCode`.
- MFA Setup (`/mfa-setup`, `/security/mfa-setup`): gerar QR e habilitar MFA.
- Reset de senha (`/reset-password`): solicitar e concluir reset.
- Sessoes de usuario: listar, revogar sessao especifica, revogar todas as outras.

Endpoints:
- POST /api/auth/login
- POST /api/auth/register
- POST /api/auth/change-password
- GET /api/auth/two-factor/qr
- POST /api/auth/two-factor/enable
- POST /api/auth/two-factor/disable
- GET /api/auth/two-factor/status
- POST /api/auth/keepalive
- POST /api/auth/logout
- GET /api/auth/verify
- GET /api/auth/sessions
- DELETE /api/auth/sessions/all-others
- DELETE /api/auth/sessions/:sessionId
- POST /api/auth/refresh
- POST /api/auth/password-reset/request
- POST /api/auth/password-reset/reset
- POST /api/auth/two-factor/qr-first-login
- POST /api/auth/two-factor/enable-first-login
- POST /api/auth/mfa/setup
- POST /api/auth/mfa/enable

Modelos de Banco de Dados:
- backend/src/models/User.js
- backend/src/models/Session.js

Validacoes Criticas:
- `authenticate` exige header `Bearer` e valida JWT.
- `authenticate` verifica sessao ativa em banco via `session.service` (exceto rotas especificas de MFA setup e keepalive).
- Bloqueio com 401 para sessao expirada/revogada/invalida.
- Rate limit global e de auth no `backend/app.js`.
- Refresh token via cookie HTTP-only em `/api/auth`.

Regras de Negocio Inegociaveis:
- Primeiro acesso com `mfaSetupRequired` bloqueia recursos fora do fluxo de setup (403 com `requiresMFASetup`).
- Sessao inativa ou revogada invalida requisicoes mesmo com JWT ainda nao expirado.
- `refresh` exige refresh token valido + sessao associada ao refresh hash.

Checklist de Cobertura de Testes:
- [x] Testes Unitarios de Regra de Negocio/Model (Backend)
- [x] Testes de Integracao de Endpoints (Backend)
- [x] Testes E2E de Fluxo Critico (Frontend/Playwright)

---

## 📦 Usuarios e Controle de Acesso (RBAC)
Arquivos Analisados: frontend/src/views/SystemManagementPage.tsx; frontend/src/views/NewUserPage.tsx; frontend/src/views/NewUserSuccessPage.tsx; frontend/src/views/UserSecurityPage.tsx; frontend/src/services/api.ts; backend/src/interface/routes/user.routes.js; backend/src/interface/routes/access.routes.js; backend/src/interface/routes/user-security.routes.js; backend/src/infrastructure/middleware/rbac.js; backend/src/models/User.js; backend/src/models/Access.js

Arquitetura & Regras:

Telas/Acoes:
- Gestao de usuarios (`/system-management?tab=users`): listar, editar, excluir, reset MFA, disable MFA (admin para admin).
- Cadastro de usuario (`/users/new`).
- Seguranca do usuario (`/user/security`).

Endpoints:
- POST /api/users/register
- GET /api/users
- GET /api/users/:id
- PUT /api/users/:id
- DELETE /api/users/:id
- GET /api/users/:id/validate-status
- POST /api/users/register-patient
- POST /api/users/register-sample
- POST /api/users/record-withdrawal
- POST /api/users/generate-report
- POST /api/users/register-sensor
- GET /api/users/logs
- POST /api/users/:id/reset-mfa
- POST /api/users/:id/disable-mfa
- GET /api/access
- GET /api/access/:id
- POST /api/access
- PUT /api/access/:id
- DELETE /api/access/:id
- GET /api/user/security/status
- GET /api/user/security/mfa
- GET /api/user/security/password
- GET /api/user/security/sessions
- GET /api/user/security/activities
- PUT /api/user/security/password
- POST /api/user/security/recovery-codes
- DELETE /api/user/security/sessions/:id
- DELETE /api/user/security/sessions
- POST /api/user/security/password-reset/request

Modelos de Banco de Dados:
- backend/src/models/User.js
- backend/src/models/Access.js

Validacoes Criticas:
- `requirePermission('createUser')` protege criacao/edicao/exclusao de usuarios e access.
- `UserModel.validate` no update/cadastro (email, username, senha quando aplicavel, accessType etc).
- Normalizacao de status/telefone/institution em `user.routes.js`.
- `rbac.permissions` define papeis permitidos por funcionalidade.

Regras de Negocio Inegociaveis:
- Mapeamento de papeis em `rbac.js`: 1 externo, 2 tecnico, 3 coordenador, 4 administrador.
- Reset MFA em `users/:id/reset-mfa` so para alvo nao admin.
- Disable MFA em `users/:id/disable-mfa` so para alvo admin (acao executada por admin).

Checklist de Cobertura de Testes:
- [x] Testes Unitarios de Regra de Negocio/Model (Backend)
- [x] Testes de Integracao de Endpoints (Backend)
- [x] Testes E2E de Fluxo Critico (Frontend/Playwright)

---

## 📦 Seguranca Administrativa
Arquivos Analisados: frontend/src/views/SecurityPage.tsx; frontend/src/services/api.ts; backend/src/interface/routes/security.routes.js; backend/src/services/security.service.js; backend/src/services/notification.service.js

Arquitetura & Regras:

Telas/Acoes:
- Aba de seguranca no gerenciamento do sistema.
- Atualizar configuracoes de seguranca.
- Atualizar permissoes por perfil.
- Exportar logs de seguranca.
- Consultar fila de notificacoes de consentimento.

Endpoints:
- GET /api/security/config
- PUT /api/security/config
- GET /api/security/logs/export
- GET /api/security/permissions
- PUT /api/security/permissions
- GET /api/security/consent-queue

Modelos de Banco de Dados:
- Nao ha model unico dedicado neste arquivo de rota (usa servicos/configuracoes).

Validacoes Criticas:
- `router.use(authenticate)` e `router.use(requireRole(4))` em toda rota de seguranca.

Regras de Negocio Inegociaveis:
- Somente administrador acessa `/api/security/*`.
- Export em CSV/JSON com filtros no endpoint de logs.

Checklist de Cobertura de Testes:
- [x] Testes Unitarios de Regra de Negocio/Model (Backend)
- [x] Testes de Integracao de Endpoints (Backend)
- [x] Testes E2E de Fluxo Critico (Frontend/Playwright)

---

## 📦 Pacientes e Observacoes de Biomarcadores
Arquivos Analisados: frontend/src/views/PatientsPage.tsx; frontend/src/services/api.ts; backend/src/interface/routes/patient.routes.js; backend/src/controllers/paciente.controller.js; backend/src/services/patient.service.js; backend/src/models/Patient.js; backend/src/models/BiomarkerObservation.js

Arquitetura & Regras:

Telas/Acoes:
- Lista e busca de pacientes (`/patients`).
- Visualizar paciente por ID.
- Atualizar/excluir paciente.
- Reenviar notificacao de consentimento.
- Consultar e criar observacoes biomarcadoras do paciente.

Endpoints:
- POST /api/patients
- GET /api/patients
- GET /api/patients/search
- GET /api/patients/:id
- PUT /api/patients/:id
- DELETE /api/patients/:id
- POST /api/patients/validate-id
- POST /api/patients/find-for-edit
- GET /api/patients/operational
- GET /api/patients/:patientId/consent
- POST /api/patients/:id/consent/resend
- GET /api/patients/:id/observations
- POST /api/patients/:id/observations
- (alias de montagem) mesmos endpoints tambem em /api/v1/patients

Modelos de Banco de Dados:
- backend/src/models/Patient.js
- backend/src/models/BiomarkerObservation.js

Validacoes Criticas:
- `requirePermission('createPatient')` em escrita.
- Regra para falecido: exige representante (nome, email, cpf/documento, telefone) no controller/service.
- `PatientModel.validate` e validacoes adicionais no service (consentTemplateId obrigatorio e valido).
- Deteccao de duplicidade por identificadores e por combinacao nome + nascimento.
- LGPD: modulo operacional retorna dados reduzidos sem dados sensiveis.

Regras de Negocio Inegociaveis:
- `patientID` e gerado automaticamente (8 digitos) no create.
- Paciente novo sai com status `PENDING_CONSENT` e token de consentimento.
- Atualizacao de paciente dispara sincronizacao biomarcadores e observacoes derivadas.

Checklist de Cobertura de Testes:
- [x] Testes Unitarios de Regra de Negocio/Model (Backend)
- [x] Testes de Integracao de Endpoints (Backend)
- [x] Testes E2E de Fluxo Critico (Frontend/Playwright)

---

## 📦 Consentimento, TCLE e e-Consent
Arquivos Analisados: frontend/src/views/ConsentPage.tsx; frontend/src/views/TcleBuilderPage.tsx; frontend/src/pages/patient/EConsentPage.tsx; frontend/src/pages/patient/EConsentLinkPanel.tsx; frontend/src/services/api.ts; backend/src/routes/eConsent.js; backend/src/controllers/consent.controller.js; backend/src/services/consent.validator.js; backend/src/infrastructure/middleware/consent.enforcement.js; backend/src/models/PatientConsent.js; backend/src/models/ConsentTemplate.js; backend/src/models/ConsentPolicy.js; backend/src/models/fhir/Consent.fhir.model.js

Arquitetura & Regras:

Telas/Acoes:
- Builder de TCLE (`/admin/tcle/new`, `/admin/tcle/edit/:templateId`).
- Tela de consentimento por paciente (`/patients/:id/consent`).
- Fluxo publico de e-consent via token (`/patient/e-consent/:token`).

Endpoints:
- POST /api/e-consent/generate-link
- GET /api/e-consent/validate/:token
- POST /api/e-consent/update
- GET /api/e-consent/consent-policies/:id/pending-patients
- POST /api/e-consent/consent-templates
- GET /api/e-consent/consent-templates
- GET /api/e-consent/consent-templates/current
- GET /api/e-consent/consent-templates/active
- GET /api/e-consent/consent-templates/:id
- PUT /api/e-consent/consent-templates/:id
- POST /api/e-consent/consent-policies
- PUT /api/e-consent/consent-policies/:id
- GET /api/e-consent/consent-policies/active
- GET /api/e-consent/consent-policies/active-with-caae
- GET /api/e-consent/consent-policies/history
- GET /api/e-consent/consent-policies
- POST /api/e-consent/consents
- POST /api/e-consent/consents/:id/revoke
- POST /api/e-consent/consent-tokens/validate
- POST /api/e-consent/consent-tokens/accept

Modelos de Banco de Dados:
- backend/src/models/PatientConsent.js
- backend/src/models/ConsentTemplate.js
- backend/src/models/ConsentPolicy.js
- backend/src/models/fhir/Consent.fhir.model.js

Validacoes Criticas:
- `CONSENT_SECRET` obrigatorio no bootstrap da rota `eConsent.js`.
- `consentValidator.validateAccess(sampleId, scope)` usado para bloqueio por escopo.
- `enforceCommercialConsent` retorna 403 se escopo nao autorizado.
- `requireRole` em endpoints de templates/policies conforme rota.

Regras de Negocio Inegociaveis:
- Revogacao no endpoint `/update` coloca amostras relacionadas em `QUARANTINED` (Neo4j e Mongo).
- Quando todos consentimentos necessarios estao ativos, amostras quarentenadas voltam para `AVAILABLE`.
- Links de e-consent usam JWT com expiracao (2h em `eConsent.js`).

Checklist de Cobertura de Testes:
- [x] Testes Unitarios de Regra de Negocio/Model (Backend)
- [x] Testes de Integracao de Endpoints (Backend)
- [x] Testes E2E de Fluxo Critico (Frontend/Playwright)

---

## 📦 Intake Wizard (Cadastro Integrado)
Arquivos Analisados: frontend/src/pages/v2/intake/IntakeWizardPage.tsx; frontend/src/components/v2/intake/ClinicalIntakeWizard.jsx; frontend/src/foundation/FoundationApp.tsx; frontend/src/api/intake.service.js; backend/src/interface/routes/intakeWizard.routes.js; backend/src/routes/intakeWizard.js

Arquitetura & Regras:

Telas/Acoes:
- Wizard integrado em `/next/intake` (tambem dentro de `/next/*`).
- Busca de match de paciente antes de upsert.
- Submissao integrada de dados clinicos + amostra + consentimento.

Endpoints:
- GET /api/intake-wizard/patient-match
- POST /api/intake-wizard/
- POST /api/intake-wizard/intake-wizard

Modelos de Banco de Dados:
- Reuso de Patient, Sample e Consent (sem model exclusivo de wizard).

Validacoes Criticas:
- `patient-match` exige `patientID` ou combinacao `patientName + birthDate`.
- Falha de DB retorna 503.
- Fluxo principal retorna 502 quando envio de TCLE por email falha (cadastro nao finalizado).

Regras de Negocio Inegociaveis:
- Heuristica de match vincula novos dados ao paciente existente quando encontrado.
- Endpoint principal sinaliza sucesso com envio de TCLE e dados de match.

Checklist de Cobertura de Testes:
- [x] Testes Unitarios de Regra de Negocio/Model (Backend)
- [x] Testes de Integracao de Endpoints (Backend)
- [x] Testes E2E de Fluxo Critico (Frontend/Playwright)

---

## 📦 Amostras, Movimentacao, Retirada/Devolucao e Arquivos
Arquivos Analisados: frontend/src/views/SamplesPage.tsx; frontend/src/views/SampleDetailsPage.tsx; frontend/src/views/SampleMovementsPage.tsx; frontend/src/views/SampleWithdrawalReturnPage.tsx; frontend/src/views/SampleLabelPage.tsx; frontend/src/views/SampleChainPage.tsx; frontend/src/views/SampleCustodyReportsPage.tsx; frontend/src/services/api.ts; frontend/src/services/sampleChainApi.ts; backend/src/interface/routes/sample.routes.js; backend/src/services/sample.service.js; backend/src/controllers/sample-file.controller.js; backend/src/models/Sample.js; backend/src/models/SampleMovement.js; backend/src/models/SampleFile.js; backend/src/models/Withdrawal.js

Arquitetura & Regras:

Telas/Acoes:
- Listar, detalhar, editar e excluir amostra.
- Buscar por barcode e por termo.
- Registrar retirada e devolucao.
- Consultar historico de movimentacoes.
- Upload/lista/download/delete de arquivos de amostra.
- Export HL7/FHIR/CDA por arquivo.

Endpoints:
- GET /api/samples/:id/miabis-compliance
- GET /api/samples/:id/compliance-graph
- POST /api/samples
- GET /api/samples
- GET /api/samples/:id
- PUT /api/samples/:id
- DELETE /api/samples/:id
- POST /api/samples/:id/withdraw
- POST /api/samples/:id/return
- GET /api/samples/search/by-term
- GET /api/samples/by-barcode/:barcode
- GET /api/samples/by-barcode/:barcode/symbology-assets
- GET /api/samples/:id/results
- GET /api/samples/:id/movements
- POST /api/samples/:sampleID/files/upload
- GET /api/samples/:sampleID/files
- GET /api/samples/:sampleID/files/:fileID/download
- DELETE /api/samples/:sampleID/files/:fileID
- GET /api/samples/:sampleID/files/:fileID/export/hl7
- GET /api/samples/:sampleID/files/:fileID/export/fhir
- GET /api/samples/:sampleID/files/:fileID/export/cda

Modelos de Banco de Dados:
- backend/src/models/Sample.js
- backend/src/models/SampleMovement.js
- backend/src/models/SampleFile.js
- backend/src/models/Withdrawal.js
- backend/src/models/SampleType.js
- backend/src/models/SampleOrigin.js
- backend/src/models/ExtractionProtocol.js
- backend/src/models/fhir/Sample.fhir.model.js

Validacoes Criticas:
- `validateCreateSamplePayload` (patientID 8 digitos, sampleType/origin/extraction conforme constantes MIABIS, quantidade > 0, quality valida, linkedProject obrigatorio, registerDate obrigatorio).
- `requirePermission('createSample'|'editSample'|'deleteSample'|'withdrawSample'|'uploadSampleFiles'|'deleteSampleFiles')`.
- `consentValidator.validateAccess` em retirada e `enforceCommercialConsent` em exports e resultados comerciais.
- `SampleModel.validate*` e regras de status/lifecycle no service.

Regras de Negocio Inegociaveis:
- Nao permitir retirada quando status em `TotallyWithdrawn|Destroyed|Unusable|Expired`.
- Retirada parcial nao pode exceder quantidade disponivel.
- Devolucao so permitida com quantidade pendente; condicao obrigatoria; observacao obrigatoria quando condicao != `Integra`.
- Cadeia de custodia em ledger imutavel com hash chain (`appendMovementWithHashChain`).
- Alocacao fisica detalhada bloqueia conflito de posicao ocupada (409).
- Barcode e sampleID unicos (geracao automatica quando ausentes).

Checklist de Cobertura de Testes:
- [x] Testes Unitarios de Regra de Negocio/Model (Backend)
- [x] Testes de Integracao de Endpoints (Backend)
- [x] Testes E2E de Fluxo Critico (Frontend/Playwright)

---

## 📦 Storage / Inventario Fisico
Arquivos Analisados: frontend/src/views/SampleInventory.tsx; frontend/src/components/CryoBoxGrid.tsx; frontend/src/components/SampleLocator.tsx; frontend/src/services/storageApi.ts; backend/src/interface/routes/storage.routes.js; backend/src/interface/controllers/allocate-sample.controller.js; backend/src/interface/controllers/auto-assign-sample.controller.js; backend/src/interface/controllers/release-sample.controller.js; backend/src/interface/controllers/move-sample.controller.js; backend/src/interface/controllers/storage-query.controller.js; backend/src/services/StorageAllocationService.ts; backend/src/models/StorageContainer.js; backend/src/models/StorageBox.js; backend/src/models/StoragePath.js

Arquitetura & Regras:

Telas/Acoes:
- Navegacao da arvore de armazenamento.
- Buscar amostras para alocar.
- Alocar manual e automatico.
- Mover e liberar amostras.
- Verificar posicoes disponiveis e integridade da caixa.

Endpoints:
- GET /api/storage/freezers
- GET /api/storage/samples/search
- POST /api/storage/allocate
- POST /api/storage/allocate/auto
- POST /api/storage/move
- DELETE /api/storage/release/:sampleId
- GET /api/storage/sample/:sampleId
- GET /api/storage/box/:boxId/available
- GET /api/storage/validate/:boxId/:position
- GET /api/storage/freezer/:freezerId/stats
- GET /api/storage/box/:boxId/integrity
- GET /api/storage/freezer/:freezerId/tree

Modelos de Banco de Dados:
- backend/src/models/StorageContainer.js
- backend/src/models/StorageBox.js
- backend/src/models/StoragePath.js

Validacoes Criticas:
- `router.use(authenticate)` em todo modulo storage.
- Colisao de posicao reportada como 409 nos endpoints de alocacao/validacao.
- Validacoes de capacidade e posicao via controllers/modelos de box.

Regras de Negocio Inegociaveis:
- Filtro de busca para alocacao considera amostras disponiveis e sem alocacao efetiva.
- Auto-assign busca primeira posicao livre elegivel.
- `StorageAllocationService.ts` escolhe tipo de equipamento por tipo de amostra e registra posicao em Neo4j + Mongo.

Checklist de Cobertura de Testes:
- [x] Testes Unitarios de Regra de Negocio/Model (Backend)
- [x] Testes de Integracao de Endpoints (Backend)
- [x] Testes E2E de Fluxo Critico (Frontend/Playwright)

---

## 📦 Resultados e Arquivos de Analise
Arquivos Analisados: frontend/src/views/ResultsPage.tsx; frontend/src/components/AnalysisUpload.jsx; frontend/src/services/api.ts; backend/src/interface/routes/result.routes.js; backend/src/interface/routes/analysis-file.routes.js; backend/src/interface/routes/analysis-type.routes.js; backend/src/controllers/upload.controller.js; backend/src/services/analysisValidation.service.js; backend/src/models/Result.js; backend/src/models/AnalysisType.js; backend/src/models/SampleFile.js

Arquitetura & Regras:

Telas/Acoes:
- Listar resultados, criar/atualizar/excluir, vincular resultado a amostra.
- Upload de arquivo de resultado.
- Validar elegibilidade de upload por amostra.
- Gerenciar tipos de analise.

Endpoints:
- GET /api/results
- POST /api/results/upload
- GET /api/results/:id
- GET /api/results/:id/download
- POST /api/results
- PUT /api/results/:id
- PUT /api/results/:id/link-sample
- DELETE /api/results/:id
- GET /api/analysis-files/validate/:sampleIdentifier
- POST /api/analysis-files/upload
- GET /api/analysis-types
- POST /api/analysis-types

Modelos de Banco de Dados:
- backend/src/models/Result.js
- backend/src/models/AnalysisType.js
- backend/src/models/SampleFile.js

Validacoes Criticas:
- `analysisValidationService.validateUploadEligibility` bloqueia quando amostra nao existe ou consentimento pendente (409 para consent pendente).
- `enforceCommercialConsent` em rotas de resultado comercial.
- `ResultModel.validate` e enum de `fileType`.

Regras de Negocio Inegociaveis:
- Upload de analise depende de elegibilidade por amostra/consentimento.
- Download de resultado trata redirecionamento/erro de conteudo no frontend.
- Criacao de `analysis-type` exige `requireRole(4)`.

Checklist de Cobertura de Testes:
- [x] Testes Unitarios de Regra de Negocio/Model (Backend)
- [x] Testes de Integracao de Endpoints (Backend)
- [x] Testes E2E de Fluxo Critico (Frontend/Playwright)

---

## 📦 Importacao de Dados (Batch, Async, FHIR, LGPD)
Arquivos Analisados: frontend/src/views/ImportPage.tsx; frontend/src/components/v2/ImportForm.jsx; frontend/src/components/v2/BatchProgressViewer.jsx; frontend/src/services/api.ts; frontend/src/api/import.service.ts; backend/src/interface/routes/import.routes.js; backend/src/interface/routes/import-lgpd.routes.js; backend/src/routes/importFhirIntelligent.js; backend/src/controllers/import.controller.js; backend/src/controllers/import-batch.controller.js; backend/src/controllers/import-async.controller.js; backend/src/controllers/import-lgpd.controller.js; backend/src/models/ImportJob.js; backend/src/models/StagingImport.js; backend/src/models/ImportMetrics.js

Arquitetura & Regras:

Telas/Acoes:
- Upload de arquivo para validacao/importacao.
- Criacao e monitoramento de jobs de import.
- Cancelamento e consulta de relatorio de job.
- Import LGPD de pacientes e amostras + templates.

Endpoints:
- POST /api/import/batch
- GET /api/import/batch/:jobId
- GET /api/import/status/:jobId
- POST /api/import/validate
- POST /api/import/import
- POST /api/import/import/samples
- GET /api/import/jobs
- GET /api/import/job/:jobID
- POST /api/import/job/:jobID/cancel
- GET /api/import/job/:jobID/report
- POST /api/import/upload
- POST /api/import/fhir
- POST /api/import/fhir-intelligent
- POST /api/import-lgpd/pacientes
- POST /api/import-lgpd/pacientes/predict-mapping
- POST /api/import-lgpd/pacientes/smart-import
- GET /api/import-lgpd/pacientes/smart-import/reports
- GET /api/import-lgpd/pacientes/smart-import/metadata
- POST /api/import-lgpd/amostras
- GET /api/import-lgpd/pacientes/template/xlsx
- GET /api/import-lgpd/amostras/template/csv
- GET /api/import-lgpd/amostras/template/xlsx

Modelos de Banco de Dados:
- backend/src/models/ImportJob.js
- backend/src/models/StagingImport.js
- backend/src/models/ImportMetrics.js

Validacoes Criticas:
- `authenticate` + `requirePermission('uploadFiles'|'createPatient'|'createSample')` conforme rota.
- Upload middleware dedicado nos controllers de importacao.
- Estados de job no model `StagingImport` (`staged|queued|processing|completed|failed`).

Regras de Negocio Inegociaveis:
- Fluxo async separado em validacao, criacao de job e acompanhamento.
- Import LGPD separa responsabilidades de pacientes e amostras.
- Template download e mapeamento inteligente fazem parte do fluxo oficial LGPD.

Checklist de Cobertura de Testes:
- [x] Testes Unitarios de Regra de Negocio/Model (Backend)
- [x] Testes de Integracao de Endpoints (Backend)
- [x] Testes E2E de Fluxo Critico (Frontend/Playwright)

---

## 📦 Equipamentos, Localizacoes e Unidades Clinicas
Arquivos Analisados: frontend/src/views/FacilityManagementPage.tsx; frontend/src/services/api.ts; backend/src/interface/routes/equipment.routes.js; backend/src/interface/routes/location.routes.js; backend/src/interface/routes/clinical-unit.routes.js; backend/src/models/Equipment.js; backend/src/models/Equipment.schema.js; backend/src/models/Location.js; backend/src/models/ClinicalUnit.js

Arquitetura & Regras:

Telas/Acoes:
- Aba Facility (equipamentos/localizacoes/sensores/politicas/historico/incidentes).
- CRUD de equipamentos e localizacoes.
- Busca de unidade clinica e cadastro de unidade.

Endpoints:
- GET /api/equipment
- GET /api/equipment/analytical
- GET /api/equipment/:id
- POST /api/equipment
- PUT /api/equipment/:id
- DELETE /api/equipment/:id
- PATCH /api/locations/fix-missing-locationids
- GET /api/locations
- GET /api/locations/:id
- POST /api/locations
- PUT /api/locations/:id
- DELETE /api/locations/:id
- GET /api/clinical-units
- GET /api/clinical-units/search
- POST /api/clinical-units

Modelos de Banco de Dados:
- backend/src/models/Equipment.js
- backend/src/models/Equipment.schema.js
- backend/src/models/Location.js
- backend/src/models/ClinicalUnit.js

Validacoes Criticas:
- `EquipmentModel.validate` e `LocationModel.validate` em create.
- `requirePermission('createPatient')` para CRUD de equipamento.
- `requirePermission('createSample')` para CRUD de localizacao e patch de correcao de IDs.
- `ClinicalUnitModel.validate` e indexes por `normalizedName`.

Regras de Negocio Inegociaveis:
- `equipment/analytical` filtra `type='Analytical'` e `status != 'Maintenance'`.
- Geracao automatica de `equipmentID` e `locationID` quando ausentes.
- Endpoint de correcao em massa de `locationID` para registros legados invalidos.

Checklist de Cobertura de Testes:
- [x] Testes Unitarios de Regra de Negocio/Model (Backend)
- [ ] Testes de Integracao de Endpoints (Backend)
- [ ] Testes E2E de Fluxo Critico (Frontend/Playwright)

---

## 📦 Sensores, Temperatura, Politicas, IoT e Incidentes
Arquivos Analisados: frontend/src/views/FacilityManagementPage.tsx; frontend/src/views/IncidentManagementPage.tsx; frontend/src/services/api.ts; backend/src/interface/routes/sensor.routes.js; backend/src/interface/routes/temperature.routes.js; backend/src/interface/routes/policy.routes.js; backend/src/interface/routes/iot.routes.js; backend/src/interface/routes/incident.routes.js; backend/src/controllers/sensor.controller.js; backend/src/controllers/temperature.controller.js; backend/src/controllers/iot.controller.js; backend/src/controllers/incident.controller.js; backend/src/services/sendIncidentAlertEmail.js; backend/src/models/Sensor.js; backend/src/models/Temperature.js; backend/src/models/Policy.js; backend/src/models/TemperatureIncident.js; backend/src/models/TemperaturePolicy.schema.js; backend/src/models/SensorMetadata.schema.js

Arquitetura & Regras:

Telas/Acoes:
- Controle de temperatura e historico de leituras.
- CRUD de sensores e politicas.
- Gerenciamento de incidentes (reconhecer, escalar, resolver, notas).

Endpoints:
- POST /api/sensors
- GET /api/sensors
- GET /api/sensors/:id
- POST /api/sensors/:id/reading
- POST /api/sensors/:id/collect-reading
- PUT /api/sensors/:id
- DELETE /api/sensors/:id
- POST /api/temperature/reading
- POST /api/temperature/system/reading
- GET /api/temperature/history
- GET /api/temperature/alerts
- GET /api/temperature
- GET /api/temperature/:id
- GET /api/temperature/control
- GET /api/policies
- GET /api/policies/:id
- GET /api/policies/:id/active-limit
- POST /api/policies
- PUT /api/policies/:id
- DELETE /api/policies/:id
- POST /api/iot/telemetry
- POST /api/incidents/create
- GET /api/incidents
- PUT /api/incidents/:incidentId/acknowledge
- PUT /api/incidents/:incidentId/resolve
- PUT /api/incidents/:incidentId/escalate
- POST /api/incidents/:incidentId/notes

Modelos de Banco de Dados:
- backend/src/models/Sensor.js
- backend/src/models/SensorMetadata.schema.js
- backend/src/models/Temperature.js
- backend/src/models/Policy.js
- backend/src/models/TemperaturePolicy.schema.js
- backend/src/models/TemperatureIncident.js

Validacoes Criticas:
- `requirePermission('viewTemperature')` em leituras e CRUD de sensor/politica.
- `requirePermission('manageTemperature')` em acknowledge/resolve/escalate de incidente.
- `TemperatureIncidentModel.validate` no create/update de incidente.
- `PolicyModel.validate` em criacao de politica.

Regras de Negocio Inegociaveis:
- `iot.controller` cria/atualiza incidente quando leitura sai do intervalo da politica.
- Incidente aberto do mesmo sensor e agregado (nao cria novo enquanto aberto/ack/escalated).
- Escalonamento aumenta nivel ate maximo 2 (`Math.min(...,2)`).
- Alertas por email para usuarios ativos com `accessType in [2,3,4]`.

Checklist de Cobertura de Testes:
- [x] Testes Unitarios de Regra de Negocio/Model (Backend)
- [x] Testes de Integracao de Endpoints (Backend)
- [x] Testes E2E de Fluxo Critico (Frontend/Playwright)

---

## 📦 Relatorios
Arquivos Analisados: frontend/src/views/ReportsPage.tsx; frontend/src/views/ReportQueryPage.tsx; frontend/src/views/ReportViewPage.tsx; frontend/src/services/api.ts; backend/src/interface/routes/reports.routes.js; backend/src/models/Reports.js

Arquitetura & Regras:

Telas/Acoes:
- Listar relatorios, visualizar relatorio por ID.
- Gerar relatorio por tipo/filtros.
- Preview e export (csv/pdf).

Endpoints:
- GET /api/reports
- GET /api/reports/:id
- POST /api/reports/generate
- DELETE /api/reports/:id
- GET /api/reports/:type/filters
- POST /api/reports/:type/preview
- GET /api/reports/:type/export
- GET /api/reports/:type/export/pdf

Modelos de Banco de Dados:
- backend/src/models/Reports.js

Validacoes Criticas:
- `requirePermission('viewReports')` em todas as rotas.
- `reportType` obrigatorio no generate.

Regras de Negocio Inegociaveis:
- `reportID` sequencial gerado no backend.
- Export CSV gera anexo `text/csv`; PDF atualmente responde estrutura JSON de dados para export.

Checklist de Cobertura de Testes:
- [ ] Testes Unitarios de Regra de Negocio/Model (Backend)
- [ ] Testes de Integracao de Endpoints (Backend)
- [ ] Testes E2E de Fluxo Critico (Frontend/Playwright)

---

## 📦 Logs, Auditoria e Compliance
Arquivos Analisados: frontend/src/views/LogsPage.tsx; frontend/src/views/LogDetailPage.tsx; frontend/src/services/api.ts; backend/src/interface/routes/logs.routes.js; backend/src/interface/routes/audit.routes.js; backend/src/interface/routes/compliance.routes.js; backend/src/services/log.service.js; backend/src/services/complianceReport.service.js; backend/src/models/Log.js

Arquitetura & Regras:

Telas/Acoes:
- Listar logs, query de logs, detalhe de log.
- Exportar logs CSV/XLSX.
- Dashboard/compliance report/alertas de compliance.
- Rotas de auditoria de merkle/verify.

Endpoints:
- GET /api/logs
- GET /api/logs/all
- POST /api/logs/query
- POST /api/logs/register
- GET /api/logs/export/csv
- GET /api/logs/export/xlsx
- GET /api/logs/:id
- GET /api/audit/root/:date
- GET /api/audit/report/:date
- GET /api/audit/compare/:date
- GET /api/audit/hl7/:date
- GET /api/audit/dashboard/dates
- GET /api/audit/dashboard/stats/:date
- GET /api/audit/dashboard/roots
- POST /api/audit/verify
- GET /api/compliance/dashboard
- GET /api/compliance/report
- GET /api/compliance/alerts
- POST /api/compliance/alerts/:id/acknowledge
- POST /api/compliance/alerts/:id/resolve
- GET /api/compliance/scopes
- GET /api/compliance/verify-biomarker/:id

Modelos de Banco de Dados:
- backend/src/models/Log.js
- backend/src/models/Reports.js (utilizado no ecossistema de report/audit)

Validacoes Criticas:
- Logs: `requireAuditReader` (somente Admin/Auditor) + `authenticate`.
- Audit/reports: `requirePermission('viewReports')`.
- Compliance: `requireRole(4)` para rotas sensiveis.

Regras de Negocio Inegociaveis:
- Export de logs padroniza cabecalhos fixos (`timestamp,userName,action,...`).
- Compliance resolve/reconhece alerta com usuario executor.
- Audit expoe verificacao de integridade por data e prova.

Checklist de Cobertura de Testes:
- [ ] Testes Unitarios de Regra de Negocio/Model (Backend)
- [ ] Testes de Integracao de Endpoints (Backend)
- [ ] Testes E2E de Fluxo Critico (Frontend/Playwright)

---

## 📦 Assistente
Arquivos Analisados: frontend/src/views/AssistantPage.tsx; frontend/src/hooks/useAssistant.ts; frontend/src/services/api.ts; backend/src/interface/routes/assistant.routes.js; backend/src/services/assistant.service.js; backend/src/models/IntelligentAssistant.js

Arquitetura & Regras:

Telas/Acoes:
- Perguntas e respostas do assistente.
- Ajuda contextual, tutorial e sugestoes de acao.

Endpoints:
- POST /api/assistant/answer
- POST /api/assistant/consult
- POST /api/assistant/question
- POST /api/assistant/contextual-help
- POST /api/assistant/tutorial
- POST /api/assistant/suggestions
- POST /api/assistant/suggest

Modelos de Banco de Dados:
- backend/src/models/IntelligentAssistant.js

Validacoes Criticas:
- `authenticate` em todas as rotas.
- `question` obrigatorio em `answer/consult/question`.

Regras de Negocio Inegociaveis:
- Sugestoes retornam acao + rota mapeada por contexto.
- Resposta considera `accessType` (role) e idioma.

Checklist de Cobertura de Testes:
- [X] NÃO IMPLEMENTADO NESSA FASE

---

## 📦 Dicionarios e Terminologias (CID, HPO, Orphanet, Medicamentos/ATC)
Arquivos Analisados: frontend/src/views/DataDictionaryPage.tsx; frontend/src/components/HPOAutocomplete.jsx; frontend/src/services/api.ts; backend/src/interface/routes/dictionary.routes.js; backend/src/routes/dictionary.js; backend/src/interface/routes/terminologies.routes.js; backend/src/interface/routes/cid.routes.js; backend/src/routes/hpo.js; backend/src/routes/orphanet.js; backend/src/models/Cid.js; backend/src/models/Terminology.js; backend/src/models/Disease.js; backend/src/models/DrugDictionary.js

Arquitetura & Regras:

Telas/Acoes:
- Busca em dicionarios/terminologias para apoio clinico.
- Busca de CID, HPO, Orphanet e medicamentos/ATC.

Endpoints:
- GET /api/dictionary/atc/search
- GET /api/dictionary/search
- GET /api/dictionary/suggest
- GET /api/dictionary/disease-profile
- GET /api/dictionary/medications/search
- GET /api/terminologies
- POST /api/terminologies/sync
- GET /api/cids
- GET /api/cids/search
- POST /api/cids (retorna method not allowed)
- PUT /api/cids/:id (retorna method not allowed)
- PATCH /api/cids/:id (retorna method not allowed)
- GET /api/hpo/search
- GET /api/hpo/:id
- GET /api/orphanet/search

Modelos de Banco de Dados:
- backend/src/models/Cid.js
- backend/src/models/Terminology.js
- backend/src/models/Disease.js
- backend/src/models/DrugDictionary.js

Validacoes Criticas:
- `cid.routes`: `/api/cids` e mutacoes com `requireRole(4)`.
- `dictionary.js`: exige query em buscas, limites de pagina e filtros.
- HPO/Orphanet retornam 400 em query ausente.

Regras de Negocio Inegociaveis:
- CID em modo somente leitura (POST/PUT/PATCH bloqueados com 405).
- HPO faz fallback para fonte externa quando busca local nao retorna.
- Terminologies pode hidratar por redundancia local e sync remoto.

Checklist de Cobertura de Testes:
- [ ] Testes Unitarios de Regra de Negocio/Model (Backend)
- [ ] Testes de Integracao de Endpoints (Backend)
- [ ] Testes E2E de Fluxo Critico (Frontend/Playwright)

---

## 📦 Backup
Arquivos Analisados: frontend/src/views/BackupPage.tsx; frontend/src/hooks/useBackup.ts; frontend/src/services/api.ts; backend/src/interface/routes/backup.routes.js; backend/src/services/backup.service.js

Arquitetura & Regras:

Telas/Acoes:
- Executar backup manual.
- Listar backups existentes.
- Restaurar backup por nome de arquivo.

Endpoints:
- POST /api/backup/perform
- GET /api/backup/list
- POST /api/backup/restore/:fileName

Modelos de Banco de Dados:
- Nao possui model dedicado (operacao de filesystem + servico de backup).

Validacoes Criticas:
- `authenticate` + `requireRole(4)` em todo modulo.
- Sanitizacao de `fileName` com `path.basename` na restauracao.

Regras de Negocio Inegociaveis:
- Listagem ordenada por criacao decrescente.
- Restore falha com 404 quando pacote de backup nao existe.

Checklist de Cobertura de Testes:
- [ ] Testes Unitarios de Regra de Negocio/Model (Backend)
- [ ] Testes de Integracao de Endpoints (Backend)
- [ ] Testes E2E de Fluxo Critico (Frontend/Playwright)

---

## 📦 Nova Fundacao `/next` (camada de migracao frontend)
Arquivos Analisados: frontend/src/foundation/FoundationApp.tsx; frontend/src/foundation/contracts.ts; frontend/src/pages/v2/intake/IntakeWizardPage.tsx

Arquitetura & Regras:

Telas/Acoes:
- `/next` visao geral.
- `/next/contracts` catalogo de contratos.
- `/next/intake` entrada do wizard de cadastro integrado.

Endpoints:
- Consume endpoints do Intake Wizard (`/api/intake-wizard/*`) e dicionarios utilizados no formulario.

Modelos de Banco de Dados:
- Nao possui model proprio (camada de apresentacao/contratos).

Validacoes Criticas:
- Rotas `next` protegidas para perfis permitidos no `App.tsx`.

Regras de Negocio Inegociaveis:
- Camada coexistente com legado (strangler pattern), sem remover fluxo antigo.

Checklist de Cobertura de Testes:
- [ ] Testes Unitarios de Regra de Negocio/Model (Backend)
- [ ] Testes de Integracao de Endpoints (Backend)
- [ ] Testes E2E de Fluxo Critico (Frontend/Playwright)

---

## Matriz Rapida de Endpoints Montados no `app.js`

Prefixos montados e validados na aplicacao:
- /api/auth
- /api/orphanet
- /api/hpo
- /api/patients
- /api/v1/patients
- /api/samples
- /api/import
- /api/results
- /api/reports
- /api/logs
- /api/audit
- /api/analysis-files
- /api/analysis-types
- /api/equipment
- /api/locations
- /api/clinical-units
- /api/storage
- /api/policies
- /api/sensors
- /api/iot
- /api/temperature
- /api/incidents
- /api/e-consent
- /api/intake-wizard
- /api/terminologies
- /api/users
- /api/access
- /api/security
- /api/user/security
- /api/backup
- /api/assistant
- /api/import-lgpd
- /api/compliance
- /api/cids
- /api/phone-codes
- /api/dictionary

---

## Observacoes de QA para Execucao Exaustiva
- O plano acima foi extraido exclusivamente de arquivos reais do repositorio.
- Onde o frontend nao apresentou tela explicita para um endpoint, o modulo foi marcado como backend-first.
- Priorizar cenarios de falha para: permissao RBAC, consentimento, sessao expirada, colisoes de storage, e workflow de incidentes.
