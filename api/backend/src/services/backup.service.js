const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const { MongoClient, BSON } = require('mongodb');
const logger = require('../utils/logger');
const env = require('../config/env');
const backupPolicyService = require('./backup-policy.service');
const { decryptFileBuffer } = require('../utils/fileCrypto');
// #1325: taken as an object, so exportSecondaryStores is looked up per call.
const backupStores = require('./backup-stores.service');
// #1325 (RNF010 C1): taken as an object too, so uploadBackupRunOffsite is looked up per call.
const backupOffsite = require('./backup-offsite.service');

const { assertEncryptionKeyConfigured, encryptFileInPlace } = backupStores;

const DEFAULT_RETENTION_DAYS = 30;

// #728: retention now prefers the admin-editable BackupPolicy over the
// static env var -- runBackup(db) resolves this once per run and threads
// it through to whichever cleanup path performBackup takes, so a policy
// edit is the thing actually governing how long backups are kept, not
// just a stored-but-unused field. Falls back to the env var (then the
// hardcoded default) when db isn't available -- existing callers that
// don't pass one (or run outside a request/scheduler context) keep the
// prior env-only behavior exactly.
async function resolveRetentionDays(db) {
  if (!db) return Number(env.BACKUP_RETENTION_DAYS || DEFAULT_RETENTION_DAYS);

  try {
    const policy = await backupPolicyService.getPolicy(db);
    if (Number.isFinite(Number(policy?.retentionDays))) {
      return Number(policy.retentionDays);
    }
  } catch (error) {
    logger.error('Erro ao buscar política de retenção de backup, usando padrão:', error.message);
  }

  return Number(env.BACKUP_RETENTION_DAYS || DEFAULT_RETENTION_DAYS);
}

// RNF010 C3 (#1484): the policy's rtoHours for the restore test's timing, or
// null. Never throws, so a policy read never changes a run's outcome.
async function resolveRtoHours(db) {
  if (!db) return null;
  try {
    const policy = await backupPolicyService.getPolicy(db);
    const rtoHours = Number(policy?.rtoHours);
    return Number.isFinite(rtoHours) && rtoHours > 0 ? rtoHours : null;
  } catch (error) {
    logger.warn('Não foi possível ler rtoHours da política de backup:', error.message);
    return null;
  }
}

// #1325: unlike resolveRetentionDays, this fails closed. A run whose policy
// cannot be read (no db handle, or the lookup throws) is aborted rather
// than written in plaintext (RNF010: "cópias criptografadas"). Only a
// policy actually read with an explicit encryptionEnabled: false turns
// encryption off; true, a missing field or a non-boolean value encrypts.
// That last rule is an inference, not a stated one: the policy default is
// true, validatePolicy admits only booleans, and #734 already aborts
// rather than write plaintext when the key is missing
// (assertEncryptionKeyConfigured).
async function resolveEncryptionEnabled(db) {
  if (!db) throw new Error('Sem conexão com o banco: a política de criptografia de backup não pode ser lida. Backup abortado para não gravar dados em texto plano.');

  let policy;
  try {
    policy = await backupPolicyService.getPolicy(db);
  } catch (error) {
    throw new Error(`Falha ao ler a política de criptografia de backup: ${error.message}. Backup abortado para não gravar dados em texto plano.`);
  }

  return policy?.encryptionEnabled !== false;
}

// mongodump path: encrypts every file under dirPath recursively (the dump
// tree can nest a subdirectory per database), skipping the top-level
// manifest.json exactly like computeDirChecksum does, and returns one
// envelope entry per file (relative path) for manifest.json.
async function encryptDirectoryFilesInPlace(dirPath) {
  const entries = [];

  async function walk(currentPath, relativePath) {
    const items = await fs.promises.readdir(currentPath, { withFileTypes: true });
    for (const item of items) {
      if (!relativePath && item.name === CHECKSUM_MANIFEST_FILE) continue;
      const itemPath = path.join(currentPath, item.name);
      const itemRelative = relativePath ? `${relativePath}/${item.name}` : item.name;
      if (item.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        await walk(itemPath, itemRelative);
      } else if (item.isFile()) {
        // eslint-disable-next-line no-await-in-loop
        const envelope = await encryptFileInPlace(itemPath);
        entries.push({ file: itemRelative, ...envelope });
      }
    }
  }

  await walk(dirPath, '');
  return entries;
}

// #734: mongorestore reads BSON straight off disk and cannot handle
// ciphertext, so a mongodump-encrypted backup has to be decrypted into a
// disposable scratch copy before mongorestore ever sees it -- the original
// backup directory (and its checksummed ciphertext bytes) is never touched.
// manifest.json itself is not copied; mongorestore only wants the dump
// tree.
async function prepareDecryptedRestoreCopy(backupPath, manifest) {
  // #948: disk-backed, not os.tmpdir() -- see getRestoreScratchBaseDir.
  const scratchBase = getRestoreScratchBaseDir();
  ensureDirSync(scratchBase);
  const scratchDir = await fs.promises.mkdtemp(path.join(scratchBase, 'bioavanced-restore-decrypt-'));
  // #1426: a failure past mkdtemp never reaches the caller's cleanup, which
  // only knows the directory once this returns, so the copy (and any file
  // already decrypted into it) is removed here before the error goes on.
  try {
    await fs.promises.cp(backupPath, scratchDir, {
      recursive: true,
      filter: (src) => path.basename(src) !== CHECKSUM_MANIFEST_FILE
    });

    const encryptedFiles = Array.isArray(manifest?.encryptedFiles) ? manifest.encryptedFiles : [];
    for (const entry of encryptedFiles) {
      if (!entry || typeof entry.file !== 'string') continue;
      // eslint-disable-next-line no-await-in-loop
      const filePath = path.join(scratchDir, ...entry.file.split('/'));
      // eslint-disable-next-line no-await-in-loop
      const ciphertext = await fs.promises.readFile(filePath);
      const plaintext = decryptFileBuffer(ciphertext, entry);
      // eslint-disable-next-line no-await-in-loop
      await fs.promises.writeFile(filePath, plaintext);
    }
  } catch (error) {
    await cleanupDecryptedRestoreCopy(scratchDir);
    throw error;
  }

  return scratchDir;
}

// #1426: what a shell prints when the mongorestore executable itself is
// missing -- sh's "not found", bash's "command not found", cmd.exe's
// "'mongorestore' is not recognized", and a direct spawn's
// "spawn mongorestore ENOENT". A bare ENOENT is not one of them: any file
// the restore reads can carry it.
const RESTORE_BINARY_MISSING = /mongorestore: (?:command )?not found|mongorestore'? is not recognized|spawn mongorestore ENOENT/i;

// #1437: the same messages for the mongodump executable. A bare ENOENT is
// not one of them: any file the dump, its encryption or the manifest write
// touches can carry it.
const DUMP_BINARY_MISSING = /mongodump: (?:command )?not found|mongodump'? is not recognized|spawn mongodump ENOENT/i;

// A decrypt-scratch teardown failure must never mask the restore's own
// result, same reasoning as dropScratch() below for the scratch database.
async function cleanupDecryptedRestoreCopy(scratchDir) {
  if (!scratchDir) return;
  try {
    await fs.promises.rm(scratchDir, { recursive: true, force: true });
  } catch (error) {
    logger.error(`Erro ao remover cópia temporária descriptografada ${scratchDir}:`, error?.message || String(error));
  }
}

function isEncryptedMongodumpManifest(manifest) {
  return !!(manifest && manifest.type === 'mongodump' && manifest.encrypted && Array.isArray(manifest.encryptedFiles));
}

// #723 (RF013 AC#3): sha256 over every file under dirPath, recursively,
// in a deterministic (sorted) order -- so the same backup contents
// always produce the same checksum regardless of filesystem iteration
// order. Returns null (rather than throwing) when the directory can't
// be read, since checksum computation is completion *evidence*, not a
// precondition for the backup itself having succeeded.
//
// #742: the run's own top-level manifest.json is never part of the
// checksummed payload -- it's the checksum's carrier. performBackup/
// writeJsonBackup compute the checksum *before* writing the manifest into
// the same directory, while runControlledRestoreTest recomputes it
// *after*; without this exclusion the two walks see different file sets
// and checksumVerified was structurally always false.
const CHECKSUM_MANIFEST_FILE = 'manifest.json';

async function computeDirChecksum(dirPath) {
  const hash = crypto.createHash('sha256');

  async function walk(currentPath, relativePath) {
    const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of sorted) {
      if (!relativePath && entry.name === CHECKSUM_MANIFEST_FILE) continue;
      const entryPath = path.join(currentPath, entry.name);
      const entryRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(entryPath, entryRelative);
      } else if (entry.isFile()) {
        const content = await fs.promises.readFile(entryPath);
        hash.update(entryRelative);
        hash.update(content);
      }
    }
  }

  try {
    await walk(dirPath, '');
  } catch (error) {
    logger.warn(`Não foi possível calcular checksum de ${dirPath}: ${error.message}`);
    return null;
  }

  return hash.digest('hex');
}

// #723 (RF013 AC#1): persists run-status/result history so `/list` can
// show state/date/result of executions instead of only reflecting
// filesystem directories. Reuses the caller's already-connected app db
// (no new MongoClient connection) -- a no-op when db isn't provided
// (e.g. existing callers/tests that don't pass one), so this is purely
// additive and never blocks the backup itself on a failed history write.
async function recordBackupHistory(db, entry) {
  if (!db) return;
  try {
    await db.collection('backupHistory').insertOne(entry);
  } catch (error) {
    logger.error('Erro ao registrar histórico de backup:', error.message);
  }
}

function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getBackupBaseDir() {
  return env.BACKUP_DIR || path.join(__dirname, '..', '..', 'backups');
}

// #948: where `prepareDecryptedRestoreCopy` stages its decrypted copy of a
// dump. Deliberately NOT `os.tmpdir()`, which is what it used to be.
//
// On compose.prod.yml all five app services declare a bare `tmpfs: - /tmp`.
// A bare compose tmpfs is RAM-backed, and with no `size=` the kernel default
// is half of host RAM -- so the old code copied an entire mongodump into
// memory. The dump is uncompressed BSON (`mongodump --out`, no `--gzip`/
// `--archive`) and retention is by count rather than size, so there is no
// bound on it in the code and therefore no defensible `size=` to pick. The
// scratch has to be on disk instead.
//
// It goes under the backup base dir because that is the one location already
// guaranteed writable and large enough to hold a dump -- it is where the
// dump being copied lives. Dot-prefixed, and skipped by getLatestBackupPath
// below, so it can never be mistaken for a backup.
//
// This is not a rare manual path: prepareDecryptedRestoreCopy has two
// callers, and the second is runControlledRestoreTest, which
// scheduler.service.js runs on an ungated weekly cron (default `0 5 * * 0`).
function getRestoreScratchBaseDir() {
  return env.RESTORE_SCRATCH_DIR || path.join(getBackupBaseDir(), '.restore-scratch');
}

// #731 (RNF010 AC#5): the periodic restore test needs "the backup to
// verify" without duplicating backup.routes.js's /list handler, which does
// a richer job (it merges backupHistory per path for the UI). This is the
// narrow question -- which backup directory is newest -- and nothing else.
// Returns null when the base directory does not exist yet or holds no
// backup directories, which is the normal state before the first run.
function getLatestBackupPath() {
  const baseDir = getBackupBaseDir();
  if (!fs.existsSync(baseDir)) {
    return null;
  }

  const dirs = fs.readdirSync(baseDir, { withFileTypes: true })
    // #948: the restore scratch dir now lives under this directory, and it is
    // strictly newer than the backup it was copied from -- so a birthtime sort
    // would prefer it and a restore would read back a half-decrypted tree.
    // Backup folders are date-shaped (formatDateFolder), never dot-prefixed.
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => {
      const fullPath = path.join(baseDir, entry.name);
      return { fullPath, birthtime: fs.statSync(fullPath).birthtime };
    })
    .sort((a, b) => new Date(b.birthtime).getTime() - new Date(a.birthtime).getTime());

  return dirs.length > 0 ? dirs[0].fullPath : null;
}

function formatDateFolder(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getBackupDirPath(baseDir, date = new Date()) {
  const dateFolder = formatDateFolder(date);
  let targetPath = path.join(baseDir, dateFolder);
  if (!fs.existsSync(targetPath)) {
    return targetPath;
  }

  const timestamp = `${dateFolder}_${date.getHours()}-${date.getMinutes()}-${date.getSeconds()}`;
  return path.join(baseDir, timestamp);
}

function runCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        return reject({ error, stdout, stderr });
      }
      return resolve({ stdout, stderr });
    });
  });
}

// #738 (RF013 AC#3): the JSON fallback was written as a degraded-mode
// safety net. At the time this comment was first written the Docker images
// shipped no mongodump/mongorestore, which made the fallback the *only*
// path on every containerized deployment -- that gap was closed by the
// same commit (mongodb-tools is installed in Dockerfile.dev and
// Dockerfile.prod), so mongodump is now the primary containerized path and
// the JSON writer is the degraded-mode fallback it was designed to be,
// taken only when the mongodump/mongorestore binaries are unavailable.
// The round-trip risk below still applies whenever that fallback runs:
// JSON.stringify / JSON.parse do not round-trip BSON -- ObjectId _ids and
// refs came back as 24-character strings and Dates as ISO strings, so
// after a restore every `findOne({ _id: new ObjectId(id) })` and every
// date-range query in the app would silently stop matching. AC#3's
// checksum is computed over the JSON files, so it could not catch the
// corruption either.
//
// Extended JSON in canonical mode (`relaxed: false`) wraps values in their
// type ($oid, $date, $numberDecimal, ...) so the round trip is lossless.
// Reached through the driver's own BSON re-export rather than requiring
// `bson` directly -- bson is a transitive dependency here, not a declared
// one, so requiring it by name would depend on npm's hoisting.
// Both helpers are exported for backup.service.jsonFallback.test.js.
function serializeBackupDocs(docs) {
  // Signature is (value, replacer, space, options) -- `space` is
  // positional, so passing an `indent` key inside the options object is
  // silently ignored and the file comes out on one line.
  return BSON.EJSON.stringify(docs, null, 2, { relaxed: false });
}

// EJSON.parse reads plain JSON too -- a document with no $-prefixed type
// wrappers comes back exactly as JSON.parse would return it. That is what
// keeps backups written before this change restorable: as lossily as they
// always were, but without erroring.
//
// #865: that guarantee broke for a legacy plain-JSON backup that happens to
// contain a field whose NAME begins with `$` (carried over from a source
// system, or a user field literally named `$oid`/`$date`/`$numberInt`).
// deserializeValue (bson@6.10.4) reinterprets such a field as a canonical
// EJSON type wrapper instead of passing it through: `{"$oid":"zzz"}` throws
// a BSONError, `{"$date":"nope"}` silently becomes an Invalid Date, and
// `{"$numberInt":"1","b":2}` silently drops the sibling `b`. Every wrapper
// but DBRef drops its non-wrapper siblings the same way, and roughly half
// of the 18 recognised $-names throw outright on a malformed value (two of
// those throws are TypeErrors, not BSONErrors) while the rest corrupt
// silently. restoreFromJsonBackup calls this per collection *after*
// wiping that collection with deleteMany({}), with no transaction, so a
// newly-introduced throw here would leave already-processed collections
// dropped and empty -- this function must not gain a new way to throw on
// that destructive path.
//
// The fix classifies every $-keyed object in the raw parsed tree before
// trusting EJSON with it:
//  - a wrapper other than DBRef must have *no* sibling keys beyond its own
//    (plus $scope for $code) -- the sibling rule alone catches most legacy
//    collisions, independent of the value's type;
//  - DBRef ($ref/$id[/$db]) is the one wrapper that legitimately keeps
//    siblings (they become its `fields`), so it gets its own rule;
//  - what remains must additionally have a plausible value shape for its
//    type (24-hex string for $oid, a parseable date for $date, a
//    decimal-string for the $number* family, and so on) -- this is what
//    catches the *silent* corruptions, since those don't throw for
//    `isWellFormedWrapper` to catch via the EJSON.parse try/catch below.
// Only sub-objects that pass both checks are ever handed to EJSON.parse;
// everything else is kept as the plain-JSON value untouched. If nothing in
// the whole document classifies as legacy, today's single-shot
// `EJSON.parse(raw, { relaxed: false })` result is returned unchanged --
// bit-for-bit current behaviour for every backup the current serializer
// wrote, with no new failure mode introduced for any of them.
//
// Known undecidables, deliberately left as plain JSON rather than grown
// into more machinery: a genuine legacy field literally named `$date`
// holding a syntactically valid ISO string (indistinguishable from a real
// wrapper); a sibling-free `$minKey`/`$maxKey`/`{"$undefined":true}` legacy
// field (same collision, no siblings to use as a tell).
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const HEX24_RE = /^[0-9a-fA-F]{24}$/;
const DECIMAL_INT_RE = /^[+-]?\d+$/;
const NUMERIC_STRING_RE = /^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/;
const NUMBER_SPECIAL_RE = /^[+-]?(Infinity|NaN)$/i;
const UUID_RE = /^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$/;
const REGEX_OPTIONS_RE = /^[imxlsu]*$/;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})?$/;
const DBREF_KEYS = new Set(['$ref', '$id', '$db']);
const BSON_INT32_MIN = -2147483648;
const BSON_INT32_MAX = 2147483647;
const BSON_INT64_MIN = -9223372036854775808n;
const BSON_INT64_MAX = 9223372036854775807n;

function isNumberIntShape(value) {
  if (typeof value !== 'string' || !DECIMAL_INT_RE.test(value)) return false;
  const n = Number(value);
  return Number.isInteger(n) && n >= BSON_INT32_MIN && n <= BSON_INT32_MAX;
}

function isNumberLongShape(value) {
  if (typeof value !== 'string' || !DECIMAL_INT_RE.test(value) || value.length > 20) return false;
  try {
    const n = BigInt(value);
    return n >= BSON_INT64_MIN && n <= BSON_INT64_MAX;
  } catch (_) {
    return false;
  }
}

function isNumericStringShape(value) {
  return typeof value === 'string' && (NUMERIC_STRING_RE.test(value) || NUMBER_SPECIAL_RE.test(value));
}

function isDateWrapperShape(value) {
  if (typeof value === 'string') return !Number.isNaN(Date.parse(value));
  if (isPlainObject(value) && Object.keys(value).length === 1) return isNumberLongShape(value.$numberLong);
  return false;
}

// One entry per recognised $-name other than the DBRef triple, which has
// its own rule below. `required` are the $-keys that must all be present;
// `optionalDollar` are $-keys allowed alongside them (only $code/$scope
// uses this); `check` validates the value shape once the key set matches.
const WRAPPER_SPECS = [
  { required: ['$oid'], check: (n) => typeof n.$oid === 'string' && HEX24_RE.test(n.$oid) },
  {
    required: ['$binary'],
    check: (n) => isPlainObject(n.$binary)
      && typeof n.$binary.base64 === 'string' && BASE64_RE.test(n.$binary.base64)
      && typeof n.$binary.subType === 'string' && /^[0-9a-fA-F]{1,2}$/.test(n.$binary.subType),
  },
  { required: ['$uuid'], check: (n) => typeof n.$uuid === 'string' && UUID_RE.test(n.$uuid) },
  { required: ['$symbol'], check: (n) => typeof n.$symbol === 'string' },
  { required: ['$numberInt'], check: (n) => isNumberIntShape(n.$numberInt) },
  { required: ['$numberDecimal'], check: (n) => isNumericStringShape(n.$numberDecimal) },
  { required: ['$numberDouble'], check: (n) => isNumericStringShape(n.$numberDouble) },
  { required: ['$numberLong'], check: (n) => isNumberLongShape(n.$numberLong) },
  { required: ['$minKey'], check: (n) => n.$minKey === 1 },
  { required: ['$maxKey'], check: (n) => n.$maxKey === 1 },
  {
    required: ['$regex'],
    optionalDollar: ['$options'],
    check: (n) => typeof n.$regex === 'string'
      && (n.$options === undefined || (typeof n.$options === 'string' && REGEX_OPTIONS_RE.test(n.$options))),
  },
  {
    required: ['$regularExpression'],
    check: (n) => isPlainObject(n.$regularExpression)
      && typeof n.$regularExpression.pattern === 'string'
      && typeof n.$regularExpression.options === 'string'
      && REGEX_OPTIONS_RE.test(n.$regularExpression.options),
  },
  {
    required: ['$timestamp'],
    check: (n) => isPlainObject(n.$timestamp)
      && typeof n.$timestamp.t === 'number' && typeof n.$timestamp.i === 'number',
  },
  { required: ['$undefined'], check: (n) => n.$undefined === true },
  { required: ['$date'], check: (n) => isDateWrapperShape(n.$date) },
  {
    required: ['$code'],
    optionalDollar: ['$scope'],
    check: (n) => typeof n.$code === 'string' && (n.$scope === undefined || isPlainObject(n.$scope)),
  },
  {
    required: ['$dbPointer'],
    check: (n) => isPlainObject(n.$dbPointer) && typeof n.$dbPointer.$ref === 'string'
      && Object.prototype.hasOwnProperty.call(n.$dbPointer, '$id'),
  },
];

// Does this object, taken on its own (ignoring what's nested inside its
// value), look like a genuine canonical EJSON wrapper rather than a legacy
// field that happens to collide with one? Nested wrapper values (e.g. the
// $numberLong inside a canonical $date, or the $id inside a $dbPointer)
// are left to the real BSON.EJSON.parse call this function is only ever
// used to gate -- EJSON.parse's own bottom-up parsing resolves those with
// full fidelity, so this classifier does not need to re-implement it.
function isWellFormedWrapper(node, keys, dollarKeys) {
  if (dollarKeys.length > 0 && dollarKeys.every((k) => DBREF_KEYS.has(k))
    && typeof node.$ref === 'string'
    && Object.prototype.hasOwnProperty.call(node, '$id')) {
    return true;
  }

  const spec = WRAPPER_SPECS.find((candidate) => {
    if (!candidate.required.every((k) => dollarKeys.includes(k))) return false;
    const extraDollar = dollarKeys.filter((k) => !candidate.required.includes(k));
    return extraDollar.every((k) => (candidate.optionalDollar || []).includes(k));
  });
  if (!spec) return false;

  const allowedKeys = new Set([...spec.required, ...(spec.optionalDollar || [])]);
  if (!keys.every((k) => allowedKeys.has(k))) return false;

  return spec.check(node);
}

// True if `node` (or anything nested inside it) contains a $-keyed object
// that does not classify as a well-formed wrapper -- i.e. this document
// needs the careful per-node rebuild rather than the single-shot
// EJSON.parse that reproduces today's behaviour exactly.
function hasLegacyDollarObject(node) {
  if (Array.isArray(node)) return node.some(hasLegacyDollarObject);
  if (!isPlainObject(node)) return false;

  const keys = Object.keys(node);
  const dollarKeys = keys.filter((k) => k.startsWith('$'));
  if (dollarKeys.length > 0) {
    // A well-formed wrapper delegates everything nested inside it to real
    // EJSON.parse (see isWellFormedWrapper's comment), so it is not
    // itself legacy and its interior is not walked separately here.
    return !isWellFormedWrapper(node, keys, dollarKeys);
  }

  return keys.some((k) => hasLegacyDollarObject(node[k]));
}

// Rebuilds the tree bottom-up: a node proven well-formed is hand off to
// real EJSON.parse (on its own untouched JSON text, so nested wrappers
// inside it still convert with full fidelity); everything else is walked
// and kept as plain JSON. The per-node try/catch means a wrong "looks
// well-formed" classification degrades that one sub-object to legacy
// (plain JSON) instead of aborting the whole document -- deliberately not
// filtered to BSONError, since two of deserializeValue's throws are
// TypeErrors.
function convertLegacyAwareTree(node) {
  if (Array.isArray(node)) return node.map(convertLegacyAwareTree);
  if (!isPlainObject(node)) return node;

  const keys = Object.keys(node);
  const dollarKeys = keys.filter((k) => k.startsWith('$'));
  if (dollarKeys.length > 0 && isWellFormedWrapper(node, keys, dollarKeys)) {
    try {
      return BSON.EJSON.parse(JSON.stringify(node), { relaxed: false });
    } catch (_) {
      // Fall through: treat as legacy for this node rather than letting a
      // wrong classification abort the destructive restore path.
    }
  }

  const result = {};
  for (const k of keys) {
    result[k] = convertLegacyAwareTree(node[k]);
  }
  return result;
}

function parseBackupDocs(raw) {
  let plain;
  try {
    plain = JSON.parse(raw);
  } catch (_) {
    // Not parseable as plain JSON either -- defer to today's behaviour
    // (and error) rather than inventing a new failure mode for input that
    // was already unrestorable.
    return BSON.EJSON.parse(raw, { relaxed: false });
  }

  if (!hasLegacyDollarObject(plain)) {
    // Nothing in this document collides with a canonical wrapper name --
    // bit-for-bit today's behaviour, no new failure mode.
    return BSON.EJSON.parse(raw, { relaxed: false });
  }

  try {
    return convertLegacyAwareTree(plain);
  } catch (_) {
    // Never let a malformed legacy backup abort the destructive restore
    // path -- fall back to the plain-JSON parse, exactly as lossy as
    // every JSON fallback restore was before #738, but never throwing.
    return plain;
  }
}

async function restoreFromJsonBackup(backupPath, mongoUri, targetDbName) {
  const manifestPath = path.join(backupPath, 'manifest.json');
  const hasManifest = fs.existsSync(manifestPath);

  let manifest = null;
  if (hasManifest) {
    const rawManifest = await fs.promises.readFile(manifestPath, 'utf8');
    manifest = JSON.parse(rawManifest);
  }

  const dbName = targetDbName || manifest?.dbName || resolveDatabaseName(mongoUri);
  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    const db = client.db(dbName);

    // #734: manifest.collections entries may carry a per-file crypto
    // envelope (encrypted/encryptionAlgorithm/encryptionKeyId/
    // encryptionIv/encryptionTag) -- kept alongside the filename here so
    // the loop below knows how to read each file, instead of the previous
    // map-to-filename-only that discarded it.
    let jsonFileEntries = [];
    let restoredDocuments = 0;

    if (manifest?.collections && Array.isArray(manifest.collections)) {
      jsonFileEntries = manifest.collections
        .filter((entry) => entry && typeof entry.file === 'string' && entry.file.endsWith('.json'))
        .map((entry) => ({ ...entry }));
    }

    if (jsonFileEntries.length === 0) {
      const files = (await fs.promises.readdir(backupPath))
        .filter((file) => file.endsWith('.json') && file !== 'manifest.json');
      // No manifest metadata to go on for these -- always plaintext, same
      // as every backup written before this change.
      jsonFileEntries = files.map((file) => ({ file, encrypted: false }));
    }

    if (jsonFileEntries.length === 0) {
      throw new Error('Nenhum arquivo JSON de backup encontrado para restore');
    }

    for (const entry of jsonFileEntries) {
      const collectionName = entry.file.replace(/\.json$/i, '');
      const fullPath = path.join(backupPath, entry.file);

      let raw;
      if (entry.encrypted) {
        const ciphertext = await fs.promises.readFile(fullPath);
        const plaintext = decryptFileBuffer(ciphertext, entry);
        raw = plaintext.toString('utf8');
      } else {
        raw = await fs.promises.readFile(fullPath, 'utf8');
      }

      const docs = parseBackupDocs(raw);

      const collection = db.collection(collectionName);
      await collection.deleteMany({});

      if (Array.isArray(docs) && docs.length > 0) {
        await collection.insertMany(docs, { ordered: false });
        // #766: tallied here rather than re-counted afterwards -- this path
        // also serves the live restoreBackup(), where re-reading the target
        // database to count would race anything already writing to it.
        restoredDocuments += docs.length;
      }
    }

    return {
      success: true,
      restoredFrom: path.basename(backupPath),
      restoredAt: new Date(),
      mode: 'json-fallback',
      collections: jsonFileEntries.length,
      documents: restoredDocuments
    };
  } finally {
    await client.close();
  }
}

async function cleanupOldBackups(baseDir, retentionDays) {
  try {
    if (!fs.existsSync(baseDir)) return;

    const entries = await fs.promises.readdir(baseDir, { withFileTypes: true });
    const now = Date.now();
    const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;

    await Promise.all(entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const fullPath = path.join(baseDir, entry.name);
        let dirDate = null;

        const dateMatch = entry.name.match(/^\d{4}-\d{2}-\d{2}/);
        if (dateMatch) {
          dirDate = new Date(`${dateMatch[0]}T00:00:00.000Z`).getTime();
        } else {
          const stat = await fs.promises.stat(fullPath);
          dirDate = stat.mtime.getTime();
        }

        if (now - dirDate > maxAgeMs) {
          await fs.promises.rm(fullPath, { recursive: true, force: true });
          logger.info(`🧹 Backup removido (retenção): ${fullPath}`);
        }
      }));
  } catch (error) {
    logger.error('Erro ao limpar backups antigos:', error.message);
  }
}

function resolveDatabaseName(mongoUri) {
  if (env.MONGO_DB) return env.MONGO_DB;

  try {
    const parsed = new URL(mongoUri);
    const dbFromPath = parsed.pathname ? parsed.pathname.replace(/^\//, '') : '';
    return dbFromPath || 'bioavanced';
  } catch (_) {
    return 'bioavanced';
  }
}

// #765: mongorestore treats a database path component in --uri as an implicit
// --db, which puts it in its single-database use-case where it expects .bson
// files *directly* in the directory it is given. `mongodump --out` writes
// <dir>/<dbName>/*.bson, so mongorestore finds a subdirectory where it wants
// BSON, logs "don't know what to do with subdirectory", skips it, and exits 0
// having restored nothing -- and exit 0 means runCommand resolves, so both
// restore callers take their success path while the database is untouched.
// Stripping the default db puts mongorestore back in its full-dump use-case,
// where --nsInclude / --nsFrom+--nsTo do the scoping instead. Query options
// (replicaSet, authSource, TLS flags) must survive, so this rewrites only the
// path component and leaves the authority and query string byte-for-byte --
// a URL round-trip would risk re-encoding credentials and mangles a
// comma-separated replica-set host list. mongodump is deliberately NOT run
// through this: it needs the db context to produce the layout above.
function stripDefaultDatabase(mongoUri) {
  if (!mongoUri) return mongoUri;
  return String(mongoUri).replace(/^(mongodb(?:\+srv)?:\/\/[^/?]*)(?:\/[^?]*)?/, '$1/');
}

async function writeJsonBackup(backupDir, mongoUri, encryptionEnabled = false) {
  const dbName = resolveDatabaseName(mongoUri);
  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    const db = client.db(dbName);

    ensureDirSync(backupDir);
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    const manifest = {
      createdAt: new Date().toISOString(),
      dbName,
      type: 'json-fallback',
      collections: []
    };

    for (const collection of collections) {
      const name = collection.name;
      const docs = await db.collection(name).find({}).toArray();
      const fileName = `${name}.json`;
      const filePath = path.join(backupDir, fileName);

      await fs.promises.writeFile(filePath, serializeBackupDocs(docs), 'utf8');
      manifest.collections.push({
        name,
        count: docs.length,
        file: fileName
      });
    }

    // #734: encrypt each collection's payload file in place, AFTER it has
    // been written and BEFORE the checksum below -- so the checksum is
    // computed over the same ciphertext bytes that end up on disk, at
    // exactly the point it was already being computed.
    if (encryptionEnabled) {
      assertEncryptionKeyConfigured();
      for (const entry of manifest.collections) {
        const filePath = path.join(backupDir, entry.file);
        // eslint-disable-next-line no-await-in-loop
        const envelope = await encryptFileInPlace(filePath);
        Object.assign(entry, envelope);
      }
    }

    // #1325: the Neo4j and InfluxDB exports, encrypted by their own module
    // and covered by the checksum below. A throw here fails the run through
    // performBackup's fallback catch.
    manifest.stores = await backupStores.exportSecondaryStores(backupDir, encryptionEnabled);

    const checksum = await computeDirChecksum(backupDir);
    manifest.checksum = checksum;

    await fs.promises.writeFile(
      path.join(backupDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );

    return {
      success: true,
      path: backupDir,
      mode: 'json-fallback',
      collections: manifest.collections.length,
      checksum,
      stores: manifest.stores
    };
  } finally {
    await client.close();
  }
}

async function performBackup(retentionDaysOverride, encryptionEnabled = true) {
  const mongoUri = env.MONGO_URI;
  if (!mongoUri) {
    logger.warn('Backup ignorado: MONGO_URI não configurado.');
    return { success: false, skipped: true, reason: 'missing_mongo_uri' };
  }

  // #734: checked before mongodump ever runs (or the JSON fallback ever
  // writes a byte) -- a backup that believes it is encrypted and is not is
  // exactly this issue's defect, so a missing key must fail loudly up
  // front rather than after plaintext already exists on disk.
  if (encryptionEnabled) {
    try {
      assertEncryptionKeyConfigured();
    } catch (keyError) {
      logger.error('Erro ao executar backup:', keyError.message);
      return { success: false, error: keyError.message };
    }
  }

  const baseDir = getBackupBaseDir();
  ensureDirSync(baseDir);
  const backupDir = getBackupDirPath(baseDir);

  const dbArg = env.MONGO_DB ? ` --db="${env.MONGO_DB}"` : '';
  const command = `mongodump --uri="${mongoUri}"${dbArg} --out="${backupDir}"`;

  try {
    logger.info(`🧩 Iniciando backup: ${backupDir}`);
    await runCommand(command);
    logger.info(`✅ Backup concluído: ${backupDir}`);

    // #734: encrypt the dump tree's files in place, AFTER mongodump
    // completes and BEFORE the checksum below -- so the checksum is
    // computed over the same ciphertext bytes that end up on disk, at
    // exactly the point it was already being computed. The key was
    // already confirmed present above; re-checked here too since
    // assertEncryptionKeyConfigured() is cheap and this is the one place
    // that would otherwise silently write ciphertext-less files.
    let encryptedFiles = null;
    if (encryptionEnabled) {
      assertEncryptionKeyConfigured();
      encryptedFiles = await encryptDirectoryFilesInPlace(backupDir);
    }

    // #1325: the Neo4j and InfluxDB exports run after the dump tree is
    // encrypted, so their files are encrypted once, by their own module, and
    // before the checksum, so it covers them. A store error is answered here,
    // before the catch below, so no retention or JSON fallback runs on it.
    // No manifest.json is written for this folder, so a restore test of it
    // fails.
    let stores;
    try {
      stores = await backupStores.exportSecondaryStores(backupDir, encryptionEnabled);
    } catch (storeError) {
      const storeDetails = storeError?.message || String(storeError);
      logger.error('Erro ao executar backup:', storeDetails);
      return { success: false, error: storeDetails };
    }

    const checksum = await computeDirChecksum(backupDir);
    await fs.promises.writeFile(
      path.join(backupDir, 'manifest.json'),
      JSON.stringify({
        createdAt: new Date().toISOString(),
        dbName: resolveDatabaseName(mongoUri),
        type: 'mongodump',
        checksum,
        ...(encryptionEnabled ? { encrypted: true, encryptedFiles } : {}),
        stores
      }, null, 2),
      'utf8'
    );

    // #1325 (RNF010 C1): the off-site copy runs once the manifest is written
    // and before retention. Its error is answered here, as a store error is,
    // before the catch below, so no retention or JSON fallback runs on it.
    // The local copy is complete, so the run keeps its path and checksum.
    let offsite;
    try {
      offsite = await backupOffsite.uploadBackupRunOffsite(backupDir, encryptionEnabled);
    } catch (offsiteError) {
      const offsiteDetails = offsiteError?.message || String(offsiteError);
      logger.error('Erro ao executar backup:', offsiteDetails);
      return { success: false, error: offsiteDetails, path: backupDir, checksum };
    }

    const retentionDays = Number.isFinite(Number(retentionDaysOverride)) ? Number(retentionDaysOverride) : Number(env.BACKUP_RETENTION_DAYS || DEFAULT_RETENTION_DAYS);
    await cleanupOldBackups(baseDir, retentionDays);

    return { success: true, path: backupDir, mode: 'mongodump', checksum, stores, offsite };
  } catch (err) {
    const details = err && err.error ? err.error.message : err?.message;
    // #1437: a bare ENOENT is any file's, not mongodump's.
    const dumpBinaryMissing = DUMP_BINARY_MISSING.test(String(details || ''));

    if (dumpBinaryMissing) {
      try {
        logger.warn('mongodump indisponível. Usando fallback de backup em JSON.');
        const fallbackResult = await writeJsonBackup(backupDir, mongoUri, encryptionEnabled);
        // #1325 (RNF010 C1): a throw here is answered by the catch below.
        const fallbackOffsite = await backupOffsite.uploadBackupRunOffsite(backupDir, encryptionEnabled);

        const retentionDays = Number.isFinite(Number(retentionDaysOverride)) ? Number(retentionDaysOverride) : Number(env.BACKUP_RETENTION_DAYS || DEFAULT_RETENTION_DAYS);
        await cleanupOldBackups(baseDir, retentionDays);

        logger.info(`✅ Backup fallback concluído: ${backupDir}`);
        return { ...fallbackResult, offsite: fallbackOffsite };
      } catch (fallbackError) {
        const fallbackDetails = fallbackError?.message || String(fallbackError);
        logger.error('Erro no fallback de backup JSON:', fallbackDetails);
        return { success: false, error: fallbackDetails };
      }
    }

    logger.error('Erro ao executar backup:', details || 'Erro desconhecido');
    return { success: false, error: details || 'Erro ao executar backup' };
  }
}

// #723 (RF013 AC#1/AC#3): thin wrapper so every runBackup() call --
// whichever internal branch it takes -- records exactly one history
// entry, instead of scattering recordBackupHistory calls across each
// branch of performBackup(). `db` is optional (see recordBackupHistory);
// a run without one records nothing, and fails (#1325) because its
// encryption policy cannot be read.
async function runBackup(db) {
  const startedAt = new Date();
  const retentionDays = await resolveRetentionDays(db);
  let result;
  let encryptionEnabled;
  try {
    encryptionEnabled = await resolveEncryptionEnabled(db);
  } catch (err) {
    logger.error('Erro ao executar backup:', err.message);
    result = { success: false, error: err.message };
  }
  if (!result) result = await performBackup(retentionDays, encryptionEnabled);

  await recordBackupHistory(db, {
    startedAt,
    completedAt: new Date(),
    status: result.success ? 'success' : (result.skipped ? 'skipped' : 'error'),
    mode: result.mode || null,
    path: result.path || null,
    checksum: result.checksum || null,
    error: result.error || null,
    offsite: result.offsite || null
  });

  return result;
}

async function restoreBackup(backupPath) {
  const mongoUri = env.MONGO_URI;
  if (!mongoUri) {
    return { success: false, error: 'MONGO_URI não configurado' };
  }

  if (!backupPath || !fs.existsSync(backupPath)) {
    return { success: false, error: 'Backup não encontrado' };
  }

  // #734: mongorestore reads BSON straight off disk and cannot handle a
  // mongodump-encrypted backup's ciphertext -- decrypt into a disposable
  // scratch copy first and restore from that instead, leaving the original
  // (checksummed) backup directory untouched. A manifest read failure here
  // is treated the same as "no manifest" (unencrypted / pre-existing
  // backup), matching runControlledRestoreTest's own tolerance for it.
  let manifest = null;
  const manifestPath = path.join(backupPath, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
    } catch (_) {
      manifest = null;
    }
  }

  let restoreSourcePath = backupPath;
  let scratchDecryptDir = null;

  try {
    if (isEncryptedMongodumpManifest(manifest)) {
      // #1426: a decryption failure (a bad key, a corrupt or missing file)
      // answers like every other failure here, never as a rejection.
      try {
        scratchDecryptDir = await prepareDecryptedRestoreCopy(backupPath, manifest);
      } catch (decryptError) {
        const decryptDetails = decryptError?.message || String(decryptError);
        logger.error('Erro ao descriptografar backup para restauração:', decryptDetails);
        return { success: false, error: decryptDetails };
      }
      restoreSourcePath = scratchDecryptDir;
    }

    const dbArg = env.MONGO_DB ? ` --nsInclude="${env.MONGO_DB}.*"` : '';
    const command = `mongorestore --uri="${stripDefaultDatabase(mongoUri)}" --drop${dbArg} "${restoreSourcePath}"`;

    try {
      await runCommand(command);
      return {
        success: true,
        restoredFrom: path.basename(backupPath),
        restoredAt: new Date(),
        mode: 'mongorestore'
      };
    } catch (err) {
      const details = err && err.error ? err.error.message : err?.message;
      const restoreBinaryMissing = RESTORE_BINARY_MISSING.test(String(details || ''));

      if (restoreBinaryMissing) {
        try {
          logger.warn('mongorestore indisponível. Usando fallback de restore em JSON.');
          return await restoreFromJsonBackup(backupPath, mongoUri);
        } catch (fallbackError) {
          const fallbackDetails = fallbackError?.message || String(fallbackError);
          logger.error('Erro no fallback de restore JSON:', fallbackDetails);
          return { success: false, error: fallbackDetails };
        }
      }

      return { success: false, error: details || 'Erro ao restaurar backup' };
    }
  } finally {
    await cleanupDecryptedRestoreCopy(scratchDecryptDir);
  }
}

// #727 (RF013 AC#4): persists controlled-restore-test run history, mirroring
// recordBackupHistory's optional-db, best-effort pattern.
async function recordRestoreTestHistory(db, entry) {
  if (!db) return;
  try {
    await db.collection('restoreTestHistory').insertOne(entry);
  } catch (error) {
    logger.error('Erro ao registrar histórico de teste de restauração:', error.message);
  }
}

async function dropScratchDatabase(mongoUri, dbName) {
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    await client.db(dbName).dropDatabase();
  } finally {
    await client.close();
  }
}

// #766: a collection count alone cannot distinguish "restored everything"
// from "created every collection and populated none of them" -- one step
// milder than the #765 no-op this assertion caught, and the same class of
// silent success. Returns both in one pass rather than growing a sibling
// function, so the two counts can never be taken against different
// connections or a half-dropped scratch db.
//
// nameOnly is dropped from listCollections: the document count needs the
// real collection names to iterate, which nameOnly still provides, but the
// call now also filters out views -- countDocuments() on a view is legal but
// would double-count the underlying collection's rows.
async function countScratchContents(mongoUri, dbName) {
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const collections = await db
      .listCollections({ type: 'collection' }, { nameOnly: true })
      .toArray();

    let documents = 0;
    for (const { name } of collections) {
      // eslint-disable-next-line no-await-in-loop
      documents += await db.collection(name).countDocuments();
    }

    return { collections: collections.length, documents };
  } catch (_) {
    return { collections: null, documents: null };
  } finally {
    await client.close();
  }
}

// #727 (RF013 AC#4): "controlled restore testing" -- restoreBackup() is the
// only restore path today and it's live/destructive (--drop against the
// configured database). This restores a backup into a disposable scratch
// database instead (named `<dbName>_restoretest_<timestamp>`, remapped via
// mongorestore's --nsFrom/--nsTo so the live db is never touched), verifies
// the backup's own checksum against its manifest first (RNF010: "validado
// por checksum"), then tears the scratch database down.
async function runControlledRestoreTest(backupPath) {
  const mongoUri = env.MONGO_URI;
  if (!mongoUri) {
    return { success: false, error: 'MONGO_URI não configurado' };
  }

  if (!backupPath || !fs.existsSync(backupPath)) {
    return { success: false, error: 'Backup não encontrado' };
  }

  const manifestPath = path.join(backupPath, 'manifest.json');
  let manifest = null;
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
    } catch (_) {
      manifest = null;
    }
  }

  // #734: computed over backupPath exactly as before -- the checksum's job
  // is on-disk tamper detection of what's actually stored, which for an
  // encrypted backup is the ciphertext. This recompute (and the manifest
  // value it's compared against) is over the ciphertext bytes in both
  // cases, so a random per-file IV never perturbs it.
  const recomputedChecksum = await computeDirChecksum(backupPath);
  const checksumVerified = !!(manifest && manifest.checksum && manifest.checksum === recomputedChecksum);
  // #1325: a checksum that does not match, or a backup with none to match,
  // fails the test (RNF010: "validados por checksum"). The restore below
  // still runs so its counts stay diagnostic.
  let checksumError = null;
  if (!checksumVerified) {
    checksumError = manifest && manifest.checksum
      ? 'Checksum do backup não confere com o manifest.json: backup alterado ou corrompido.'
      : 'Backup sem manifest.json com checksum: integridade não verificável.';
  }

  // #1325 (RNF010 C5): the Neo4j and InfluxDB exports are decrypted and
  // parsed, never loaded into a database. A store that fails fails the test;
  // the Mongo restore below still runs for its counts, as with the checksum.
  // Its own catch, so an unexpected throw (say an ENOENT) can never reach the
  // catch below and be read as a missing mongorestore binary.
  let storesCheck;
  try {
    storesCheck = await backupStores.verifySecondaryStores(
      backupPath,
      manifest ? manifest.stores : undefined,
      getRestoreScratchBaseDir()
    );
  } catch (storesError) {
    storesCheck = { stores: null, error: `Teste de restauração dos stores falhou: ${storesError?.message || String(storesError)}` };
  }
  const testError = [checksumError, storesCheck.error].filter(Boolean).join(' ') || null;

  const sourceDbName = (manifest && manifest.dbName) || resolveDatabaseName(mongoUri);
  const scratchDb = `${sourceDbName}_restoretest_${Date.now()}`;

  // #750: the scratch database has to come down on every exit path, not just
  // the two success ones. mongorestore (and the JSON fallback) writes
  // collection by collection, so a run that fails partway has already put
  // documents in it, and the name is timestamped -- every failed run used to
  // leave its own distinct orphan behind. #731 made these runs weekly and
  // unattended, which turns that into an unbounded set of them.
  const dropScratch = async () => {
    try {
      await dropScratchDatabase(mongoUri, scratchDb);
    } catch (dropError) {
      // A teardown failure must never mask the restore's own error. Log the
      // scratch name so an operator can clean it up by hand.
      logger.error(`Erro ao remover a base de teste ${scratchDb}:`, dropError?.message || String(dropError));
    }
  };

  // #734: same reasoning as restoreBackup -- mongorestore cannot read a
  // mongodump-encrypted backup's ciphertext, so it is decrypted into a
  // disposable scratch copy (never the checksummed original) and restored
  // from that. Declared here so the outer finally can always clean it up,
  // including when preparing it is what fails.
  let scratchDecryptDir = null;

  try {
    let restoreSourcePath = backupPath;
    if (isEncryptedMongodumpManifest(manifest)) {
      scratchDecryptDir = await prepareDecryptedRestoreCopy(backupPath, manifest);
      restoreSourcePath = scratchDecryptDir;
    }

    const command = `mongorestore --uri="${stripDefaultDatabase(mongoUri)}" --drop --nsFrom="${sourceDbName}.*" --nsTo="${scratchDb}.*" "${restoreSourcePath}"`;

    await runCommand(command);
    const { collections: restoredCollections, documents: restoredDocuments } =
      await countScratchContents(mongoUri, scratchDb);

    return {
      success: checksumVerified && !storesCheck.error,
      ...(testError ? { error: testError } : {}),
      testedFrom: path.basename(backupPath),
      testedAt: new Date(),
      mode: 'mongorestore',
      scratchDb,
      checksumVerified,
      restoredCollections,
      restoredDocuments,
      stores: storesCheck.stores
    };
  } catch (err) {
    const details = err && err.error ? err.error.message : err?.message;
    const restoreBinaryMissing = RESTORE_BINARY_MISSING.test(String(details || ''));

    if (restoreBinaryMissing) {
      try {
        logger.warn('mongorestore indisponível. Usando fallback de teste de restauração em JSON.');
        const fallback = await restoreFromJsonBackup(backupPath, mongoUri, scratchDb);
        // #766: normalise the fallback's `collections`/`documents` onto the
        // same `restored*` names the mongorestore path reports, so callers
        // and the restoreTestHistory entry see one shape regardless of which
        // path ran.
        const fallbackError = fallback.error || testError;
        return {
          ...fallback,
          success: fallback.success === true && checksumVerified && !storesCheck.error,
          ...(fallbackError ? { error: fallbackError } : {}),
          scratchDb,
          checksumVerified,
          restoredCollections: fallback.collections ?? null,
          restoredDocuments: fallback.documents ?? null,
          stores: storesCheck.stores
        };
      } catch (fallbackError) {
        const fallbackDetails = fallbackError?.message || String(fallbackError);
        logger.error('Erro no fallback de teste de restauração JSON:', fallbackDetails);
        return { success: false, error: fallbackDetails, checksumVerified, stores: storesCheck.stores };
      }
    }

    return { success: false, error: details || 'Erro ao testar restauração', checksumVerified, stores: storesCheck.stores };
  } finally {
    await dropScratch();
    await cleanupDecryptedRestoreCopy(scratchDecryptDir);
  }
}

// #727 (RF013 AC#4): thin wrapper so every testRestoreBackup() call persists
// exactly one restoreTestHistory entry, same pattern as runBackup/
// recordBackupHistory above.
//
// RNF010 C3 (#1484): the run's wall time is recorded against the policy's
// rtoHours. It times the restore test (a MongoDB restore into a scratch
// database plus a parse of the Neo4j/InfluxDB exports), a lower bound of a
// full recovery, not a timed full recovery. Past rtoHours logs an error; the
// run's success is unchanged.
async function testRestoreBackup(backupPath, db) {
  const startMs = Date.now();
  const startedAt = new Date(startMs);
  const result = await runControlledRestoreTest(backupPath);
  const endMs = Date.now();
  const durationMs = endMs - startMs;
  const completedAt = new Date(endMs);

  const rtoHours = await resolveRtoHours(db);
  const withinRto = (!result.success || rtoHours === null) ? null : durationMs <= rtoHours * 3600000;
  if (withinRto === false) {
    logger.error(`Teste de restauração excedeu o RTO: ${durationMs} ms > ${rtoHours} h`, path.basename(backupPath));
  }

  await recordRestoreTestHistory(db, {
    startedAt,
    completedAt,
    status: result.success ? 'success' : 'error',
    mode: result.mode || null,
    scratchDb: result.scratchDb || null,
    checksumVerified: typeof result.checksumVerified === 'boolean' ? result.checksumVerified : null,
    restoredCollections: typeof result.restoredCollections === 'number' ? result.restoredCollections : null,
    // #766: #731's weekly unattended run is the real consumer of this
    // history -- a collection count that never moves looks identical to a
    // healthy one, so the document count is what makes the record diagnostic
    // rather than merely present.
    restoredDocuments: typeof result.restoredDocuments === 'number' ? result.restoredDocuments : null,
    // #1325: per-store verified/skipped/failed, null when not tested.
    stores: result.stores ?? null,
    durationMs,
    rtoHours,
    withinRto,
    error: result.error || null
  });

  return result;
}

module.exports = {
  runBackup,
  cleanupOldBackups,
  getBackupBaseDir,
  getRestoreScratchBaseDir,
  getLatestBackupPath,
  serializeBackupDocs,
  parseBackupDocs,
  restoreBackup,
  testRestoreBackup
};
