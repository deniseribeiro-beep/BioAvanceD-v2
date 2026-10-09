# 2026-10-09: one active consent term per lineage, and one write path

Requirements: RF010 AC1 and AC3, Requisitos v4.0.0; dictionary ConsentTemplate P1X-0365 `versionGroupId`, P1X-0367 `caae`, P1X-0370 `templateStatus`; dict-07's alignment row merging ConsentPolicy into ConsentTemplate. Issue #1181.

## Decided

1. **A term's lineage is its `versionGroupId`, and each lineage has at most one active term.** P1X-0365 groups a term's revisions, `superseded` (P1X-0370) only has meaning against a later revision of the same group, and each term carries its own CAAE (P1X-0367), so terms under different approvals are independent documents that can be in force at once. Publishing a term deactivates the active term of its own lineage only, on every write path.
2. **A term's version counts within its lineage.** A new lineage starts at `v1`; a revision is `v<N+1>` of the lineage's highest. The global counter over the last 200 terms is gone.
3. **The policy route is a boundary over the builder's write paths.** `POST /consent-policies` and `PUT /consent-policies/:id` keep their stricter input contract (a validity period, at least one permission, the policy schema) and then publish through `createTemplate` or `updateTemplate`. The stored term has the builder's shape (`permissions`); the route's response keeps `granularPermissions` as an alias for its callers. A revision keeps its predecessor's CAAE, as the builder's revision does: a new approval is a new lineage.
4. **A participant answers the active term of the lineage they were enrolled under.** `Patient.consentTemplateId` names the enrolment term; its lineage's active term is what the consent link pages show and what an acceptance must name (`getActiveTemplateForParticipant`). The staff-facing reads (`/consent-templates/active`, `/consent-templates/current`) stay the newest active term.
5. **A participant with no resolvable lineage gets the newest active term,** as before lineages were kept apart: no enrolment term, an enrolment term that predates `versionGroupId`, or a lineage with no active term.
