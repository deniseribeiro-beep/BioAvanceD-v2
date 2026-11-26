# User guide: Coordenador

Part of the per-role user guides (RNF006 C1, #1325); see [README.md](README.md) for the role model. Route files below are under `api/backend/src/interface/routes/` unless a path says otherwise.

## Who this is

- **Seed row** (`api/backend/src/services/rbac-catalog-seed.service.js`): roleName `Coordenador`, roleCode `coordinator`, display name Coordenador, hierarchyLevel 3.
- **After sign-in** you land on `/reports` (`getPostLoginRoute` in `frontend/src/utils/rolePermissions.ts`).
- **Organization scope:** you must hold an organization. Without one, every route gated by `requireOrganizationScope` (`api/backend/src/infrastructure/middleware/rbac.js`) answers 403, and so do the report routes, which check the scope inline (`reports.routes.js`).

## Screens

The screens the Técnico also opens are summarised; where the flow is the same, [tecnico.md](tecnico.md) describes it. The Coordenador additionally passes the gates the Técnico is refused (`createPatient`, `editSample`, `uploadSampleFiles`, `deleteSampleFiles`, `manageStorageTopology`, `requireRole(3, 4)`), and is refused what only the Administrador may do (see [administrador.md](administrador.md)).

| Screen (pt-BR label) | Route | What you can do here | Backend gate |
|---|---|---|---|
| Central de Relatórios | `/reports` | Open the report catalogue and choose a report. The catalogue of `/reports` lists every report type (`hasReportAccess` in `frontend/src/contexts/AuthContext.tsx` is true for accessType 3). Report types that read the audit trail (`accessLogs`, `auditEvents`) are refused by the backend (403) unless the additive auditor role is also granted. | `requirePermission('viewReports')` (`reports.routes.js`); `requirePermission('viewReports')` (`reportTemplates.routes.js`) |
| (the report type's name) | `/reports/query/:type` | Filter, preview and export a report as CSV or PDF. Export is refused (403) while data export is disabled in the LGPD configuration. | `requirePermission('viewReports')`, `requireDataExportAllowed` for export (`reports.routes.js`) |
| (the report's name) | `/reports/:id` | Read a generated report and delete it. | `requirePermission('viewReports')`, `requireRole(3, 4)` to delete (`reports.routes.js`) |
| Modelos de Relatório | `/reports/templates` | List report templates; create, edit and delete them. | `requirePermission('viewReports')`, `requirePermission('manageReportTemplates')` (`reportTemplates.routes.js`) |
| Dashboard | `/dashboard` | The cards `DASHBOARD_CARDS` gives the Coordenador (`frontend/src/views/dashboardCards.ts`): the Técnico's six, as described in [tecnico.md](tecnico.md) (Pacientes, Amostras, Relatórios de Custódia, Armazenamento, Arquivos de Análise, Alertas de Temperatura), then Relatórios de Governança, which counts the saved reports and opens `/reports`. The Armazenamento card opens `/locations`, which redirects to Gerenciamento de Instalações. The consent queue card is the Administrador's. | `requireOrganizationScope` (`patient.routes.js`, `sample.routes.js`, `result.routes.js`); `requirePermission('viewTemperature')` (`incident.routes.js`); `requirePermission('viewReports')` (`reports.routes.js`) |
| Novo Cadastro | `/next/intake` | Register a participant and their samples through the intake wizard. `/pacientes/novo-atendimento` redirects here. | `requirePermission('createSample')`, `requireOrganizationScope` (`intakeWizard.routes.js`) |
| Diretório de Pacientes | `/patients` | The list shows the participant id, the record number, the birth date as a calendar day and the consent badge, and refreshes that badge while the page stays open. Name, document, email and phone stay off the list. Create, edit and delete a participant, collect an in-person signature (the place of collection is required) and send the TCLE by email while no consent is in force. | `requireOrganizationScope`, `requirePermission('createPatient')` (`patient.routes.js`) |
| Importação Inteligente de Dados FHIR | `/patients/import-fhir` | Stage, validate and commit a FHIR bundle, and send its consent invitations. `/import/fhir` redirects here. | `requirePermission('uploadFiles')`, `requireOrganizationScope` (`import.routes.js`) |
| Consentimentos (TCLE) | `/consents` | Read a participant's consent, its revocation (time, channel, scope and place) and its messages. Open or download the signed term when a file is stored. The page refreshes that state while it stays open. The TCLE email opens the participant panel at `/patients/:participantId/consent`. | `requireOrganizationScope` (`patient.routes.js`); `requireRole(3, 4)` (`api/backend/src/routes/eConsent.js`) |
| Construtor de TCLE | `/admin/tcle/new` | List consent templates and purpose codes, and create a consent template. | `requireRole(3, 4)` (`api/backend/src/routes/eConsent.js`) |
| Construtor de TCLE | `/admin/tcle/edit/:templateId` | Open a consent template and update it. | `requireRole(3, 4)` (`api/backend/src/routes/eConsent.js`) |
| Associações de Biomarcadores | `/biomarker-associations` | List biomarker associations; create and edit them. | authenticated only for the list; `requireRole(3, 4)` (`master-data.routes.js`, mounted at `/api/biomarker-associations` in `api/backend/app.js`) |
| Inventário de Amostras | `/samples` | List and search samples; allocate a sample to a box position, move it, or release its position. Deleting a sample is refused by the backend (403). | `requireOrganizationScope` (`sample.routes.js`); `requirePermission('manageStorageAllocation')`, `requireStorageTargetsInScope` (`storage.routes.js`) |
| Detalhes da Amostra | `/samples/:id` | As for the Técnico, plus uploading and deleting sample files, closing the specimen, and sending an analysis file for the sample (Enviar Arquivo, shown to Administrador and Coordenador only), which lists the analytical equipment. | `requireOrganizationScope`, `requirePermission('uploadSampleFiles')`, `requirePermission('deleteSampleFiles')`, `requirePermission('editSample')` (`sample.routes.js`); `requirePermission('manageStorageAllocation')` (`storage.routes.js`); `requirePermission('uploadFiles')`, `requireOrganizationScope` (`result.routes.js`); `requirePermission('viewEquipment')` (`equipment.routes.js`) |
| Etiqueta | `/samples/:id/label` | Show and print a sample's label. | `requireOrganizationScope` (`sample.routes.js`) |
| Cadeia de Custódia | `/samples/:id/chain` | Read a sample's chain of movements. | `requireOrganizationScope` (`sample.routes.js`) |
| Movimentações | `/samples/:id/movements` | Read a sample's movement history. | `requireOrganizationScope` (`sample.routes.js`) |
| Relatórios de Custódia | `/samples/custody-reports` | Read custody movement reports for a sample. | `requireOrganizationScope` (`sample.routes.js`) |
| Retirada e Devolução de Amostras | `/samples/withdrawal-return` | Find a sample by barcode, record its withdrawal and its return. | `requirePermission('withdrawSample')`, `requireOrganizationScope` (`sample.routes.js`) |
| Arquivos de Análise | `/results` | List and download analysis files, read import jobs and their reports, upload an analysis file for a sample (the upload form posts to `/api/analysis-files/upload`). | `requireOrganizationScope` (`result.routes.js`); authenticated only (`import.routes.js` jobs, `analysis-file.routes.js`) |
| Equipamentos | `/facility-management?tab=equipment` | List equipment; create, edit and delete it. `/equipment` redirects here; `/locations` also redirects here. | `requirePermission('viewEquipment')`, `requirePermission('manageStorageTopology')`, `requireOrganizationScope` (`equipment.routes.js`) |
| Controle de Temperatura | `/facility-management?tab=temperature` | Read the stored temperature readings, as cards and a chart. `/temperature` redirects here. | `requirePermission('viewTemperature')`, `requireOrganizationScope` (`temperature.routes.js`) |
| Histórico de Leituras | `/facility-management?tab=history` | Read the temperature readings. | `requirePermission('viewTemperature')`, `requireOrganizationScope` (`temperature.routes.js`) |
| Gerenciamento de Incidentes | `/facility-management?tab=incidents` | List temperature incidents, add notes, acknowledge, resolve and escalate them. `/incidents` redirects here. | `requirePermission('viewTemperature')`, `requirePermission('manageTemperature')` (`incident.routes.js`) |
| Sensores | `/facility-management?tab=sensors` | List, create, edit and delete sensors. `/sensors` redirects here. | `requirePermission('viewTemperature')`, `requirePermission('manageSensor')`, `requireOrganizationScope` (`sensor.routes.js`) |
| Políticas de Temperatura | `/facility-management?tab=policies` | List, create, edit and delete temperature policies. `/policies` redirects here. | `requirePermission('viewTemperature')`, `requirePermission('manageTemperaturePolicy')` (`policy.routes.js`) |
| Descrições de Qualidade | `/quality-descriptions` | List quality descriptions; create, edit and delete them. | authenticated only for reads; `requireRole(3, 4)` (`master-data.routes.js`, mounted at `/api/quality-descriptions` in `api/backend/app.js`) |
| (no page title; batch import form) | `/import` | Upload a batch file, or convert a spreadsheet to a FHIR bundle and stage it. | `requirePermission('uploadFiles')`, `requireOrganizationScope` (`import.routes.js`) |
| Importação LGPD | `/import/lgpd` | Import participants and samples from CSV or XLSX; download the templates. | `requirePermission('createPatient')`, `requirePermission('createSample')`, `requireOrganizationScope` (`import-lgpd.routes.js`) |
| Quarentena de importação | `/import/quarantine` | List quarantined import batches and resubmit a corrected row. | `requirePermission('createSample')`, `requireOrganizationScope` (`import-lgpd.routes.js`) |
| Segurança da Conta | `/user/security` | See your account security status, change your password, generate recovery codes, list and revoke your sessions. | authenticated only (`user-security.routes.js`, `auth.routes.js`) |
| Configurar 2FA | `/security/mfa-setup` | Set up two-factor authentication. | authenticated only (`auth.routes.js`) |

## Permissions

Exactly the Coordenador row of `LEGACY_ROLES_SEED`, with each code's `displayName` and `allowedActions` from `PERMISSION_CATALOG`:

- `createSample`: Criar amostra; CREATE, READ
- `editSample`: Editar amostra; UPDATE
- `createPatient`: Criar paciente; CREATE, READ, UPDATE, DELETE
- `requestConsent`: Solicitar consentimento; CREATE
- `withdrawSample`: Retirar amostra; UPDATE
- `uploadFiles`: Enviar arquivos; CREATE, READ, UPDATE
- `uploadSampleFiles`: Enviar arquivos da amostra; CREATE
- `deleteSampleFiles`: Excluir arquivos da amostra; DELETE
- `viewTemperature`: Visualizar temperatura; CREATE, READ, UPDATE, DELETE
- `manageTemperature`: Gerenciar incidentes de temperatura; UPDATE
- `manageTemperaturePolicy`: Gerenciar políticas de temperatura; CREATE, READ, UPDATE, DELETE
- `manageSensor`: Gerenciar sensores; CREATE, READ, UPDATE, DELETE
- `recordTemperature`: Registrar leitura de temperatura; CREATE
- `viewReports`: Visualizar relatórios; CREATE, READ, DELETE, EXPORT
- `createResult`: Criar arquivo de análise; CREATE
- `editResult`: Editar arquivo de análise; UPDATE
- `deleteResult`: Excluir arquivo de análise; DELETE
- `manageReportTemplates`: Gerenciar modelos de relatório; CREATE, READ, UPDATE, DELETE
- `viewEquipment`: Visualizar equipamentos; READ
- `viewStorageTopology`: Visualizar topologia de armazenamento; READ
- `manageStorageAllocation`: Gerenciar alocação de armazenamento; CREATE, READ, UPDATE, DELETE
- `manageStorageTopology`: Gerenciar topologia de armazenamento; CREATE, READ, UPDATE, DELETE
- `manageCustody`: Gerenciar custódia; CREATE
- `manageAccessGrants`: Gerenciar concessões de acesso; CREATE, READ, UPDATE, DELETE

## What this role cannot do

`/logs` and `/logs/:id` are not Coordenador screens. The route admits the role in `ROUTE_ACCESS`, but `<ProtectedRoute requireAuditReader>` in `frontend/src/App.tsx` opens it only for an audit reader, and the backend refuses a Coordenador every `/api/logs` call (`requireAuditReader` in `logs.routes.js`) unless the additive auditor role is also granted; see [auditor.md](auditor.md).

A Coordenador gets no system management (users, organizations, collections, security), user creation or editing, backup, parameter, data dictionary or access request screen: those routes admit the Administrador only in `frontend/src/App.tsx` and `ROUTE_ACCESS`.

On the screens it does reach, the backend refuses every action that needs a code or level outside the list above: deleting a sample (deleteSample), re-identifying a participant (reidentifyParticipant, `patient.routes.js`), managing access requests (manageAccessRequests) and every user-account action: listing, reading, creating, editing and deleting a user (createUser, readUser, updateUser, deleteUser, which RF003 gives the Administrador only, #1229), and those that need assignRole, resetMFA, disableMFA, forcePasswordReset, revokeSessions or setUserPassword.

Some codes in the seed have no screen that calls the routes they gate, so the Coordenador can exercise them only through the API:

- requestConsent gates `POST /api/e-consent/generate-link` (`api/backend/src/routes/eConsent.js`); no frontend file calls it.
- viewStorageTopology and manageCustody gate the routes of `physical-chain.routes.js`; no frontend file calls `/api/physical-chain`.
- The Arquivos de Análise screen lists and downloads results but offers no create, edit or delete of a result record, although the seed holds createResult, editResult and deleteResult (`result.routes.js`).
- recordTemperature gates `POST /api/temperature/reading` (`temperature.routes.js`); no frontend file calls it.
- manageAccessGrants gates the report-access grant routes of `access.routes.js`; no frontend screen calls `/api/access`.

The result-record codes (createResult, editResult, deleteResult) and manageCustody are API-only by decision, not gaps: see [the role routes and seeded permissions decision](../decisions/2026-10-27-role-routes-and-seeded-permissions.md).

## Account security

`/user/security` (Segurança da Conta) and `/security/mfa-setup` (Configurar 2FA) are open to every role (`ROUTE_ACCESS` entries `ALL_ROLES`). On them you manage your own password, recovery codes, sessions and two-factor authentication; the routes check only that you are signed in (`user-security.routes.js`, `auth.routes.js`). The first sign-in that requires two-factor setup uses `/mfa-setup`, which sits outside the signed-in layout.

Resetting or disabling another user's two-factor authentication, forcing a password reset, revoking another user's sessions and setting their password are Administrador actions; see [administrador.md](administrador.md).
