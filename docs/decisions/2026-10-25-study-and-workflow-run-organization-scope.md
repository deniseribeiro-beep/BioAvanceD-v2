# 2026-10-25: Study and WorkflowRun are shared across organizations, and their master-data mounts stay unscoped

Issue #1403.

## Question

`/api/studies` and `/api/workflow-runs` are `createMasterDataRouter` mounts with no `scopeField`, so `GET /` and `GET /:id` answer every authenticated user with every organization's rows. Which organization reference should scope them?

## Decided

1. **Both mounts stay without `scopeField`.** Any authenticated user lists and reads them, and writes keep the factory's `requireRole(3, 4)`.
2. **The FHIR exports keep their gate.** The Study and WorkflowRun exports keep `requireRole(3, 4)`, as recorded on 2026-10-24 (`2026-10-24-fhir-export-route-and-bundle.md`).
3. **The scope comes with the model.** When a release gives either entity a 1..1 organization reference, the mount gets a `scopeField` naming it, with route tests for the by-id 403 and the list filter.

Why:

- **Study has no owning organization.** In the v2.0.0 dictionary (ELM-0053..0067) its only organization reference is `participatingCenters` (ELM-0066, `Reference[]`, 0..*, Condicional), a list of centers that can be empty or name several organizations. `principalInvestigator` (ELM-0059, 1..1) is a Practitioner, not an organization.
- **WorkflowRun has no organization field at all.** Its rows (ELM-0326..0336, V2E-0477..0480) reference files (`inputFileIds`, `outputFileIds`) and a `datasetSnapshotId`; the executor is BaseRecord's `createdBy` (ELM-0007), a User.
- **The organization link runs the other way.** REL-0036 points BiorepositoryContext.studyId at Study (0..* contexts per Study), and BiorepositoryContext carries `responsibleOrganizationId` (V2E-0082, 1..1). One Study is reached by the contexts of several organizations.
- **Assay is the contrast.** It carries `laboratoryId` (ELM-0293, Reference, 1..1), which is why it is the one scoped factory mount (#1182).
- **Either scope would invent an owner.** Scoping on `participatingCenters` would pick an owner from a 0..* list the model does not store. Deriving a run's organization from `createdBy` would invent a field the dictionary does not give, against the "check BaseRecord before inventing vocabulary" precedent (#669) cited in `WorkflowRun.js`.

Made by the 2026-10-25 coordinator sitting on #1403, by inference from #1182 (a master-data mount is scoped only on an organization field its own dictionary rows carry); the owner may reverse it.
