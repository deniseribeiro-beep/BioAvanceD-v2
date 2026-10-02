# HANDOFF

**Written 2026-10-02, eightieth queue sitting. INTERIM: the sitting ran
its end sequence (audit, suite, push, issues, clean-up), but Dennis has not
said it is over.**

The instruction was: "pick next group of issues and resolve them". The
group picked was **#1279** (suite-red) and **#1277**, the last note's
queue. **#1280**, **#1281** and **#1282** were found on the way, filed and
worked. #1254, #1257 and #1271 are newer, but each is a question for
Dennis (below).

## Repo state

The branch is `feature/docker-e2e-backend-integration`, pushed. The last
code commit is `a94ae99f`.

## What shipped

- **#1279, closed** (`ea35c4a1`, `a94ae99f`): the organizations specs no
  longer depend on page position in the capped list.
  - The #325 spec and `backend-integration.spec.ts` delete their fixture in
    a `finally`.
  - The three list-reading specs page through the list with
    `tests/e2e/helpers/listOrganizations.ts`.
- **#1277, closed** (`ddfb6171`): `Patient.FIELD_TYPES` and
  `validateUpdateTypes`. `updatePatient` refuses a wrong-typed declared
  field with a 422 (`INVALID_FIELD_TYPE`) before any write, and stores
  consent dates sent as strings as `Date`s.
- **#1281, closed** (`66f8c362`), security: `PUT /api/patients/:id`
  refused nothing among `status`, `consentTokenHash` and the `consent*At`
  dates. So a `createPatient` holder could set a token hash and accept a
  consent through the unauthenticated route. The route now answers 422
  (`SERVER_MANAGED_FIELD`) for `Patient.SERVER_MANAGED_FIELDS`.
- **#1280, closed** (`70b1e4f0`): `GET /api/organizations` takes `skip`
  and sorts on `_id` as the tie-break. `useOrganizations` reads 500-row
  pages until a short one, so the pickers and the organizations tab no
  longer stop at the 100th organization.
- **#1282, open** (`a94ae99f`): half done. The list readers page; the five
  specs that leave organizations on the volume still do (its comment
  names them and the cleanup ordering they need).

## Test runs this sitting

| run | scope | result | commit | time |
|---|---|---|---|---|
| `npm run typecheck:e2e` (root) | full | clean | `ea35c4a1`, `a94ae99f` | seconds |
| vitest, files naming `patient.service` or `models/Patient` | 31 files | 947/947; mutation probe failed the new test | `ddfb6171` | 46 s |
| backend `npm run test:architecture` | full | 162/162 (three times, once per fix) | `ddfb6171`, `66f8c362`, `70b1e4f0` | 42 s each |
| vitest, files naming `paciente.controller`, `models/Patient` or the field lists | 12 files | 596/596; mutation probe failed the new test | `66f8c362` | 28 s |
| vitest `organization.api.test.js`, `rbac-catalog-seed.service.test.js`; frontend `useOrganizations.test.ts` | #1280 | 23/23, 38/38, 3/3 | `70b1e4f0` | seconds |
| frontend `npm run typecheck` | full | clean | `70b1e4f0` | not timed |
| backend `npx vitest run tests/unit tests/integration tests/compliance --maxWorkers=5`, JSON reporter, under `resources.cjs run --runner vitest` | full | **9562/9562** | `a94ae99f` | 708 s |
| `compose build`, every `compose.test.yml` image | full | built | `a94ae99f` | 99.5 s |
| in-container full e2e (`run -d --no-deps --name pw-gate playwright-runner`, `docker wait`), on the 13-service stack with admin bootstrap and the 17-service chain, all `--no-deps` | full | **275 passed, 0 failed**, 0 skipped | `a94ae99f` | 208 s |
| frontend `npx vitest run --maxWorkers=4` | full | **353/353** (42 files) | `a94ae99f` | 30 s |

All three suites ran, because the diff since `25daab7f` touches
`api/backend/`, `frontend/src/` and `tests/e2e/`. The e2e duration was
recorded from another directory, so `resources.cjs history` run here does
not show it. Read it from this table.

## Filed this sitting

- **#1280**, **#1281**: filed, fixed and closed (above).
- **#1282**: filed, half resolved, open.

## Touched, not closed

- **#1282**: the fixture deletes in five specs. Nothing fails today; the
  cost is volume growth. This is the workable follow-on.
- **#1227** and **#1234**: still waiting on a recurrence. This sitting's
  e2e run passed with neither recurring.
- **#1229**: deferred by Denise's Axis E decision. Not re-checked this
  sitting.

## For Dennis

- Waiting on the question in each title: #1254, #1257 and #1271.
- Unchanged: #284's milestone line, #1222, #1225, #1228, #1220 step 5, the
  #941 re-close, #1218, #956, #979, whether `0d87f73b` (#1124) stands,
  Denise's `docs/` deletions and #1231, and the go for a PR into `main`.

## Docker and the machine

- **Nothing is running.** The engine was off at the start, and this sitting
  started it. Then `compose down` ran, the build cache was pruned
  (2.214 GB), `docker desktop stop` ran, and `wsl --shutdown`. The named
  volumes are kept, and so are the images built from `a94ae99f`'s sources.
- `netsh ... excludedportrange` showed no reserved block over 8086 today,
  so Influx's default port worked.

## Things a next session must not undo

Earlier notes' items still hold. Plus:

- **`PUT /api/patients/:id` refuses `Patient.SERVER_MANAGED_FIELDS`.** The
  consent flows write those through their own service paths. Re-opening
  any of them to the route reopens #1281.
- **`updatePatient`'s type map checks DECLARED keys only.** Unit tests call
  the service with keys the controller would refuse (`alphaGal`, `height`),
  and the controller's allow-list is where unknown keys are refused.
- **A spec that asserts "my fixture is listed" pages
  (`findOrganizationInList`)**, rather than asking for one page.

## Standing context: re-measure, don't copy

- Denise's newest live branch, 2026-10-02: `stabilize/v2.0.0-prototype`,
  last commit 2026-09-26
  (`git for-each-ref refs/remotes/origin --sort=-committerdate`).
- Divergence, 2026-10-02: 936 commits on hers only and 279 on ours only
  (`git rev-list --left-right --count origin/stabilize/v2.0.0-prototype...HEAD`),
  measured before this rotation's commit.
- Her tip's CI, runs of 2026-09-26 14:05 (none newer): release manifest
  integrity, Full Vitest diagnostic, Coverage diagnostic and current-state
  validation all passed (`gh run list --branch stabilize/v2.0.0-prototype --limit 4`).
- Her `docs/stabilization/AXIS_E_DECISION_LOG.md` is still read only for
  MFA and password rows, and for #1229's verb-split row.

## Recommended next

None queued by Dennis. No `suite-red` issue is open (`gh issue list
--label suite-red`). #1282's remaining half is the workable follow-on.
