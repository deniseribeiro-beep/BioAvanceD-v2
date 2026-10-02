# HANDOFF

**Written 2026-10-02, eighty-first queue sitting. INTERIM: the sitting ran
its end sequence (audit, suites, push, issues, clean-up), but Dennis has
not said it is over.**

The instruction was: "pick next group of issues and resolve them". The
group was **#1257**, **#1254** and **#1271**, which carried decided options
to implement, and **#1282**'s remaining half.

## Repo state

The branch is `feature/docker-e2e-backend-integration`, pushed. The last
code commit is `4686fb38`.

## What shipped (all closed)

- **#1257** (`a4c3c43f`, `11407c8a`): a new deployment's password defaults
  follow NIST SP 800-63B-4.
  - `minLength` 15 is the single-factor floor. The new `minLengthWithMFA`
    8 applies to an account enrolled in MFA. The composition flags are off
    and `expirationDays` is 0.
  - A database with **no** `security_config` document reads as the new
    defaults. A stored document reads exactly as before.
  - `createFirstAdmin` checks the stored policy, and only when it is
    creating the admin.
  - `minLengthWithMFA` is declared catalog drift in
    `canonical-catalog-conformance.arch.test.js`.
- **#1254** (`757b890f`): `session.allowMultipleSessions` defaults to true
  and is wired. False ends the user's other sessions at sign-in, with
  reason `admin_action`. A boot-time rewrite turns a stored false that no
  administrator audit row backs into true, once (`systemBootstrap` marker
  `allow_multiple_sessions_default_v1`). It ran on the e2e volume and
  logged `rewritten`.
- **#1271** (`6498200e`): `logs_archive` retention and access.
  - The RetentionPolicy fields `archiveRetentionPeriod` and
    `archiveRetentionBasis` set it. Without them, an `archive` policy
    deletes instead of archiving.
  - `GET /api/logs/archive`, and `?source=archive` on the list and export
    routes, are behind the audit-reader rule.
- **#1282** (`4686fb38`): the five specs delete their organizations in
  `afterAll` (`deleteOrganizations` in `tests/e2e/helpers/listOrganizations.ts`).

## Test runs this sitting

| run | scope | result | commit | time |
|---|---|---|---|---|
| vitest, password/config/policy test files (several rounds) | targeted | green after test updates; one mutation probe on #1254's branch failed the new test | per fix | seconds each |
| backend `npm run test:architecture` | full | **162/162** (first run 161/162: the drift fixed in `11407c8a`) | `6498200e` | ~42 s |
| frontend `npm run typecheck`, root `npm run typecheck:e2e` | full | clean | `a4c3c43f`, `4686fb38` | not timed |
| frontend `npx vitest run --maxWorkers=3` | full | **354/354** | `4686fb38` | not timed |
| backend `npx vitest run tests/unit tests/integration tests/compliance --maxWorkers=6`, JSON reporter, under `resources.cjs run --runner vitest` | full | **9597/9604, red**: 7 cases in two route-test files, filed as **#1287** | `4686fb38` | 666 s |
| `compose build`, every `compose.test.yml` image | full | built | `4686fb38` | not timed |
| in-container full e2e (`run -d --no-deps --name pw-gate playwright-runner`, `docker wait`), on the 13-service stack with admin bootstrap and the 17-service chain | full | **275 passed, 0 failed** | `4686fb38` | 222 s |

The suite ran before the friction audit, against the sitting order. The
audit changed no code, so the run stands.

## Filed this sitting (open)

- **#1287** `suite-red`: seven route tests send passwords under 15
  characters to a database with no stored policy. **First in the next
  group.**
- **#1283**: the test stack's `Admin@123` and 29 e2e fixture passwords
  would fail on a **fresh** volume. Changing it means changing the
  persistent volume's admin password in the same sitting.
- **#1284**: `DELETE /api/organizations/:id` checks no references.
- **#1285**: security review of this sitting's commits.
- **#1286**: which legal obligation keeps the audit logs, for a
  `logs_archive` policy to cite.

## Touched, not closed

- **#1227** and **#1234**: still waiting on a recurrence. Neither recurred
  in this sitting's e2e run.
- **#1229**: deferred by Denise's Axis E decision. Not re-checked.

## For Dennis

- Unchanged from the last note, and not re-checked this sitting: #284's
  milestone line, #1222, #1225, #1220 step 5, the #941 re-close, #956,
  #979, Denise's `docs/` deletions, and the go for a PR into `main`.
  The last note's #1228, #1218, #1231 and #1124 items are closed and
  dropped here.
- **Re-check each against the tracker before repeating it.**

## Docker and the machine

- **Nothing is running.** The sitting started the engine, then ran
  `compose down` (volumes kept), pruned the build cache (10.65 MB),
  ran `docker desktop stop` and `wsl --shutdown`.
- The persistent volume now holds `session.allowMultipleSessions: true`,
  from #1254's boot rewrite.

## Things a next session must not undo

Earlier notes' items still hold. Plus:

- **A database with no `security_config` document is a NEW deployment**
  and takes the NIST defaults (15/8, no composition, no expiry). A test
  that relies on the old defaults has to store the policy it means.
- **`validateStrength` takes the account as its third argument.** A
  password writer that drops it falls back to the single-factor floor.
- **`createFirstAdmin` checks the password only after the users-exist
  check.** Moving it back would stop an existing deployment's bootstrap.
- **An `archive` RetentionPolicy without `archiveRetentionBasis` deletes
  logs.** That is deliberate (LGPD art. 16).

## Standing context: re-measure, don't copy

- Denise's newest live branch at the last note was
  `stabilize/v2.0.0-prototype`. It was not re-measured this sitting.

## Recommended next

#1287 (`suite-red`) first, then #1283 with an e2e gate, then #1284.
