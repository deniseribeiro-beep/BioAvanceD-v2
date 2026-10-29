# User guide: Usuário Externo

Part of the per-role user guides (RNF006 C1, #1325); see [README.md](README.md) for the role model. Route files below are under `api/backend/src/interface/routes/` unless a path says otherwise.

## Who this is

- **Seed row** (`api/backend/src/services/rbac-catalog-seed.service.js`): roleName `UsuarioExterno`, roleCode `external_user`, display name Usuário externo (the frontend `RoleName` in `frontend/src/utils/rolePermissions.ts` spells it Usuário Externo), hierarchyLevel 1.
- **After sign-in** you land on `/dashboard` (`getPostLoginRoute` in `frontend/src/utils/rolePermissions.ts`).
- **Organization scope:** you must hold an organization. Without one, every route gated by `requireOrganizationScope` (`api/backend/src/infrastructure/middleware/rbac.js`) answers 403, and so do the report routes, which check the scope inline (`reports.routes.js`).

## Screens

A route opens only when both its `<Route>` `requiredRole` in `frontend/src/App.tsx` and its `ROUTE_ACCESS` entry admit the role. For the Usuário Externo that is the screens below. The sidebar (`frontend/src/components/Layout/Sidebar.tsx`) shows only three of them: Dashboard, Relatórios (`/reports`) and Minha Segurança (`/user/security`). The others open when you type the address, and the backend then decides what each answers.

Your only seeded code is `viewReports`; where the table says an action is refused (403), the route needs a code or level you do not hold.

| Screen (pt-BR label) | Route | What you can do here | Backend gate |
|---|---|---|---|
| Dashboard | `/dashboard` | The one card `DASHBOARD_CARDS` gives the Usuário Externo (`frontend/src/views/dashboardCards.ts`): Relatórios Autorizados, which counts the saved reports a grant names and opens `/reports`. The page also loads the participant, sample and analysis file lists for its counts; those calls answer 403 without an organization. | `requirePermission('viewReports')` (`reports.routes.js`); `requireOrganizationScope` (`patient.routes.js`, `sample.routes.js`, `result.routes.js`) |
| Central de Relatórios | `/reports` | Open the report catalogue. The catalogue lists the report types for which `hasReportAccess` (`frontend/src/contexts/AuthContext.tsx`) is true; for accessType 1 that needs `user.allowedReports`, so without it the list is empty. `/reports/templates` is not open to this role. | `requirePermission('viewReports')` (`reports.routes.js`); `requirePermission('viewReports')` (`reportTemplates.routes.js`) |
| (the report type's name) | `/reports/query/:type` | Filter, preview and export a report as CSV or PDF, only for a report type a grant names; any other type is refused by the backend (403), and so is every audit-trail type (`accessLogs`, `auditEvents`). Export is also refused (403) while data export is disabled in the LGPD configuration. | `requirePermission('viewReports')`, `requireDataExportAllowed` for export (`reports.routes.js`) |
| (the report's name) | `/reports/:id` | Read a generated report that a grant names; another report answers 403. Deleting a report is refused by the backend (403). | `requirePermission('viewReports')`, `requireRole(3, 4)` to delete (`reports.routes.js`) |
| Diretório de Pacientes | `/patients` | Open the page and read the participant list. Creating, editing or deleting a participant and resending a consent notification are refused by the backend (403). | `requireOrganizationScope` for reads, `requirePermission('createPatient')` for writes (`patient.routes.js`) |
| Inventário de Amostras | `/samples` | Open the page and read the sample list. Allocating, moving or releasing a sample position (manageStorageAllocation) and deleting a sample (deleteSample) are refused by the backend (403). | `requireOrganizationScope` (`sample.routes.js`); `requirePermission('manageStorageAllocation')`, `requireStorageTargetsInScope` (`storage.routes.js`) |
| Detalhes da Amostra | `/samples/:id` | Read a sample and download its files. Uploading or deleting a sample file, closing or editing the specimen, and sending an analysis file for the sample are refused by the backend (403). | `requireOrganizationScope` (`sample.routes.js`); `requirePermission('uploadSampleFiles')`, `requirePermission('deleteSampleFiles')`, `requirePermission('editSample')` (`sample.routes.js`); `requirePermission('uploadFiles')` (`result.routes.js`) |
| Etiqueta | `/samples/:id/label` | Show and print a sample's label. | `requireOrganizationScope` (`sample.routes.js`) |
| Cadeia de Custódia | `/samples/:id/chain` | Read a sample's chain of movements. | `requireOrganizationScope` (`sample.routes.js`) |
| Movimentações | `/samples/:id/movements` | Read a sample's movement history. | `requireOrganizationScope` (`sample.routes.js`) |
| Relatórios de Custódia | `/samples/custody-reports` | Read custody movement reports for a sample. | `requireOrganizationScope` (`sample.routes.js`) |
| Arquivos de Análise | `/results` | List and download analysis files and read import jobs and their reports. Uploading through `result.routes.js` is refused by the backend (403); the upload form posts to `/api/analysis-files/upload`, which checks only that you are signed in. | `requireOrganizationScope`, and `requirePermission('uploadFiles')` for `POST /api/results/upload` (`result.routes.js`); authenticated only (`import.routes.js` jobs, `analysis-file.routes.js`) |
| Segurança da Conta | `/user/security` | See your account security status, change your password, generate recovery codes, list and revoke your sessions. | authenticated only (`user-security.routes.js`, `auth.routes.js`) |
| Configurar 2FA | `/security/mfa-setup` | Set up two-factor authentication. | authenticated only (`auth.routes.js`) |

## Permissions

Exactly the UsuarioExterno row of `LEGACY_ROLES_SEED`, with each code's `displayName` and `allowedActions` from `PERMISSION_CATALOG`:

- `viewReports`: Visualizar relatórios; CREATE, READ, DELETE, EXPORT

## What this role cannot do

Every route not in the table above is closed to the Usuário Externo by `ROUTE_ACCESS` or by the `<Route>` `requiredRole`: the intake wizard, the FHIR and batch imports, sample withdrawal and return, facility management, quality descriptions, report templates, the consent, TCLE and biomarker association screens, system management, backup, parameters, the data dictionary and access requests. `/logs` is not an Usuário Externo screen either: it opens only for an audit reader, and the backend refuses every `/api/logs` call unless the additive auditor role is also granted; see [auditor.md](auditor.md).

Deleting a report needs `requireRole(3, 4)`, so the backend refuses it (403) even though the code `viewReports` lists DELETE. Every action that needs a code other than `viewReports` is refused (403): creating or editing participants and samples, sample files, storage allocation, results, temperature, equipment and everything else in [tecnico.md](tecnico.md), [coordenador.md](coordenador.md) and [administrador.md](administrador.md).

The backend answers an organization-less Usuário Externo 403 on every `requireOrganizationScope` route and on the report routes. With an organization, the participant, sample and analysis-file reads in the table are not gated on any code, so they answer to this role.

## Account security

`/user/security` (Segurança da Conta) and `/security/mfa-setup` (Configurar 2FA) are open to every role (`ROUTE_ACCESS` entries `ALL_ROLES`). On them you manage your own password, recovery codes, sessions and two-factor authentication; the routes check only that you are signed in (`user-security.routes.js`, `auth.routes.js`). The first sign-in that requires two-factor setup uses `/mfa-setup`, which sits outside the signed-in layout.

Resetting or disabling another user's two-factor authentication, forcing a password reset, revoking another user's sessions and setting their password are Administrador actions; see [administrador.md](administrador.md).
