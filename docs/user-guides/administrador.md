# User guide: Administrador

Part of the per-role user guides (RNF006 C1, #1325); see [README.md](README.md) for the role model. Route files below are under `api/backend/src/interface/routes/` unless a path says otherwise.

## Who this is

- **Seed row** (`api/backend/src/services/rbac-catalog-seed.service.js`): roleName `Administrador`, roleCode `administrator`, display name Administrador, hierarchyLevel 4.
- **After sign-in** you land on `/system-management` (`getPostLoginRoute` in `frontend/src/utils/rolePermissions.ts`).
- **Organization scope:** global. `requireOrganizationScope` (`api/backend/src/infrastructure/middleware/rbac.js`) resolves the Administrador to a global scope and does not filter by organization.

## Screens

The administration screens come first. The shared staff screens follow with a short summary; where the flow is the same as the Técnico's, [tecnico.md](tecnico.md) describes it, and the Administrador additionally passes the gates the Técnico is refused.

| Screen (pt-BR label) | Route | What you can do here | Backend gate |
|---|---|---|---|
| Usuários | `/system-management?tab=users` | List, edit and delete users; reset or disable a user's two-factor authentication, force a password reset, revoke a user's sessions. `/users` and `/access` redirect here; the tab is the landing screen after sign-in. | `requirePermission('readUser')`, `requirePermission('updateUser')`, `requirePermission('deleteUser')`, `requirePermission('resetMFA')`, `requirePermission('disableMFA')`, `requirePermission('forcePasswordReset')`, `requirePermission('revokeSessions')` (`user.routes.js`) |
| Organizações | `/system-management?tab=organizations` | List organizations; create, edit and delete them. | authenticated only for the list; `requirePermission('manageOrganizations')` (`organization.routes.js`) |
| Coleções | `/system-management?tab=collections` | List collections; create, edit and delete them; record governance approvals, approval status changes and events. | authenticated only for reads; `requireRole(3, 4)` (`master-data.routes.js`, mounted at `/api/collections` in `api/backend/app.js`; `collection-governance.routes.js`) |
| Segurança | `/system-management?tab=security` | Read and change the security configuration, roll it back to an earlier release, read role permissions and the consent queue, export security logs. `/security` redirects here. | `requireRole(4)` (`security.routes.js`) |
| Novo Usuário / Editar Usuário | `/users/new` | Create a user (which also assigns a role), edit a user (a role change also needs assignRole, checked in the handler), set a user's password. | `requirePermission('createUser')`, `requirePermission('updateUser')`, `requirePermission('assignRole')`, `requirePermission('setUserPassword')` (`user.routes.js`) |
| Usuário Criado com Sucesso | `/users/new/success` | Confirmation after creating a user; makes no API call. | none (no API call) |
| Solicitações de acesso e distribuição | `/access-requests` | Create access requests, evaluate their compatibility, record the decision, distribute, revoke, and check access. | `requirePermission('manageAccessRequests')` (`api/backend/src/routes/accessRequest.js`); `requireRole(3, 4)` for purpose codes (`api/backend/src/routes/eConsent.js`) |
| Gerenciamento de Backup | `/backup` | Run a backup, list backups, restore one, read and change the backup policy. The procedure is in `docs/operations/backup-restore-runbook.md`. | `requirePermission('manageBackup')` (`backup.routes.js`); `requireRole(4)` (`backupPolicy.routes.js`) |
| Parâmetros | `/settings/parameters` | List analysis types and create one. | authenticated only for the list; `requireRole(4)` (`analysis-type.routes.js`) |
| Dicionário de Dados Integrado | `/admin/dicionario` | Read, print and export the built-in data dictionary reference; makes no API call. `/admin/dictionary` and `/admin/master-data` redirect here. | none (no API call) |
| Construtor de TCLE | `/admin/tcle/new` | List consent templates and purpose codes; create a consent template. | `requireRole(3, 4)` (`api/backend/src/routes/eConsent.js`) |
| Construtor de TCLE | `/admin/tcle/edit/:templateId` | Open and update an existing consent template. | `requireRole(3, 4)` (`api/backend/src/routes/eConsent.js`) |
| Consentimentos (TCLE) | `/consents` | Read a participant's consent, revoke it, read its history. | `requireOrganizationScope` (`patient.routes.js`); `requireRole(3, 4)` (`api/backend/src/routes/eConsent.js`) |
| Associações de Biomarcadores | `/biomarker-associations` | List biomarker associations; create and edit them. | authenticated only for the list; `requireRole(3, 4)` (`master-data.routes.js`, mounted at `/api/biomarker-associations` in `api/backend/app.js`) |
| Central de Relatórios | `/reports` | Open the report catalogue and generate reports. | `requirePermission('viewReports')` (`reports.routes.js`) |
| (the report's name) | `/reports/:id` | Read a generated report and delete it. | `requirePermission('viewReports')`, `requireRole(3, 4)` to delete (`reports.routes.js`) |
| (the report type's name) | `/reports/query/:type` | Filter, preview and export a report as CSV or PDF. | `requirePermission('viewReports')`, `requireDataExportAllowed` for export (`reports.routes.js`) |
| Modelos de Relatório | `/reports/templates` | List report templates; create, edit and delete them. | `requirePermission('viewReports')`, `requirePermission('manageReportTemplates')` (`reportTemplates.routes.js`) |
| Logs | `/logs` | Search, filter and export the audit trail (XLSX), read session audit, read and verify the daily audit report. Opens because the Administrador is an audit reader (`requireAuditReader` in `frontend/src/App.tsx`). | `requireAuditReader` (`logs.routes.js`); `requirePermission('viewReports')` (`audit.routes.js`) |
| Detalhes do Log | `/logs/:id` | Read one audit entry. | `requireAuditReader` (`logs.routes.js`) |
| Dashboard | `/dashboard` | The cards `DASHBOARD_CARDS` gives the Administrador (`frontend/src/views/dashboardCards.ts`). The Técnico's six, as described in [tecnico.md](tecnico.md): Pacientes, Amostras, Relatórios de Custódia, Armazenamento, Arquivos de Análise and Alertas de Temperatura (active temperature incidents). Then Relatórios de Governança, which counts the saved reports; Usuários, Segurança, Auditoria and Configurações open their screens. The page also shows the consent queue status. | `requireOrganizationScope` (`patient.routes.js`, `sample.routes.js`, `result.routes.js`); `requirePermission('viewTemperature')` (`incident.routes.js`); `requirePermission('viewReports')` (`reports.routes.js`); `requireRole(4)` (`security.routes.js`) |
| Novo Cadastro | `/next/intake` | The intake wizard, as for the Técnico. | `requirePermission('createSample')`, `requireOrganizationScope` (`intakeWizard.routes.js`) |
| Diretório de Pacientes | `/patients` | List, search and open participants; create and edit them; resend a consent notification. | `requireOrganizationScope`, `requirePermission('createPatient')` (`patient.routes.js`) |
| Importação Inteligente de Dados FHIR | `/patients/import-fhir` | The FHIR import, as for the Técnico. | `requirePermission('uploadFiles')`, `requireOrganizationScope` (`import.routes.js`) |
| Inventário de Amostras | `/samples` | The sample inventory as for the Técnico, plus deleting a sample. | `requireOrganizationScope`, `requirePermission('deleteSample')` (`sample.routes.js`); `requirePermission('manageStorageAllocation')`, `requireStorageTargetsInScope` (`storage.routes.js`) |
| Detalhes da Amostra | `/samples/:id` | As for the Técnico, plus uploading and deleting sample files, closing the specimen, and sending an analysis file for the sample (Enviar Arquivo, shown to Administrador and Coordenador only), which lists the analytical equipment. | `requireOrganizationScope`, `requirePermission('uploadSampleFiles')`, `requirePermission('deleteSampleFiles')`, `requirePermission('editSample')` (`sample.routes.js`); `requirePermission('manageStorageAllocation')` (`storage.routes.js`); `requirePermission('uploadFiles')`, `requireOrganizationScope` (`result.routes.js`); `requirePermission('viewEquipment')` (`equipment.routes.js`) |
| Etiqueta | `/samples/:id/label` | Show and print a sample's label. | `requireOrganizationScope` (`sample.routes.js`) |
| Cadeia de Custódia | `/samples/:id/chain` | Read a sample's chain of movements. | `requireOrganizationScope` (`sample.routes.js`) |
| Movimentações | `/samples/:id/movements` | Read a sample's movement history. | `requireOrganizationScope` (`sample.routes.js`) |
| Relatórios de Custódia | `/samples/custody-reports` | Read custody movement reports for a sample. | `requireOrganizationScope` (`sample.routes.js`) |
| Retirada e Devolução de Amostras | `/samples/withdrawal-return` | Record withdrawals and returns, as for the Técnico. | `requirePermission('withdrawSample')`, `requireOrganizationScope` (`sample.routes.js`) |
| Arquivos de Análise | `/results` | List and download analysis files, read import jobs, upload an analysis file for a sample (the upload form posts to `/api/analysis-files/upload`). | `requireOrganizationScope` (`result.routes.js`); authenticated only (`import.routes.js` jobs, `analysis-file.routes.js`) |
| Equipamentos | `/facility-management?tab=equipment` | List equipment; create, edit and delete it. `/equipment` redirects here; `/locations` also redirects here. | `requirePermission('viewEquipment')`, `requirePermission('manageStorageTopology')`, `requireOrganizationScope` (`equipment.routes.js`) |
| Controle de Temperatura | `/facility-management?tab=temperature` | Read the stored temperature readings, as cards and a chart. `/temperature` redirects here. | `requirePermission('viewTemperature')` (`temperature.routes.js`) |
| Histórico de Leituras | `/facility-management?tab=history` | The temperature readings. | `requirePermission('viewTemperature')` (`temperature.routes.js`) |
| Gerenciamento de Incidentes | `/facility-management?tab=incidents` | Temperature incidents, as for the Técnico. | `requirePermission('viewTemperature')`, `requirePermission('manageTemperature')` (`incident.routes.js`) |
| Sensores | `/facility-management?tab=sensors` | Sensors, as for the Técnico. `/sensors` redirects here. | `requirePermission('viewTemperature')`, `requirePermission('manageSensor')` (`sensor.routes.js`) |
| Políticas de Temperatura | `/facility-management?tab=policies` | Temperature policies, as for the Técnico. `/policies` redirects here. | `requirePermission('viewTemperature')`, `requirePermission('manageTemperaturePolicy')` (`policy.routes.js`) |
| Descrições de Qualidade | `/quality-descriptions` | List quality descriptions; create, edit and delete them. | authenticated only for reads; `requireRole(3, 4)` (`master-data.routes.js`) |
| (no page title; batch import form) | `/import` | Batch and FHIR spreadsheet import, as for the Técnico. | `requirePermission('uploadFiles')`, `requireOrganizationScope` (`import.routes.js`) |
| Importação LGPD | `/import/lgpd` | Import participants and samples from CSV or XLSX; download the templates. | `requirePermission('createPatient')`, `requirePermission('createSample')`, `requireOrganizationScope` (`import-lgpd.routes.js`) |
| Quarentena de importação | `/import/quarantine` | Quarantined import batches, as for the Técnico. | `requirePermission('createSample')`, `requireOrganizationScope` (`import-lgpd.routes.js`) |
| Segurança da Conta | `/user/security` | Your own account security; see Account security below. | authenticated only (`user-security.routes.js`, `auth.routes.js`) |
| Configurar 2FA | `/security/mfa-setup` | Set up your own two-factor authentication. | authenticated only (`auth.routes.js`) |

## Permissions

Exactly the Administrador row of `LEGACY_ROLES_SEED`, with each code's `displayName` and `allowedActions` from `PERMISSION_CATALOG`:

- `createUser`: Criar usuário; CREATE
- `readUser`: Visualizar usuários; READ
- `updateUser`: Editar usuário; UPDATE
- `deleteUser`: Excluir usuário; DELETE
- `assignRole`: Atribuir papel; CREATE, UPDATE
- `createSample`: Criar amostra; CREATE, READ
- `editSample`: Editar amostra; UPDATE
- `deleteSample`: Excluir amostra; DELETE
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
- `manageBackup`: Gerenciar backup; CREATE, READ, UPDATE
- `manageSystem`: Gerenciar sistema; UPDATE
- `resetMFA`: Redefinir MFA; UPDATE
- `forcePasswordReset`: Forçar redefinição de senha; UPDATE
- `disableMFA`: Desativar MFA; UPDATE
- `revokeSessions`: Revogar sessões; UPDATE
- `setUserPassword`: Definir senha de usuário; UPDATE
- `manageOrganizations`: Gerenciar organizações; CREATE, UPDATE, DELETE
- `createResult`: Criar arquivo de análise; CREATE
- `editResult`: Editar arquivo de análise; UPDATE
- `deleteResult`: Excluir arquivo de análise; DELETE
- `reidentifyParticipant`: Reidentificar participante; READ
- `manageAccessRequests`: Gerenciar solicitações de acesso; CREATE, READ, UPDATE
- `manageReportTemplates`: Gerenciar modelos de relatório; CREATE, READ, UPDATE, DELETE
- `viewEquipment`: Visualizar equipamentos; READ
- `viewStorageTopology`: Visualizar topologia de armazenamento; READ
- `manageStorageAllocation`: Gerenciar alocação de armazenamento; CREATE, READ, UPDATE, DELETE
- `manageStorageTopology`: Gerenciar topologia de armazenamento; CREATE, READ, UPDATE, DELETE
- `manageCustody`: Gerenciar custódia; CREATE
- `manageAccessGrants`: Gerenciar concessões de acesso; CREATE, READ, UPDATE, DELETE

## What this role cannot do

The Administrador seed does not hold viewAuditLogs; that code belongs to the additive auditor role. The Administrador reads `/logs` as an audit reader: the audit-reader rule (`isAuditReader` in `api/backend/src/services/rbac-assignment.service.js`, applied by `requireAuditReader` in `logs.routes.js`) admits the administrator role as well as the auditor role.

Some codes in the seed have no screen that calls the routes they gate, so the Administrador can exercise them only through the API:

- reidentifyParticipant gates `POST /api/patients/:id/reidentify` (`patient.routes.js`); no frontend file calls it.
- manageCustody gates the custody routes of `physical-chain.routes.js`; no frontend file calls `/api/physical-chain`.
- manageSystem gates `POST /api/audit/anchor` (`audit.routes.js`); no frontend file calls it.
- The Arquivos de Análise screen lists and downloads results but offers no create, edit or delete of a result record, although the seed holds createResult, editResult and deleteResult (`result.routes.js`).

These are API-only by decision, not gaps: see [the role routes and seeded permissions decision](../decisions/2026-10-27-role-routes-and-seeded-permissions.md).

manageAccessGrants gates the report-access grant routes of `access.routes.js` (#1229); no frontend screen calls `/api/access` (`useAccess` has no caller), and the e2e specs grant report access through the API.

## Account security

`/user/security` (Segurança da Conta) and `/security/mfa-setup` (Configurar 2FA) are open to every role (`ROUTE_ACCESS` entries `ALL_ROLES`). On them you manage your own password, recovery codes, sessions and two-factor authentication; the routes check only that you are signed in (`user-security.routes.js`, `auth.routes.js`). The first sign-in that requires two-factor setup uses `/mfa-setup`, outside the signed-in layout.

Acting on another user's account is the Administrador's alone. Each action is on the Usuários tab of `/system-management` (set password on `/users/new`), and each route in `user.routes.js` also passes `requireOrganizationScope`:

| Action | Route | Gate |
|---|---|---|
| Reset two-factor authentication | `POST /api/users/:id/reset-mfa` | `requirePermission('resetMFA', 'UPDATE')` |
| Disable two-factor authentication | `POST /api/users/:id/disable-mfa` | `requirePermission('disableMFA', 'UPDATE')` |
| Force a password reset at next sign-in | `POST /api/users/:id/force-password-reset` | `requirePermission('forcePasswordReset', 'UPDATE')` |
| Revoke the user's sessions | `POST /api/users/:id/revoke-sessions` | `requirePermission('revokeSessions', 'UPDATE')` |
| Set the user's password | `POST /api/users/:id/set-password` | `requirePermission('setUserPassword', 'UPDATE')` |
