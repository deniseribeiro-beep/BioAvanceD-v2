# User guide: Auditor

Part of the per-role user guides (RNF006 C1, #1325); see [README.md](README.md) for the role model. Route files below are under `api/backend/src/interface/routes/` unless a path says otherwise.

## Who this is

- **Seed row** (`api/backend/src/services/rbac-catalog-seed.service.js`, `ADDITIONAL_ROLES_SEED`): roleCode `auditor`, display name Auditor, no hierarchyLevel and no accessType.
- **An additive role.** It is granted beside a user's base role (Usuário Externo, Técnico, Coordenador or Administrador), never instead of it. After sign-in you land where the base role lands (`getPostLoginRoute` in `frontend/src/utils/rolePermissions.ts` reads the base role), and everything else you can open and do follows the base role's guide: [usuario-externo.md](usuario-externo.md), [tecnico.md](tecnico.md), [coordenador.md](coordenador.md) or [administrador.md](administrador.md).
- **Organization scope:** the base role's. The role adds no scope; the audit routes below do not use `requireOrganizationScope`.
- **What it adds:** the screens `/logs` and `/logs/:id`. A user is an audit reader when `isAuditReader` (`api/backend/src/services/rbac-assignment.service.js`) finds the `administrator` or the `auditor` role code among the user's active roles. The Administrador is therefore already an audit reader, so the role adds `/logs` only for the three lower base roles.

## Screens

Only the screens this role adds are listed. The sidebar shows the `/logs` item (`auditReader: true` in `frontend/src/components/Layout/Sidebar.tsx`) only when `user.isAuditReader === true`, and `<ProtectedRoute requireAuditReader>` in `frontend/src/App.tsx` opens the route on the same flag; `ROUTE_ACCESS` admits every role for `/logs` so that this flag decides.

| Screen (pt-BR label) | Route | What you can do here | Backend gate |
|---|---|---|---|
| Logs | `/logs` | Search, filter and export the audit trail (XLSX), read session audit, and read and verify the daily audit report. | `requireAuditReader` (`logs.routes.js`); `requirePermission('viewReports')` (`audit.routes.js`) |
| Detalhes do Log | `/logs/:id` | Read one audit entry. | `requireAuditReader` (`logs.routes.js`) |

The daily audit report and its verification call `audit.routes.js`, which needs `viewReports`; every base role holds that code in its seed row, so the call is not refused for any base role.

## Permissions

Exactly the auditor row of `ADDITIONAL_ROLES_SEED`, with the code's `displayName` and `allowedActions` from `PERMISSION_CATALOG`:

- `viewAuditLogs`: Visualizar trilhas de auditoria; READ

## What this role cannot do

The role grants no other screen and no other code. Beside a Usuário Externo, a Técnico or a Coordenador, every screen and action that base role is refused stays refused (403); see its guide.

The code `viewAuditLogs` gates no route: it is named only in the seed, and the `/logs` routes decide on `isAuditReader`, which reads the role code, not the permission. Holding the code without the role code does not open `/logs`.

Reading the audit trail through the report types `accessLogs` and `auditEvents` of `reports.routes.js` follows the same rule (`AUDIT_READER_HANDLER_KEYS`): they are refused (403) to everyone who is not an audit reader.

## Account security

`/user/security` (Segurança da Conta) and `/security/mfa-setup` (Configurar 2FA) are open to every role (`ROUTE_ACCESS` entries `ALL_ROLES`), the Auditor's base role included. The routes check only that you are signed in (`user-security.routes.js`, `auth.routes.js`); see the base role's guide.
