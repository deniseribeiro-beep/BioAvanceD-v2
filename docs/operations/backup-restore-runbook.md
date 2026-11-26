# MongoDB, Neo4j and InfluxDB backup and restore runbook

Answers RNF006 C2 ("Documentar ... backup, restauração") and the backup and continuity part of RNF013 C2. Written 2026-10-25. It describes what the code does at this commit, nothing more; everything RNF010 asks for that the code does not do is listed under [Gaps](#10-gaps-rnf010), never as a procedure. Tracking issue: #1325.

Sources: `api/backend/src/services/backup.service.js`, `backup-stores.service.js`, `backup-offsite.service.js`, `backup-policy.service.js`, `scheduler.service.js`, `api/backend/src/interface/routes/backup.routes.js`, `backupPolicy.routes.js`, `compose.prod.yml`, `.env.production.example`, `api/backend/Dockerfile.prod`.

## 1. What is backed up

Three stores, in the same run and the same folder. Nothing else is backed up; see section 10.

- **MongoDB**: the database named by `MONGO_URI` (or `MONGO_DB` when set). `performBackup` runs `mongodump --uri=... --out=<dir>`. When the `mongodump` binary is missing, it falls back to a per-collection JSON export (`writeJsonBackup`, one `<collection>.json` per collection). `Dockerfile.prod` installs `mongodb-tools`, so a production image takes the `mongodump` path, and a restore uses `mongorestore`.
- **Neo4j**: a logical export of the database `NEO4J_DATABASE` (default `neo4j`), through its own driver connection: every node (element id, labels, properties) and every relationship (element id, type, start and end node ids, properties), read in one read transaction, and the `createStatement` of every constraint and of every index that no constraint owns (lookup indexes excluded). Every property value is written with its type (integer as a string, float, date, datetime, localdatetime, localtime, time, duration, point; strings, booleans, null and lists as themselves), so integers past 2^53 and floats like `1.0` keep their exact value. A property of any other type fails the run rather than being written lossily.
- **InfluxDB**: every point in `INFLUXDB_BUCKET` (org `INFLUXDB_ORG`) from 1678-01-01 to 2262-01-01, so future-stamped points are included: measurement, field, time, tags, the value as the raw string InfluxDB returned, and its type (`double`, `long`, `unsignedLong`, `boolean` or `string`).

The Neo4j and InfluxDB exports run after the MongoDB dump, in both the `mongodump` and the JSON-fallback paths. A store none of whose variables is set (Neo4j: `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`; InfluxDB: `INFLUXDB_URL`, `INFLUXDB_TOKEN`, `INFLUXDB_ORG`, `INFLUXDB_BUCKET`) is skipped, recorded as `{ "status": "skipped", "reason": "not_configured" }`. A store with only some of them set fails the run (section 6).

## 2. Where it lands

- Base directory: `BACKUP_DIR`. `.env.production.example` sets `/data/backups`, which is the `backups_data` named volume that `compose.prod.yml` mounts into both `backend` and `worker`. Without `BACKUP_DIR` the default is `api/backend/backups`, which is not writable in the read-only production container.
- One folder per run, named `YYYY-MM-DD`. When that folder already exists (a second run on the same day), the name gets a `_H-M-S` time suffix.
- Each folder holds a `manifest.json` with `type` (`mongodump` or `json-fallback`), `dbName`, `createdAt`, and `checksum`: a sha256 over every file in the folder except `manifest.json` itself. When the run was encrypted, a `mongodump` manifest also holds `encrypted: true` and `encryptedFiles`, one entry per dump file with its algorithm, key id, IV and tag.
- The Neo4j export is in the folder's `neo4j/` subfolder (`nodes.ndjson`, `relationships.ndjson`, one JSON object per line, and `schema.json`), the InfluxDB export in `influxdb/` (`points.ndjson`). The manifest's `stores` field holds one entry per store: `neo4j` (`status`, `database`, `nodes`, `relationships`, `files`) and `influxdb` (`status`, `bucket`, `org`, `points`, `files`), or the skipped result of section 1. The run's response carries the same `stores`. The checksum covers these files too.
- Off-site copy (`backup-offsite.service.js`), run after `manifest.json` is written and before retention, in both the `mongodump` and the JSON-fallback paths:
  - Settings: `BACKUP_OFFSITE_S3_ENDPOINT`, `BACKUP_OFFSITE_S3_BUCKET`, `BACKUP_OFFSITE_S3_ACCESS_KEY_ID`, `BACKUP_OFFSITE_S3_SECRET_ACCESS_KEY`, and `BACKUP_OFFSITE_S3_REGION` (default `us-east-1`). None of the four set: the copy is off, recorded as `{ "status": "skipped", "reason": "not_configured" }`. Only some of them set: every run fails (section 6). An endpoint with a query, a fragment or credentials, or a bucket name S3 does not allow, fails the run too.
  - Only an encrypted run is copied. A run with encryption off is recorded as `{ "status": "skipped", "reason": "not_encrypted" }`, with a warning logged, and nothing is sent.
  - Each file of the run's folder is sent by a signed `PUT` (AWS Signature Version 4, path-style `<endpoint>/<bucket>/<key>`) to the key `backups/<folder>/<path>`, one file at a time, with `manifest.json` last: a manifest present in the bucket means every other file of the run is there. The manifest is plaintext metadata (names, counts, checksum, encryption envelopes), no record data.
  - Only files the run's `manifest.json` accounts for are sent: the manifest itself, the files listed in its `encryptedFiles` (`mongodump`) or `collections` (JSON fallback), and each store's `stores.<store>.files`. Before any request, a file in the folder that the manifest does not list fails the copy, and with it the run (`Cópia off-site falhou: <path> não consta do manifest.json.`), and nothing is sent. This covers a plaintext dump file that a failed `mongodump` run left behind in a folder the JSON fallback then reused. A `manifest.json` that cannot be parsed fails the copy too.
  - Every `PUT` carries `If-None-Match: *`, so an object already in the bucket is never overwritten; the bucket answering 412 fails the run.
  - On success the result is `{ "status": "uploaded", "bucket": ..., "prefix": "backups/<folder>/", "files": <count> }`. The run's response and its `backupHistory` row carry it in the field `offsite`.
  - The code deletes nothing in the bucket and reads nothing back from it. Off-site retention is a lifecycle rule set on the bucket.

## 3. Encryption

- The BackupPolicy's `encryptionEnabled` defaults to `true`.
- With encryption on, each dump file is encrypted in place (AES-256-GCM, the same file crypto the uploads use) after `mongodump` finishes and **before** the checksum, so the manifest checksum is over the ciphertext.
- The Neo4j and InfluxDB files are encrypted the same way, each once its export is complete and before the checksum. Their envelopes are in `stores.<store>.files` (`file`, `encrypted: true`, algorithm, key id, IV, tag), not in `encryptedFiles`. With encryption off, each entry is `{ "file": ..., "encrypted": false }`.
- With encryption on and no `ENCRYPTION_KEY` configured, the backup aborts before `mongodump` runs. It never writes plaintext in that case.
- A run whose policy cannot be read fails and writes no backup: when the `backup_policy` read throws, it records `status: error` in `backupHistory`; with no database handle it is logged as an error and no history entry is written. Only a policy read with `encryptionEnabled: false` writes plaintext; a policy without a boolean `encryptionEnabled` encrypts.
- Restoring an encrypted backup needs the key whose id the manifest's `encryptedFiles` entry records: the current pair `ENCRYPTION_KEY` / `ENCRYPTION_KEY_ID`, or, after a rotation, the previous pair `ENCRYPTION_KEY_PREVIOUS` / `ENCRYPTION_KEY_PREVIOUS_ID` (see the rotation steps in `.env.production.example`). Emptying the previous slot makes every backup taken under the old key unreadable.
- **A lost key makes every encrypted backup unreadable. The key is not in the backup**, and the code escrows it nowhere. Keeping the key safe, apart from the backups, is a deployment duty.

## 4. Schedule

- At boot the backend starts the backup cron on `BACKUP_CRON` (default `0 3 * * *`), in the timezone `TZ` (default `America/Sao_Paulo`), then applies the stored BackupPolicy's `cronExpression`. A `PUT /api/backup-policy` that changes it re-schedules with no restart. The scheduler runs wherever the backend runs; there is no `NODE_ENV` gate.
- If the policy lookup fails, or the stored expression is one node-cron refuses, the running schedule is kept and an error is logged; `BACKUP_CRON` is used only when no schedule is running.
- `BACKUP_CRON` is also the default `cronExpression` of a new policy row, and the PUT rejects an expression that is not a string or that node-cron refuses.

## 5. Retention

- Retention in days: the policy's `retentionDays` (minimum 30, enforced by `validatePolicy`), else `BACKUP_RETENTION_DAYS`, else 30.
- After each **successful** run, every folder under the base directory whose `YYYY-MM-DD` name (or, for a folder not so named, its mtime) is older than that is deleted. A failed run deletes nothing.

## 6. Run a backup by hand

- `POST /api/backup/perform`: authenticated, permission `manageBackup`, which the RBAC seed grants to the Administrador role. Or the Backup page (`/backup`, Administrador only).
- Each run writes one `backupHistory` row: `startedAt`, `completedAt`, `status` (`success`, `skipped` or `error`), `mode`, `path`, `checksum`, `error`, `offsite`.
- `GET /api/backup/list` lists the backup folders, newest first, each with its size, dates and the `status` and `checksum` of its `backupHistory` row.
- After a manual run, confirm the response has `success: true` and a `checksum`, and that `GET /api/backup/list` shows the new folder with status `success`.
- A failed Neo4j or InfluxDB export (the store unreachable, partly configured, or holding a value the export cannot type) fails the whole run: the response has `success: false` and an `error` naming the store (`Backup de Neo4j falhou: ...` or `Backup de InfluxDB falhou: ...`), the `backupHistory` row has status `error`, and the folder gets no `manifest.json`, so a restore test of it fails. Retention deletes nothing after such a run (section 5).
- A failed off-site copy (partial settings, an invalid endpoint or bucket, the bucket unreachable, or a `PUT` answered with any status but 200) fails the whole run, at the first failed file: the response has `success: false` and an `error` starting `Cópia off-site falhou`, which names neither the endpoint nor a credential, and the `backupHistory` row has status `error`, with the run's `path` and `checksum` in the `mongodump` path (the JSON-fallback path records neither). The local folder and its `manifest.json` stay, and retention deletes nothing after such a run (section 5).

## 7. Policy

`GET /api/backup-policy` and `PUT /api/backup-policy`: Administrador only (access level 4). The policy is one row (`_id: 'main'`) in the `backup_policy` collection, created with defaults on first read. Fields and the validation `validatePolicy` applies:

| Field | Default | Validation |
|---|---|---|
| `cronExpression` | `BACKUP_CRON`, else `0 3 * * *` | five whitespace-separated fields that node-cron accepts |
| `retentionDays` | `BACKUP_RETENTION_DAYS`, else 30 | number >= 30 |
| `encryptionEnabled` | `true` | boolean |
| `rpoHours` | 24 | 1 to 24 |
| `rtoHours` | 12 | 1 to 12 |

`rpoHours` is checked by the platform alert `BACKUP_RPO`: every `PLATFORM_ALERT_CRON` run reads the age of the newest `backupHistory` row with status `success`, and the alert fires past `rpoHours`, or when runs are recorded and none succeeded; before the first run it is unknown. `rtoHours` is compared with each restore test's wall time (section 9). Each changed field is written to the audit log.

## 8. Restore

`POST /api/backup/restore/:fileName` (permission `manageBackup`), where `fileName` is a folder name from `GET /api/backup/list`.

A restore or restore test reads only a folder under `BACKUP_DIR`, never the bucket: an off-site copy is first copied back into `BACKUP_DIR/<folder>` with any S3 client (prefix `backups/<folder>/`), then restore-tested (section 9) like any other folder.

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
2. for each store recorded `exported` in `manifest.stores`, decrypts its files into a scratch folder under `RESTORE_SCRATCH_DIR` (removed afterwards), parses every line, and checks the line counts and the relationship endpoints against the manifest, without connecting to Neo4j or InfluxDB. The result field `stores` holds `verified` (with the counts), `skipped` or `failed` (with its `error`) per store, or `null` for a folder written before the exports existed;
3. decrypts an encrypted backup into a scratch copy, as in section 8;
4. restores into a scratch database `<db>_restoretest_<ms>`, never the live one;
5. counts the restored collections and documents (`restoredCollections`, `restoredDocuments`);
6. drops the scratch database on every exit path, and writes one `restoreTestHistory` row (`status`, `mode`, `scratchDb`, `checksumVerified`, `restoredCollections`, `restoredDocuments`, `stores`, `durationMs`, `rtoHours`, `withinRto`, `error`). A run that succeeds slower than `rtoHours` logs `Teste de restauração excedeu o RTO` as an error; its `success` is unchanged.

A run whose checksum does not match, or whose folder has no manifest checksum, still restores into the scratch database for its counts, but reports `success: false` with `checksumVerified: false` and an `error`, and records `status: error`; the scheduled run logs an error (`Teste de restauração periódico falhou`). A store that fails its check fails the run the same way, with an `error` naming the store. When dropping the scratch database fails, the error log names it, for removal by hand.

## 10. Gaps (RNF010)

RNF010: "A plataforma deve adotar estratégia de backup 3-2-1, com cópias criptografadas e restauração testada." Each row lists what is **not implemented**; none of it is a procedure the code runs. Tracking issue: #1325.

| Criterion | What the code does today | Gap |
|---|---|---|
| RNF010 C1, 3-2-1 ("pelo menos três cópias, em duas tecnologias ou mídias, com uma cópia fora do ambiente principal") | One copy in the `backups_data` volume on the same Docker host as the data; when the `BACKUP_OFFSITE_S3_*` settings are set, a second copy of each encrypted run in an S3-compatible bucket (section 2). | Not implemented: the off-site copy is not live until the bucket, endpoint and credentials are set, and they have not been provided; a plaintext run is not copied; that is still two copies, not three; the code sets no off-site retention and never verifies the off-site copy. |
| Redis | Not backed up. Its data lives in the `redis_data` volume. | Not implemented: no backup of Redis. |
| Neo4j and InfluxDB restore | Each run exports both (section 1); the restore test decrypts and parses both exports (section 9) but loads them into no database. The Neo4j node and relationship queries run in one read transaction, which is not a point-in-time snapshot across the two. | Not implemented: no restore of either export into Neo4j or InfluxDB, and no load into a scratch instance (Neo4j Community has a single database); the Neo4j export is not a point-in-time snapshot, so a write between its two queries fails the restore test's endpoint check. |
| File binaries | Uploads and stored files live in `uploads_data` and `storage_data` (and in an object store when `OBJECT_STORE_DRIVER` configures one). Not backed up. | Not implemented: no backup of file binaries. |
| TSA and witness keys | `tsa_certs`, `tsa_state`, `tsa_secrets` and `witness_secrets` are not backed up; `compose.prod.yml` records that losing them invalidates previously issued timestamps and signatures. | Not implemented: no backup of these volumes. |
| Encryption key | The key is not in the backup and the code escrows it nowhere (section 3). | Not implemented: no key escrow. |
| RNF010 C2, RPO 24 h ("até 24 horas") | `rpoHours` is stored and validated (1-24); the platform alert `BACKUP_RPO` fires when the newest successful backup is older than it, or when runs are recorded and none succeeded (section 7). | The age is read from `backupHistory`, not from the folders on disk or the off-site bucket; the alert is a `platformAlerts` episode and a `platform_alert` notification, delivered only where a NotificationRule for it exists. |
| RNF010 C3, RTO 12 h ("até 12 horas") | `rtoHours` is stored and validated (1-12); each restore test records its wall time (`durationMs`) and `withinRto` against it, and logs an error past it (section 9). | Not implemented: no timed full recovery; the restore test's time covers a MongoDB restore into a scratch database and a parse of the other exports, a lower bound of a full recovery. |
| RNF010 C5, periodic restore test validated by checksum | Weekly restore test of MongoDB, with a parse check of the Neo4j and InfluxDB exports (section 9); a checksum mismatch or a failed store check fails the run and is logged as an error. | Not implemented: no load of the Neo4j and InfluxDB exports, no full-system restore has been run, no restore test reads the off-site copy (it must be copied back first, section 8), and no alert is raised beyond the error log. |
| Restore integrity | A restore does not verify the manifest checksum and takes no safety backup (section 8). | Not implemented: no checksum check or safety backup before a live restore. |
