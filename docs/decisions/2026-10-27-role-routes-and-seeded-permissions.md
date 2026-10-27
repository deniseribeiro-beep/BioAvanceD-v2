# 2026-10-27: the Técnico reaches the report screens, and seeded codes whose routes no screen calls stay API-only for now

Requirement RF002, RF008. Issue #1408.

## The question

The per-role user guides (`docs/user-guides/administrador.md`, `docs/user-guides/tecnico.md`) found six places where the frontend routes, the role seed and the backend gates disagree. Which are defects to fix, and which are the intended state?

## Decided

`[inference]`, from the repo's pattern, on 2026-10-27:

1. **`/locations` lands on an unnamed tab: fixed.** It redirected to `/facility-management?tab=locations`, a tab `FacilityManagementPage` does not have, so the page fell back to `equipment`. There is no locations tab and no StorageLocation screen, so the redirect now names `?tab=equipment`, the tab it already landed on. `FacilityManagementPage.redirects.test.ts` checks that every redirect into the page names a tab in its `validTabs`.
2. **The Técnico holds `viewReports` but `/reports` refused it: fixed, the Técnico is admitted.** RF002 says menus and actions follow "as permissões efetivas" of the user, and its AC5 makes the backend the authority. RF008 generates reports "conforme as permissões do usuário". The backend already admits the Técnico to every `/api/reports` read through `viewReports`, except the audit-trail types, which stay audit-reader only (#1056). Every scoped `/api/reports` read stays within the Técnico's organization scope; the withdrawal history report has no organization reference and is unscoped (#621). #825 resolved an earlier case of a frontend narrower than the grant by widening the frontend. So `/reports`, `/reports/:id` and `/reports/query/:type` now admit the Técnico in `App.tsx`, `ROUTE_ACCESS` and the sidebar. `/reports/templates` stays Administrador and Coordenador: template management is RF008 AC6's `manageReportTemplates`, which the Técnico lacks. The Técnico's dashboard cards (`dashboardCards.ts`) are unchanged, because RF002 AC1 lists no report card for the Técnico.
3. **`reidentifyParticipant`, `manageCustody` and `manageSystem` gate routes no frontend calls: intended.** They gate `POST /api/patients/:id/reidentify`, the `/api/physical-chain` custody routes and `POST /api/audit/anchor`. These are API-only capabilities for now; the e2e specs drive `/api/physical-chain` directly. The codes stay in the seed, because the backend routes need them.
4. **`createResult`, `editResult` and `deleteResult` have no UI on `/results`: intended.** Results are created through `POST /api/results/upload` (`uploadFiles`). `POST /api/results`, `PUT /api/results/:id` and `DELETE /api/results/:id` are API-only for now. The frontend client and `useResults` keep their wrappers.
5. **`temperatureService.create` posted to a route that does not exist: fixed.** `temperature.routes.js` has no `POST /`, only `/reading` and `/system/reading`, and nothing called the method. It is removed.
6. **Two pt-BR sidebar labels were in English: fixed.** `navigation.dataDictionary` is "Dicionário de Dados" and `navigation.tcleBuilder` is "Construtor de TCLE", the sidebar's own pt fallbacks.

## Not decided here

- **Screens for re-identification, custody and audit anchoring**, and a create, edit and delete UI for result records: each is a feature of its own.
- **A report card on the Técnico dashboard.**
- **Scoping the withdrawal history report.** It shows withdrawals from every organization (#621). That exposure already existed through the API; this decision makes it reachable from a screen, and does not close it.
- **The es-ES labels**, which carry the same English values.
