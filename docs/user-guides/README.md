# User guides by role

Answers RNF006 C1 ("Disponibilizar guias técnicos e de usuário por papel"), from `docs/extracted-v2.0.0/requisitos.md`. Written 2026-10-27; describes the code at this commit. Tracking issue: #1325.

Each guide lists the screens a role can open, what it can do on each, the backend gate that decides it, and the role's permission codes. Screen labels are quoted in pt-BR, as the UI shows them (`frontend/src/i18n/pt-BR.json` is the fallback locale).

## The role model

The roles and their permission codes have one source: `api/backend/src/services/rbac-catalog-seed.service.js` (`ROLE_CODE_BY_LEGACY_NAME`, `ROLE_DISPLAY_NAMES`, `LEGACY_ROLES_SEED`, `ADDITIONAL_ROLES_SEED`). The hierarchy level is the role's `accessType` in the seed, and `requireRole(level...)` in `api/backend/src/infrastructure/middleware/rbac.js` checks it.

| roleName | Display name | roleCode | hierarchyLevel | Permission codes |
|---|---|---|---|---|
| UsuarioExterno | Usuário externo | `external_user` | 1 | 1 |
| Tecnico | Técnico | `technician` | 2 | 12 |
| Coordenador | Coordenador | `coordinator` | 3 | 24 |
| Administrador | Administrador | `administrator` | 4 | 36 |
| (additive) | Auditor | `auditor` | none | 1 (`viewAuditLogs`) |

The `auditor` role is granted alongside a user's base role, never instead of it. With the Administrador, it makes a user an audit reader: the reader of `/logs` (`requireAuditReader` in `api/backend/src/interface/routes/logs.routes.js`).

## Where access is decided

- **The backend decides.** Each API route checks a permission code (`requirePermission('<code>')`, which also checks the HTTP verb against the code's `allowedActions`), a hierarchy level (`requireRole(...)`) or the audit-reader rule. `requireOrganizationScope` answers 403 to a user below Administrador who holds no organization; the Administrador's scope is global.
- **The frontend only hides screens.** A route opens only if both its `<Route>` `requiredRole` in `frontend/src/App.tsx` and its `ROUTE_ACCESS` entry in `frontend/src/utils/rolePermissions.ts` admit the role (`frontend/src/components/ProtectedRoute.tsx`). A sidebar item shows only when its `roles` hold the role and `canRoleAccessRoute` allows it (`frontend/src/components/Layout/Sidebar.tsx`). A hidden screen is not a grant, and a screen that opens does not mean every button on it succeeds: the backend can still answer 403.

## The guides

| Role | Guide |
|---|---|
| Administrador | [administrador.md](administrador.md) |
| Técnico | [tecnico.md](tecnico.md) |
| Coordenador | not yet written (#1325) |
| Usuário Externo | not yet written (#1325) |
| Auditor | not yet written (#1325) |
