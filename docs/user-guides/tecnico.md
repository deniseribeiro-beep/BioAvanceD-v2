# User guide: Técnico

Part of the per-role user guides (RNF006 C1, #1325); see [README.md](README.md) for the role model. Route files below are under `api/backend/src/interface/routes/` unless a path says otherwise.

## Who this is

- **Seed row** (`api/backend/src/services/rbac-catalog-seed.service.js`): roleName `Tecnico`, roleCode `technician`, display name Técnico, hierarchyLevel 2.
- **After sign-in** you land on `/dashboard` (`getPostLoginRoute` in `frontend/src/utils/rolePermissions.ts`).
- **Organization scope:** you must hold an organization. Without one, every route gated by `requireOrganizationScope` (`api/backend/src/infrastructure/middleware/rbac.js`) answers 403, and you see only what you are assigned to.

## Screens

| Screen (pt-BR label) | Route | What you can do here | Backend gate |
|---|---|---|---|
| Dashboard | `/dashboard` | The cards `DASHBOARD_CARDS` gives the Técnico (`frontend/src/views/dashboardCards.ts`): Pacientes, Amostras and Arquivos de Análise count the participants, samples and analysis files in your organization; Relatórios de Custódia shows the sample count and opens the custody reports; Armazenamento opens Gerenciamento de Instalações; Alertas de Temperatura counts the active (unresolved) temperature incidents. | `requireOrganizationScope` (`patient.routes.js`, `sample.routes.js`, `result.routes.js`); `requirePermission('viewTemperature')` (`incident.routes.js`) |
| Novo Cadastro | `/next/intake` | Register a participant and their samples through the intake wizard. `/pacientes/novo-atendimento` redirects here. | `requirePermission('createSample')`, `requireOrganizationScope` (`intakeWizard.routes.js`) |
| Diretório de Pacientes | `/patients` | List, search and open participants. Creating or editing a participant and resending a consent notification are refused by the backend (403). | `requireOrganizationScope` (`patient.routes.js`) |
| Importação Inteligente de Dados FHIR | `/patients/import-fhir` | Stage, validate and commit a FHIR bundle, and send its consent invitations. `/import/fhir` redirects here. | `requirePermission('uploadFiles')`, `requireOrganizationScope` (`import.routes.js`) |
| Inventário de Amostras | `/samples` | List and search samples; allocate a sample to a box position, move it, or release its position. Deleting a sample and resending a consent notification are refused by the backend (403). | `requireOrganizationScope` (`sample.routes.js`); `requirePermission('manageStorageAllocation')`, `requireStorageTargetsInScope` (`storage.routes.js`) |
| Detalhes da Amostra | `/samples/:id` | Read a sample, its compliance graph, storage location and files; allocate or move it; download its files. Uploading or deleting a sample file and closing the specimen are refused by the backend (403). | `requireOrganizationScope` (`sample.routes.js`); `requirePermission('manageStorageAllocation')`, `requireStorageTargetsInScope` (`storage.routes.js`) |
| Etiqueta | `/samples/:id/label` | Show and print a sample's label. | `requireOrganizationScope` (`sample.routes.js`) |
| Cadeia de Custódia | `/samples/:id/chain` | Read a sample's chain of movements. | `requireOrganizationScope` (`sample.routes.js`) |
| Movimentações | `/samples/:id/movements` | Read a sample's movement history. | `requireOrganizationScope` (`sample.routes.js`) |
| Relatórios de Custódia | `/samples/custody-reports` | Read custody movement reports for a sample. | `requireOrganizationScope` (`sample.routes.js`) |
| Retirada e Devolução de Amostras | `/samples/withdrawal-return` | Find a sample by barcode, record its withdrawal and its return. | `requirePermission('withdrawSample')`, `requireOrganizationScope` (`sample.routes.js`) |
| Arquivos de Análise | `/results` | List and download analysis files, read import jobs and their reports, upload an analysis file for a sample (the upload form posts to `/api/analysis-files/upload`). | `requireOrganizationScope` (`result.routes.js`); authenticated only (`import.routes.js` jobs, `analysis-file.routes.js`) |
| Equipamentos | `/facility-management?tab=equipment` | List equipment. Creating, editing or deleting equipment is refused by the backend (403). `/equipment` redirects here; `/locations` also redirects here. | `requirePermission('viewEquipment')`, `requireOrganizationScope` (`equipment.routes.js`) |
| Controle de Temperatura | `/facility-management?tab=temperature` | Read the stored temperature readings, as cards and a chart. `/temperature` redirects here. | `requirePermission('viewTemperature')`, `requireOrganizationScope` (`temperature.routes.js`) |
| Histórico de Leituras | `/facility-management?tab=history` | Read the temperature readings. | `requirePermission('viewTemperature')`, `requireOrganizationScope` (`temperature.routes.js`) |
| Gerenciamento de Incidentes | `/facility-management?tab=incidents` | List temperature incidents, add notes, acknowledge, resolve and escalate them. | `requirePermission('viewTemperature')`, `requirePermission('manageTemperature')` (`incident.routes.js`) |
| Sensores | `/facility-management?tab=sensors` | List, create, edit and delete sensors. `/sensors` redirects here. | `requirePermission('viewTemperature')`, `requirePermission('manageSensor')`, `requireOrganizationScope` (`sensor.routes.js`) |
| Políticas de Temperatura | `/facility-management?tab=policies` | List, create, edit and delete temperature policies. `/policies` redirects here. | `requirePermission('viewTemperature')`, `requirePermission('manageTemperaturePolicy')` (`policy.routes.js`) |
| Descrições de Qualidade | `/quality-descriptions` | Read the quality descriptions. Creating, editing or deleting one is refused by the backend (403). | authenticated only for reads (`master-data.routes.js`, mounted at `/api/quality-descriptions` in `api/backend/app.js`) |
| (no page title; batch import form) | `/import` | Upload a batch file, or convert a spreadsheet to a FHIR bundle and stage it. | `requirePermission('uploadFiles')`, `requireOrganizationScope` (`import.routes.js`) |
| Importação LGPD | `/import/lgpd` | Import samples from a CSV or XLSX file and download the sample templates. Importing participants is refused by the backend (403). | `requirePermission('createSample')`, `requireOrganizationScope` (`import-lgpd.routes.js`) |
| Quarentena de importação | `/import/quarantine` | List quarantined import batches and resubmit a corrected row. | `requirePermission('createSample')`, `requireOrganizationScope` (`import-lgpd.routes.js`) |
| Central de Relatórios | `/reports` | Open the report catalogue and generate reports. | `requirePermission('viewReports')` (`reports.routes.js`) |
| (the report's name) | `/reports/:id` | Read a generated report. Deleting a report is refused by the backend (403, `requireRole(3, 4)`). | `requirePermission('viewReports')`, `requireRole(3, 4)` to delete (`reports.routes.js`) |
| (the report type's name) | `/reports/query/:type` | Filter, preview and export a report as CSV or PDF. The audit report types (Auditoria, Logs de Acesso) are refused by the backend (403) unless the auditor role is also granted (`AUDIT_READER_HANDLER_KEYS` in `reports.routes.js`). | `requirePermission('viewReports')`, `requireDataExportAllowed` for export (`reports.routes.js`) |
| Segurança da Conta | `/user/security` | See your account security status, change your password, generate recovery codes, list and revoke your sessions. | authenticated only (`user-security.routes.js`, `auth.routes.js`) |
| Configurar 2FA | `/security/mfa-setup` | Set up two-factor authentication. | authenticated only (`auth.routes.js`) |

## Permissions

Exactly the Tecnico row of `LEGACY_ROLES_SEED`, with each code's `displayName` and `allowedActions` from `PERMISSION_CATALOG`:

- `createSample`: Criar amostra; CREATE, READ
- `withdrawSample`: Retirar amostra; UPDATE
- `viewTemperature`: Visualizar temperatura; CREATE, READ, UPDATE, DELETE
- `manageTemperature`: Gerenciar incidentes de temperatura; UPDATE
- `manageTemperaturePolicy`: Gerenciar políticas de temperatura; CREATE, READ, UPDATE, DELETE
- `manageSensor`: Gerenciar sensores; CREATE, READ, UPDATE, DELETE
- `recordTemperature`: Registrar leitura de temperatura; CREATE
- `uploadFiles`: Enviar arquivos; CREATE, READ, UPDATE
- `viewReports`: Visualizar relatórios; CREATE, READ, DELETE, EXPORT
- `viewEquipment`: Visualizar equipamentos; READ
- `viewStorageTopology`: Visualizar topologia de armazenamento; READ
- `manageStorageAllocation`: Gerenciar alocação de armazenamento; CREATE, READ, UPDATE, DELETE

## What this role cannot do

`/reports/templates` stays closed to the Técnico, who lacks manageReportTemplates (RF008 AC6).

A Técnico gets no user, organization, collection, security, backup, parameter, data dictionary, access request, consent (TCLE) or biomarker association screen, and cannot open `/logs` unless the additive auditor role is also granted.

On the screens it does reach, the backend refuses every action that needs a code outside the list above: creating, editing or deleting a participant (createPatient), editing, closing or deleting a sample (editSample, deleteSample), uploading or deleting a sample file (uploadSampleFiles, deleteSampleFiles), creating, editing or deleting equipment (manageStorageTopology), writing quality descriptions (`requireRole(3, 4)` in `master-data.routes.js`), and releasing a sample from quarantine (`requireRole(3, 4)` in `sample.routes.js`).

## Account security

`/user/security` (Segurança da Conta) and `/security/mfa-setup` (Configurar 2FA) are open to every role (`ROUTE_ACCESS` entries `ALL_ROLES`). On them you manage your own password, recovery codes, sessions and two-factor authentication; the routes check only that you are signed in (`user-security.routes.js`, `auth.routes.js`). The first sign-in that requires two-factor setup uses `/mfa-setup`, which sits outside the signed-in layout.

Resetting or disabling another user's two-factor authentication, forcing a password reset, revoking another user's sessions and setting their password are Administrador actions; see [administrador.md](administrador.md).
