# Security exception register

Answers RNF013 C3 ("Exceções de segurança possuem aprovação, prazo e risco residual"). Written 2026-10-25; describes the code at this commit. Tracking issue: #1325.

## The rule

A security exception is in force only while this file holds an entry for it with every one of these fields:

| Field | Content |
|---|---|
| ID | `EX-001`, `EX-002`, and so on |
| Control relaxed | The control and the setting that relaxes it |
| Scope | Which deployment or environment, and which data |
| Justification | Why the control cannot hold there |
| Approver | A role, never a person's name, and the approval record (an issue or a decision file under `docs/decisions/`) |
| Approval date | |
| Expiry date | The exception lapses on this date unless renewed by a new approval |
| Residual risk | What remains exposed while the exception holds |
| Compensating controls | What is done instead |
| Status | Active, Expired or Withdrawn |

An entry missing any field is not an approved exception.

## Current register

**No approved exceptions.**

## Switches that create an exception when set

The code honours these settings, each of which relaxes a control. Setting one in any deployment other than local development requires an entry above first.

| Setting | Where the code reads it | Effect |
|---|---|---|
| `ALLOW_UNENCRYPTED_FILE_STORAGE=true` | `api/backend/src/utils/fileCrypto.js` | With no `ENCRYPTION_KEY`, uploads are stored in plaintext instead of being refused. Only the exact string `true` counts. |
| `ALLOW_UNENCRYPTED_FIELD_STORAGE=true` | `api/backend/src/utils/fieldEncryption.js` | With no `ENCRYPTION_KEY`, sensitive fields (civil identity, clinical values) are stored in plaintext instead of the write being refused, and a production backend starts without a key. Only the exact string `true` counts. |
| `CORS_ALLOW_ALL=true` (or `1`) | `api/backend/src/config/env.js:134` | The backend allows cross-origin requests from any origin instead of only `ALLOWED_ORIGINS`. |
| BackupPolicy `encryptionEnabled=false` | `api/backend/src/services/backup-policy.service.js`, set by `PUT /api/backup-policy` | MongoDB backups are written in plaintext. |
