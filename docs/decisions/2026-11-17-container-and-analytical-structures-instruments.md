# 2026-11-17: RNF014 C1, RNF014 C2, RNF014 C3, RNF031 C9: container configuration and inactive analytical structures are proven by architecture tests, not by Playwright

Requirements: RNF014 C1, RNF014 C2, RNF014 C3, RNF031 C9. Issue #1572.

## The question

Four criteria name configuration rather than behaviour (`docs/extracted-v2.0.0/requisitos.md`):

- RNF014 C1: "Usar artefatos declarativos com versão ou digest imutável."
- RNF014 C2: "Manter configurações e segredos fora da imagem."
- RNF014 C3: "Aplicar health checks, limites e privilégios mínimos."
- RNF031 C9: "Preparar estruturas analíticas futuras sem ativar modelos."

None has a real-backend Playwright case, and no record said which instrument proves them, so they read as not proven. Which instrument proves each, and which part does it not reach?

## Decided

`[inference]`, from the specification and the repo's pattern, on 2026-11-17. The pattern: a criterion is proven where what it names lives, by the instrument that can reach it, and a part no instrument reaches is named rather than claimed (`2026-11-14-component-limits-tests.md`). An image pin, a build context, a compose limit or a source file that loads no model is configuration of the artifacts; a browser or an API call against the running stack sees none of it, so no Playwright case can prove it.

1. **RNF014 C1, C2 and C3 are proven by `api/backend/tests/architecture/container-hardening.arch.test.js`**, which reads `compose.prod.yml` and the Dockerfiles it builds. `[read it]` CI's "Current-state validation" job runs it in its "Backend architecture tests" step (`npm --prefix api/backend run test:architecture`, `.github/workflows/ci-pipeline.yml`) on the checked-out tree; inside `backend-unit-runner`, whose image holds only `api/backend`, it skips by design (#1190).
   - **C1:** "RNF014 C1: every compose.prod.yml image is pinned by version or digest" and "RNF014 C1: every FROM in a production Dockerfile is pinned, or names an earlier stage".
   - **C2:** "RNF014 C2: no secret is baked into a production image": a build context that copies the whole tree excludes `.env` files, and no build arg, `ENV` or `COPY` names a secret.
   - **C3, limits and least privilege:** "RNF014 C3: every compose.prod.yml service declares CPU and memory limits" and "RNF014 C3: every service but the official-image data stores runs read_only, with cap_drop ALL and a non-root user".
   - The file's "RNF014 refuses bypass" cases plant a bypass of the C1 pins (an unpinned image, `FROM node:latest`) and of the C3 limits and privilege checks (limits under reservations only, a root user in its many spellings, an image-only service outside the exempt data stores), and the compose parser refuses any key it does not model, so a key such as `cap_add` or `privileged` cannot undo what is asserted.
2. **RNF031 C9 is proven by `api/backend/tests/architecture/inactive-analytical-structures.arch.test.js`**, run in the same CI step. "No backend flow loads or writes an inactive analytical-preparation entity (RF029 AC8, RNF030)" fails the day a file under `src` or `scripts` requires one of the seven analytical-preparation models (DatasetSnapshot, DatasetPartition, FeatureDefinition, LabelDefinition, CohortDefinition, DeidentificationProcess, DatasetRepresentativenessAssessment) or names the collection a flow would write it to; "the scan reads the backend source tree (at least 500 files)" and "control: an inactive model load or collection call is flagged, other uses are not" keep that from passing on an empty scan. That the structures are prepared is held by `api/backend/tests/unit/models/analyticalPreparationModels.test.js` ("fieldsOf() with no argument emits exactly the catalog fields, in catalog order") and `api/backend/tests/architecture/canonical-catalog-conformance.arch.test.js`. What "inactive" means is `2026-10-22-inactive-analytical-preparation-structures.md`.

## Not decided here

- **RNF014 C3, health checks.** `[read it]` `container-hardening.arch.test.js` models the `healthcheck` key but asserts none. `compose.prod.yml` declares one for every long-running service (mongodb, neo4j, influxdb, redis, tsa, witness, backend, worker, neo4j-projection-worker, frontend) and none for the one-shot jobs (mongo-rs-init, foundation, essential-references), but no test fails if one is removed, so this part is not proven.
- **RNF014 C1-C3 in another deployment.** The tests read `compose.prod.yml` only; a stack deployed from another artifact (a Kubernetes manifest, which RNF014 C5 keeps optional) is not checked.
- **RNF014 C2, a control for the secret check.** `[read it]` No "refuses bypass" case plants a secret build arg, a secret `ENV` or `COPY`, or a whole-tree build context that keeps `.env` files, so the C2 check is reached only by the passing cases and nothing shows it fails when it should.
- **RNF014 C2, configuration outside the image.** The test proves no secret is baked in; that every non-secret setting comes from the environment rather than a file copied into the image is not asserted.
- **RNF014 C3 for the four official-image data stores.** Their limits are asserted; read_only, cap_drop and the non-root user are exempted by the test, because their entrypoints start as root.
- **RNF031 C9, "modelos" as trained analytical models.** The test reaches the seven modelled entities; no trained or scoring model exists in the repo, and nothing would flag one added outside `src` and `scripts`.
