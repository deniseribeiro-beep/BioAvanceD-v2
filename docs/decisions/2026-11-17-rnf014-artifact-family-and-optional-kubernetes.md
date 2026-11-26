# 2026-11-17: RNF014 C4, RNF014 C5: one artifact family across environments and an optional Kubernetes are proven by architecture tests, not by Playwright

Requirements: RNF014 C4, RNF014 C5. Issue #1569.

## The question

Two criteria name how the stack is packaged rather than how it behaves (`docs/extracted-v2.0.0/requisitos.md`, RNF014):

- RNF014 C4: "Usar a mesma família de artefatos entre ambientes."
- RNF014 C5: "Manter Kubernetes opcional."

Neither had a test naming it, and none can be a real-backend Playwright case: a browser or an API call against the running stack sees neither the Dockerfile an image was built from nor the tool that started it. Which instrument proves each, and which part does it not reach?

## Decided

`[inference]`, from the specification and the repo's pattern, on 2026-11-17. The pattern is the one `2026-11-17-container-and-analytical-structures-instruments.md` applied to RNF014 C1-C3: a criterion about the artifacts is proven where the artifacts live, by `api/backend/tests/architecture/container-hardening.arch.test.js`, which CI's "Current-state validation" job runs in its "Backend architecture tests" step on the checked-out tree.

1. **RNF014 C4 is read as: every environment builds a deployable component from the same build context and base images as production, every third-party image carries one version in every environment, and a published image is the one its compose service builds.** The environments are the root compose files, every root file named `compose*.yml`, `compose*.yaml`, `docker-compose*.yml` or `docker-compose*.yaml` (today `compose.yml`, `compose.dev.yml`, `compose.lab.yml`, `compose.test.yml`, `compose.prod.yml` and the two `compose.*.images.yml` overlays). Three cases carry it:
   - "RNF014 C4: every environment builds each deployable component from its production context and base images". `compose.test.yml` builds the backend from `api/backend/Dockerfile.dev` and production from `Dockerfile.prod`; both start from the one pinned `node` image, so they are one family. The only build outside a production context is `playwright-runner`, the test runner, listed by name.
   - "RNF014 C4: every third-party image carries one version in every compose file and Dockerfile".
   - "RNF014 C4: each published-image overlay runs the image built from its own service's build", which reads `.github/workflows/publish-images.yml` against each service's `build:` section.
2. **RNF014 C5 is read as: nothing the stack is built, tested or deployed with needs Kubernetes.** "RNF014 C5: no compose file, Dockerfile, package.json, script, infra file or workflow needs Kubernetes" fails on the words kubectl, kubernetes, k8s, helm, kustomize, kustomization or minikube, a line opening with `apiVersion:`, or a `Chart.yaml` or `kustomization.yaml`, in the root compose files and Dockerfiles, the Dockerfiles and `package.json` of `api/backend` and `frontend`, the root `package.json`, and every file under `scripts/`, `infra/` and `.github/workflows/`. The compose stack runs without it, as the RNF014 C1-C3 cases already read.
3. Each check has a "refuses" case that plants the bypass it names and turns red when the check is removed.

## Not decided here

- **C4 for an environment outside the root compose files.** A stack started from another file (an overlay under `scripts/`, a hand-written command) is not read.
- **C4 beyond the base image.** `Dockerfile.dev` and `Dockerfile.prod` differ in their stages; the test holds that they share a context and base images, not that they install the same packages.
- **C5 as a scan.** The checks are regression guards over the forms listed in point 2; a Kubernetes dependency spelled another way, or placed outside the files read, is not caught. Kubernetes stays allowed as an optional deployment target kept outside the repo's own build, test and deploy path.
