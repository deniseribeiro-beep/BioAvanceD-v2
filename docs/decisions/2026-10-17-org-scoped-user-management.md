# 2026-10-17: an organization-scoped caller manages the users of its own organizations only

Requirement: RF003 (user management) and RF003 AC#3 (organization scope, #340). Issue #1384.

## Question

`user.routes.js` checked the permission code and nothing else. The seeded Coordenador holds `createUser`, an organization-scoped role, so it listed, read, edited and deactivated the users of every organization. Which users may an organization-scoped caller reach, and what counts as a user's organization?

## Decided

1. **A user's organizations are its active `UserRoleAssignment` scope ids,** read with `resolveUserOrganizationScope`, the tenancy key every other gate reads. `User.organizationId` is the home organization, profile data (the arch test's `SCOPE_FIELD_EXEMPT`), and it reaches the assignments through `updateAssignmentScope`.
2. **A target is in reach when it shares at least one organization with the caller.** This is the overlap rule `isRecordInOrganizationScope` already applies to an array field such as `Report.organizationIds`.
3. **A global target (Administrador) and an org-less target (`none` or `unassigned`) are out of reach of every non-global caller.** The Administrador (global) manages every user. An out-of-reach existing user answers 403, not 404, as every other scoped record does.
4. **A non-global caller moves, grants and revokes only within its own organizations.** `PUT /:id` may change a user's home organization only to one of the caller's, and never to none. Moving a user needs both the old and the new home organization in the caller's scope, because the move revokes the old home's assignment. `POST /register` stamps the caller's own organization whatever the body names, by #1071's create rule. `POST /:id/organizations` and `DELETE /:id/organizations/:organizationId` act only on one of the caller's organizations.
5. **`GET /api/users/logs` stays cross-organization.** It is the RNF009 audit trail, gated on `isAuditReader`, and `/api/logs` serves the same collection across organizations.

Why:

- **The repo's tenancy pattern answers it.** Every scoped route resolves the caller with `requireOrganizationScope` and checks a record's organization against it. The only organization a user record has for that check is its assignment scope, the same ids that decide what that user can reach.
- **Out of reach rather than in reach is the fail-closed side.** A global target is above the Coordenador's level (the #998 floor already refuses a promotion and a delete across it), and an org-less user belongs to no organization the caller could claim.

Made by the 2026-10-17 coordinator sitting on #1384 by inference from the repo's tenancy pattern; the owner may reverse it.

## Not decided here

- Whether a target in several organizations should need all of them to be in the caller's reach, rather than one. No route or script writes a second organization except `POST /:id/organizations`, which is Administrador-only today (`assignRole`), so the overlap rule and the all-of rule give the same answer on every user the product can make.
