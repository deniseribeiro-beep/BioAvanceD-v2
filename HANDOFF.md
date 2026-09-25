# HANDOFF

**Written 2026-09-25, sixty-fourth queue sitting. INTERIM: the sitting may
continue. It has not been told it is over.**

The instruction was "Read handoff. Pick next group of issues. Docker is on."
The group was the rest of the RF008 reports cluster: **#733**, **#735** and
**#1215**, plus **#941**, which Dennis put back in scope mid-sitting. Working
them surfaced **#1217** and **#1218**.

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive
commit is `8fe19c40` (#1217).

## What shipped

- **#733**, `bde77f88`, closed: the Auditoria report reads the AuditEvent
  trail (`audit_events`) through a new `auditEvents` handler. Logs de acesso
  keeps `logs`. RF008 in requisitos v4.0.0 names AuditEvent.
- **#735**, `76c0b146`, closed: custom report templates are cards on the
  report menu. The query page labels them and groups their filters by the
  handler that `GET /:type/filters` now names.
- **#1215**, `9362ffd5`, closed: the location filter is a freezer-then-box
  picker (`type: 'storageBox'` in the catalog).
- **#1217**, `8fe19c40`, closed: ReportViewPage titles a custom-template
  report by the template's name.
- `d0429eb5`, Refs #1202: `access.api.test.js` realigned with #1202's grant
  contract. It had been red since `33ccf1a6`/`1caaf538`.

Proof is in each close comment.

## The gate this sitting ran

The first full gate since `5fc5c843`, run on tip `d0429eb5`:
- Backend vitest 9,205/9,205, after the access fix.
- Architecture 155/155.
- seed/dictionary/compliance steps exit 0.
- Frontend 328/328.
- **Playwright 251/251, 0 skipped**, on a fresh-volume stack
  (`-p bioavanced-fresh`, so the accumulated `bioavanced-test` volume was
  untouched), with the admin bootstrap and the 17-service chain.

`8fe19c40` came after the gate; it was proven by its own component test.

## Open, touched this sitting

- **#941**, open, Denise reopened it on 09-23. Our-branch live proof is
  posted: 0/23 declared indexes at boot, 23/23 after our own read/write
  paths on fresh volumes. Re-closing over her reopen is Dennis's call.
- **#1202**, open: progress comment only (the test alignment above).
- **#1218**, open (question): decision record for the audit-trail export
  surface. Column set, and a name-derived pseudonym for pre-anonymization
  rows.
- **#1216** (carried from the last sitting, untouched): retiring
  `sampleID` from the create response.

## For Dennis

- Whether to re-close #941 (proof posted; she reopened it), and #1218.
- Still yours from before: #956, #979, whether `0d87f73b` (#1124's port of
  Denise's service file) stands, whether to mirror Denise's
  `docs/mestrado/` and `docs/planning/bioavanced-v3/` deletions, and the go
  for a PR into `main`.

## Docker and the machine

- **Gate:** Dennis, 2026-09-25: "Docker is on." It closes at the next `/clear`.
- **Nothing is running.** The `bioavanced-fresh` project was taken down with
  `-v`, and its 24 images and the build cache were removed. The
  `bioavanced-test` images and `mongodb-test-data` predate `bde77f88`, so
  the next bring-up needs `--build`.
- The reserved-port ranges moved: 8086 was free today
  (`netsh interface ipv4 show excludedportrange protocol=tcp`), so check
  before reaching for `INFLUXDB_HOST_PORT`.

## Things a next session must not undo

Earlier notes' items still hold. Plus:
- **`audit` and `access_logs` are different reports.** `audit` →
  `auditEvents` → `audit_events`. A new audit-reading handler joins
  `AUDIT_READER_HANDLER_KEYS` and `EXPORT_CATALOG`.
- **A custom template renders through its handler's system type.**
  `resolveSectionKey`'s map must gain an entry for any new handlerKey.
- **`storageBoxId` is a `storageBox` catalog type**, not text. Its e2e
  drives the picker by freezer and box `_id`.

## Standing context: re-measure, don't copy

- **The project phase (Dennis, 2026-09-25):** we are working down the issues
  the e2e plan surfaced (Wave 3 tracker #646). CI comes only after they are
  all resolved and the whole plan passes on Docker, so it is far off. The
  proof bar now is our tests plus our Docker e2e on this branch. A
  collaborator's "resolved" proves nothing here until that bar is met.
- Denise's newest live branch, 2026-09-25: `stabilize/v2.0.0-prototype`,
  last commit 2026-09-24
  (`git for-each-ref refs/remotes/origin --sort=-committerdate`).
- Divergence, 2026-09-25: 914 commits on hers only, 173 on ours only
  (`git rev-list --left-right --count origin/stabilize/v2.0.0-prototype...HEAD`),
  measured before `8fe19c40`.
- Her tip's CI, runs of 2026-09-24 23:29 (none newer): current-state
  validation, Full Vitest diagnostic and Coverage diagnostic passed. Release
  manifest integrity failed
  (`gh run list --branch stabilize/v2.0.0-prototype --limit 4`).

## Recommended next

None queued by Dennis.
