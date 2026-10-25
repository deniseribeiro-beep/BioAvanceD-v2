# MongoDB backup and restore runbook

Answers RNF006 C2 ("Documentar ... backup, restauração") and the backup and continuity part of RNF013 C2. Written 2026-10-25. It describes what the code does at this commit, nothing more; everything RNF010 asks for that the code does not do is listed under [Gaps](#10-gaps-rnf010), never as a procedure. Tracking issue: #1325.

Sources: `api/backend/src/services/backup.service.js`, `backup-policy.service.js`, `scheduler.service.js`, `api/backend/src/interface/routes/backup.routes.js`, `backupPolicy.routes.js`, `compose.prod.yml`, `.env.production.example`, `api/backend/Dockerfile.prod`.

## 1. What is backed up

**MongoDB only**: the database named by `MONGO_URI` (or `MONGO_DB` when set). Nothing else is backed up; see section 10.

`performBackup` runs `mongodump --uri=... --out=<dir>`. When the `mongodump` binary is missing, it falls back to a per-collection JSON export (`writeJsonBackup`, one `<collection>.json` per collection). `Dockerfile.prod` installs `mongodb-tools`, so a production image takes the `mongodump` path, and a restore uses `mongorestore`.

## 2. Where it lands

- Base directory: `BACKUP_DIR`. `.env.production.example` sets `/data/backups`, which is the `backups_data` named volume that `compose.prod.yml` mounts into both `backend` and `worker`. Without `BACKUP_DIR` the default is `api/backend/backups`, which is not writable in the read-only production container.
- One folder per run, named `YYYY-MM-DD`. When that folder already exists (a second run on the same day), the name gets a `_H-M-S` time suffix.
- Each folder holds a `manifest.json` with `type` (`mongodump` or `json-fallback`), `dbName`, `createdAt`, and `checksum`: a sha256 over every file in the folder except `manifest.json` itself. When the run was encrypted, a `mongodump` manifest also holds `encrypted: true` and `encryptedFiles`, one entry per file with its algorithm, key id, IV and tag.

## 3. Encryption

- The BackupPolicy's `encryptionEnabled` defaults to `true`.
- With encryption on, each dump file is encrypted in place (AES-256-GCM, the same file crypto the uploads use) after `mongodump` finishes and **before** the checksum, so the manifest checksum is over the ciphertext.
- With encryption on and no `ENCRYPTION_KEY` configured, the backup aborts before `mongodump` runs. It never writes plaintext in that case.
- **But** when the policy lookup itself fails (for example the `backup_policy` read throws), `resolveEncryptionEnabled` returns `false` and that run is written **unencrypted**, with only an error log line (`Erro ao buscar política de criptografia de backup, usando padrão`). The same applies to a run with no database handle. This is a gap (section 10).
- Restoring an encrypted backup needs the key whose id the manifest's `encryptedFiles` entry records: the current pair `ENCRYPTION_KEY` / `ENCRYPTION_KEY_ID`, or, after a rotation, the previous pair `ENCRYPTION_KEY_PREVIOUS` / `ENCRYPTION_KEY_PREVIOUS_ID` (see the rotation steps in `.env.production.example`). Emptying the previous slot makes every backup taken under the old key unreadable.
- **A lost key makes every encrypted backup unreadable. The key is not in the backup**, and the code escrows it nowhere. Keeping the key safe, apart from the backups, is a deployment duty.

## 4. Schedule

- At boot the backend schedules the backup from the env var `BACKUP_CRON` (default `0 3 * * *`), in the timezone `TZ` (default `America/Sao_Paulo`). The scheduler runs wherever the backend runs; there is no `NODE_ENV` gate.
- The stored BackupPolicy's `cronExpression` takes over **only after** a `PUT /api/backup-policy` (`reloadBackupSchedule`). A restart goes back to `BACKUP_CRON` until the next PUT.
- The comment in `.env.production.example` saying the policy takes over "once a BackupPolicy row exists" does not match the code; the code is what runs. After a backend restart, a PUT with the same values does not reschedule: the stored `cronExpression` applies only after a PUT that changes it. The working step after a restart is to set `BACKUP_CRON` to the policy's expression (or PUT a different expression and then the intended one).
- This is a gap against RF013 AC6, not intended behaviour (section 10).

## 5. Retention

- Retention in days: the policy's `retentionDays` (minimum 30, enforced by `validatePolicy`), else `BACKUP_RETENTION_DAYS`, else 30.
- After each **successful** run, every folder under the base directory whose `YYYY-MM-DD` name (or, for a folder not so named, its mtime) is older than that is deleted. A failed run deletes nothing.

## 6. Run a backup by hand

- `POST /api/backup/perform`: authenticated, permission `manageBackup`, which the RBAC seed grants to the Administrador role. Or the Backup page (`/backup`, Administrador only).
- Each run writes one `backupHistory` row: `startedAt`, `completedAt`, `status` (`success`, `skipped` or `error`), `mode`, `path`, `checksum`, `error`.
- `GET /api/backup/list` lists the backup folders, newest first, each with its size, dates and the `status` and `checksum` of its `backupHistory` row.
- After a manual run, confirm the response has `success: true` and a `checksum`, and that `GET /api/backup/list` shows the new folder with status `success`.

## 7. Policy

`GET /api/backup-policy` and `PUT /api/backup-policy`: Administrador only (access level 4). The policy is one row (`_id: 'main'`) in the `backup_policy` collection, created with defaults on first read. Fields and the validation `validatePolicy` applies:

| Field | Default | Validation |
|---|---|---|
| `cronExpression` | `BACKUP_CRON`, else `0 3 * * *` | five whitespace-separated fields |
| `retentionDays` | `BACKUP_RETENTION_DAYS`, else 30 | number >= 30 |
| `encryptionEnabled` | `true` | boolean |
| `rpoHours` | 24 | 1 to 24 |
| `rtoHours` | 12 | 1 to 12 |

`rpoHours` and `rtoHours` are stored and validated, but **nothing measures or enforces them** (section 10). Each changed field is written to the audit log.

## 8. Restore

`POST /api/backup/restore/:fileName` (permission `manageBackup`), where `fileName` is a folder name from `GET /api/backup/list`.

What it does:

1. Reads `manifest.json`. When the backup is an encrypted `mongodump`, it decrypts a copy into a scratch folder under `RESTORE_SCRATCH_DIR` (default `<BACKUP_DIR>/.restore-scratch`). That location must be disk-backed: never `/tmp` or any tmpfs, which in `compose.prod.yml` is capped at 64 MB. The original backup folder is not touched, and the scratch copy is removed afterwards.
2. Runs `mongorestore --drop`, which **replaces the live collections** with the backup's.

What it does **not** do: it does not verify the manifest checksum before restoring, and it takes no safety backup of the live data first (section 10). So, before a restore, the operator:

1. Runs a restore test of the same folder (section 9) and confirms the response has `success: true` and `checksumVerified: true`. Do not restore a folder whose test reports `checksumVerified: false` or fails.
2. Runs a fresh backup (section 6) and confirms it succeeded, so the state being replaced can itself be restored.
3. Only then calls `POST /api/backup/restore/:fileName`, and confirms the response has `success: true`.

## 9. Restore test

`POST /api/backup/restore-test/:fileName` (permission `manageBackup`), and a weekly scheduled run on the newest backup folder (`RESTORE_TEST_CRON`, default `0 5 * * 0`, timezone `TZ`).

It:

1. recomputes the folder checksum and compares it with the manifest's (`checksumVerified`);
2. decrypts an encrypted backup into a scratch copy, as in section 8;
3. restores into a scratch database `<db>_restoretest_<ms>`, never the live one;
4. counts the restored collections and documents (`restoredCollections`, `restoredDocuments`);
5. drops the scratch database on every exit path, and writes one `restoreTestHistory` row (`status`, `mode`, `scratchDb`, `checksumVerified`, `restoredCollections`, `restoredDocuments`, `error`).

A run whose checksum does not match still restores and reports `success: true` with `checksumVerified: false`; the scheduled run only logs a warning (`Teste de restauração concluído sem validação de checksum`). Read `checksumVerified`, not only `success`. When dropping the scratch database fails, the error log names it, for removal by hand.

## 10. Gaps (RNF010)

RNF010: "A plataforma deve adotar estratégia de backup 3-2-1, com cópias criptografadas e restauração testada." Each row is **not implemented**; none is a procedure the code runs. Tracking issue: #1325.

| Criterion | What the code does today | Gap |
|---|---|---|
| RNF010 C1, 3-2-1 ("pelo menos três cópias, em duas tecnologias ou mídias, com uma cópia fora do ambiente principal") | One copy, in the `backups_data` volume on the same Docker host as the data. | Not implemented: no second copy, no second medium, no off-site copy. |
| Neo4j, InfluxDB, Redis | Not backed up. Their data lives in the `neo4j_data`, `influxdb_data` and `redis_data` volumes. | Not implemented: no backup of these stores. |
| File binaries | Uploads and stored files live in `uploads_data` and `storage_data` (and in an object store when `OBJECT_STORE_DRIVER` configures one). Not backed up. | Not implemented: no backup of file binaries. |
| TSA and witness keys | `tsa_certs`, `tsa_state`, `tsa_secrets` and `witness_secrets` are not backed up; `compose.prod.yml` records that losing them invalidates previously issued timestamps and signatures. | Not implemented: no backup of these volumes. |
| Encryption key | The key is not in the backup and the code escrows it nowhere (section 3). | Not implemented: no key escrow. |
| RNF010 C2, RPO 24 h ("até 24 horas") | `rpoHours` is stored and validated (1-24); nothing measures it. | Not implemented: RPO is not measured or alerted on. |
| RNF010 C3, RTO 12 h ("até 12 horas") | `rtoHours` is stored and validated (1-12); nothing measures it. | Not implemented: RTO is not measured; no timed full recovery. |
| RNF010 C5, periodic restore test validated by checksum | Weekly restore test of MongoDB only (section 9); a checksum mismatch only logs a warning. | Not implemented: no restore test of the other stores, no full-system restore has been run, and a mismatch raises no alert. |
| Schedule from policy (RF013 AC6) | The boot schedule comes from `BACKUP_CRON`; the policy's `cronExpression` applies only after a PUT (section 4). | Not implemented: the stored policy is not applied at boot. |
| Restore integrity | A restore does not verify the manifest checksum and takes no safety backup (section 8). | Not implemented: no checksum check or safety backup before a live restore. |
| Encrypted copies | A run whose policy lookup fails is written unencrypted, with only an error log (section 3). | Not implemented: no fail-closed encryption when the policy cannot be read. |
