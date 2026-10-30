# 2026-10-29: production loads the essential reference set via compose one-shots; full packs and operational data arrive by restore or operator-run import

Requirements RF022 AC7, RF028; issue #978 item 4.

## The question

`compose.prod.yml` has no `reference-data-bootstrap` service like the dev and test stacks. #978 item 4 asked whether a fresh production stack receives reference data by seeding or by restore, and left the first-admin hand-run as designed. What does production load at bring-up, and what stays out of compose?

## Decided

1. **Essential reference set at bring-up.** `compose.prod.yml` runs `foundation` then `essential-references` (`scripts/seed-essential-reference-data.js` and `scripts/load-essential-references.js`) as one-shot services before `backend` starts. That is the Phase 2 essential set (MIABIS minimal, SPREC minimal, RCS-GOV 1.0) that RF022 AC7 says the Foundation prepares and Phase 2 loads. It is not invented operational data.
2. **First administrator stays hand-run.** `npm run compose:prod:seed-admin` (`createFirstAdmin.js`) is the only way a fresh production stack gets a login. Compose does not seed an admin. That matches #978's "deliberate hand-run" reading and #682's first-deployment checklist.
3. **Full / Fase-2 reference packs are not compose services in production.** Large imports (`reference-data-bootstrap` and the 16 `import-*-reference-dataset.js` scripts) remain operator-run against a live stack, or arrive inside a restore of a backup whose MongoDB already holds those releases. Production does not auto-pull external packs at boot.
4. **Operational clinical data arrives by restore or by live registration**, never by a production seed. A dump-encrypt-restore cycle is already proven on this stack (#978 item 3); that is the supported path for carrying a lab's already-registered participants, samples and files into a new host.

## Why

- Auto-seeding full packs or clinical fixtures in production would invent operational content and blur the restore path the backup runbook already documents.
- The essential set is structural vocabulary the API waits on (backend depends on `essential-references` completing), so it belongs in compose the same way Foundation does.
- Item 2 of #978 (operator-supplied keys left blank) stays on #682's first-deployment checklist; this decision does not mint them.

## Not decided here

- Which host or CI job runs the full pack imports for a given deployment.
- Off-site backup credentials (`BACKUP_OFFSITE_S3_*`), which stay operator-supplied (#1325).
