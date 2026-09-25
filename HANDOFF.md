# HANDOFF

**Written 2026-09-24, fifty-ninth queue sitting. INTERIM: the sitting may
continue. It has not been told it is over.**

The instruction was "Pick next group of issues. Docker is on." The group
was the previous note's "not yet laddered" set: #1108, #1196, #1197 and
#1200. All four are closed. Walking them also produced #1204 and #1205,
both fixed and closed, plus #1206 and #1207, both filed and open.

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive
commit is `8ca5b95b` (#1196, #1197).

## What shipped

- **#1108**, `8e69902a`: `utils/validations.ts` keeps only
  `validateThresholds`, and `utils/logMethods.ts` is deleted.
- **#1204**, `d693f5a1`: the disease seed keyed Gaucher to ORPHA 79258
  (GSD Ia) and Duchenne to 58 (Alexander disease), per Orphanet's API.
  They are now re-keyed to 355 and 98896.
- **#1200**, `277aa315` (comments only): `disease_dictionary` is recorded
  as a legacy, manual-only store, and the validator stays on its defaults.
  The canonical replacement is #1206.
- **#1205**, `8e85431f`: `APP_DOMAIN` is dropped. `c5d8b54a` (#1203) had
  left it unread, so the architecture suite was at **150/151**. The last
  note's 151/151 predated that. Now 151/151.
- **#1196 + #1197**, `8ca5b95b`:
  - #1196: the policy form pre-fills `minimumDuration: 30`, relabelled
    "Duração Mínima da Excursão".
  - #1197: `targetTemp` is removed from the policy, in the schema, API,
    type, validator and UI. The setpoint's canonical home is v2.0.0
    ELM-0175 `StorageAssignment.nominalTemperature`, which matches
    `StorageContainer.temperature`.
  - Both close comments carry the law, standards, literature and precedent
    walk, with quotes.

Verification:
- **Native:** every touched test file passes: 65/65 (seed and dictionary),
  227/227 (policy), and architecture 151/151. Pin probes were run for
  #1204 and #1197.
- **Live:** on `compose.test.yml` (`backend-app-test` and
  `frontend-app-test` built from `8ca5b95b`'s tree, before the commit),
  `temperature-policies-ui` and `sensor-registration` pass 7/7 with 0
  skipped. The e2e assertions were not pin-probed.

## Filed, open, not worked

- **#1207 (bug, not worked, I chose to stop):** on `POST /api/iot/telemetry`,
  the first out-of-range reading quarantines all of that sensor's samples.
  `minimumDuration` gates only `TelemetryMonitor`'s Neo4j `COMPROMISED`
  mark. The issue body has the remedy direction and one open design point:
  which scheduling shape fits the incident lifecycle.
- **#1206 (enhancement):** build v2.0.0 `BiomarkerAssociation`. No RF/RNF
  requires disease-gated release, per #1200's second comment.

## Still genuinely Dennis's

- Whether to mirror Denise's `docs/mestrado/` and
  `docs/planning/bioavanced-v3/` deletions (unverified this sitting;
  carried from the last note).
- The go for a PR into `main`.

For the rest of the question backlog, run `gh issue list --state open
--label question`, redirect it to a file, and grep it rather than reading
it whole.

## Docker and the machine

- **Gate:** Dennis, 2026-09-24: "Docker is on." It closes at the next
  `/clear`.
- **The test stack is down.** Its `mongodb-test-data` volume persists, and
  the bootstrap admin logged in with `Admin@123` (200) before the run.
  Images were rebuilt from this sitting's tree.

## Things a next session must not undo

Earlier notes' items still hold. Plus:
- **A temperature policy has no `targetTemp`** (`policy.routes.test.js`,
  `#1197` block). A caller that sends one has it dropped.
- **The disease seed's explicit rules are keyed 324/355/98896**
  (`seedDiseaseValidationRules.script.test.js`, `#1204`).

## Standing context: re-measure, don't copy

- Denise's newest live branch, 2026-09-24: `stabilize/v2.0.0-prototype`
  (`git for-each-ref refs/remotes/origin --sort=-committerdate`).
- Divergence, 2026-09-24: 914 commits on hers only, 149 on ours only
  (`git rev-list --left-right --count origin/stabilize/v2.0.0-prototype...HEAD`).
- Her tip's CI, 2026-09-24 23:29: current-state validation, Full Vitest
  diagnostic and Coverage diagnostic passed. Release manifest integrity
  failed (`gh run list --branch stabilize/v2.0.0-prototype --limit 4`).

## Recommended next

None queued by Dennis. The branch has not passed the full gate since
`5fc5c843`.
