import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const fs = require('fs');
const os = require('os');
const path = require('path');

const MODULE_PATH = require.resolve('../../src/services/backup.service');
const ENV_PATH = require.resolve('../../src/config/env');

function freshServiceWithBackupDir(backupDir) {
  // Per repo gotcha: vi.resetModules() alone does not reliably clear
  // require.cache, so the module under test is evicted by path.
  process.env.BACKUP_DIR = backupDir;
  delete require.cache[MODULE_PATH];
  delete require.cache[ENV_PATH];
  return require('../../src/services/backup.service');
}

// #948: `prepareDecryptedRestoreCopy` built its scratch directory under
// `os.tmpdir()` and copied the ENTIRE decrypted dump into it, then decrypted
// in place -- so peak occupancy is the whole dump plus one plaintext buffer.
//
// On compose.prod.yml that is fatal rather than merely untidy: all five app
// services declare a bare `tmpfs: - /tmp`, which is RAM-backed and, with no
// `size=`, defaults to half of host RAM. And it is not a rare manual
// operation -- `prepareDecryptedRestoreCopy` has two callers, and the second
// is `runControlledRestoreTest`, on an ungated weekly cron
// (`scheduler.service.js`, default `0 5 * * 0`).
//
// The scratch therefore has to live on disk, alongside the backups it is a
// copy of. Which creates the second hazard these tests pin: `getLatestBackupPath`
// picks the newest DIRECTORY under the backup base dir, so a scratch directory
// placed there would be selectable as "the backup to restore".
describe('#948: restore scratch is disk-backed, not an in-RAM tmpfs', () => {
  const created = [];

  afterEach(() => {
    for (const dir of created.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    delete process.env.BACKUP_DIR;
    delete require.cache[MODULE_PATH];
    delete require.cache[ENV_PATH];
  });

  function makeBackupDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bioavanced-948-'));
    created.push(dir);
    return dir;
  }

  it('resolves the scratch base under the backup directory, never under os.tmpdir()', () => {
    const backupDir = makeBackupDir();
    const svc = freshServiceWithBackupDir(backupDir);

    const scratchBase = svc.getRestoreScratchBaseDir();

    expect(scratchBase.startsWith(backupDir)).toBe(true);
    expect(path.relative(backupDir, scratchBase)).not.toBe('');
  });

  it('honours RESTORE_SCRATCH_DIR when an operator points it somewhere else', () => {
    const backupDir = makeBackupDir();
    const elsewhere = makeBackupDir();
    process.env.RESTORE_SCRATCH_DIR = elsewhere;
    try {
      const svc = freshServiceWithBackupDir(backupDir);
      expect(svc.getRestoreScratchBaseDir()).toBe(elsewhere);
    } finally {
      delete process.env.RESTORE_SCRATCH_DIR;
    }
  });

  // The regression the move itself creates, and the reason the scratch is
  // dot-prefixed: a restore that picked the scratch copy as its source would
  // restore a half-decrypted tree, or an empty one.
  it('getLatestBackupPath does not select the scratch directory as a backup', () => {
    const backupDir = makeBackupDir();
    const svc = freshServiceWithBackupDir(backupDir);

    // A real backup folder, in the date-shaped form formatDateFolder emits.
    const realBackup = path.join(backupDir, '2026-09-02_10-00-00');
    fs.mkdirSync(realBackup, { recursive: true });

    // The scratch dir, created afterwards so it is strictly newer -- which is
    // exactly what would make a birthtime sort prefer it.
    const scratchBase = svc.getRestoreScratchBaseDir();
    fs.mkdirSync(path.join(scratchBase, 'bioavanced-restore-decrypt-abc123'), { recursive: true });

    expect(svc.getLatestBackupPath()).toBe(realBackup);
  });

  it('getLatestBackupPath still returns null when only the scratch dir exists', () => {
    const backupDir = makeBackupDir();
    const svc = freshServiceWithBackupDir(backupDir);

    fs.mkdirSync(svc.getRestoreScratchBaseDir(), { recursive: true });

    expect(svc.getLatestBackupPath()).toBeNull();
  });
});

// #957: boot must clear orphaned decrypted restore trees left by a crash.
describe('#957: sweepRestoreScratch clears orphaned decrypt trees', () => {
  const created = [];

  afterEach(() => {
    for (const dir of created.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    delete process.env.BACKUP_DIR;
    delete process.env.RESTORE_SCRATCH_DIR;
    delete require.cache[MODULE_PATH];
    delete require.cache[ENV_PATH];
  });

  function makeBackupDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bioavanced-957-'));
    created.push(dir);
    return dir;
  }

  it('removes children under the scratch base and leaves the base itself', async () => {
    const backupDir = makeBackupDir();
    const svc = freshServiceWithBackupDir(backupDir);
    const scratchBase = svc.getRestoreScratchBaseDir();
    const orphan = path.join(scratchBase, 'bioavanced-restore-decrypt-orphan');
    fs.mkdirSync(orphan, { recursive: true });
    fs.writeFileSync(path.join(orphan, 'dump.bson'), 'plaintext');

    const result = await svc.sweepRestoreScratch();

    expect(result.removed).toBe(1);
    expect(result.skipped).toBe(false);
    expect(fs.existsSync(orphan)).toBe(false);
    expect(fs.existsSync(scratchBase)).toBe(true);
  });

  it('is a no-op when the scratch base does not exist yet', async () => {
    const backupDir = makeBackupDir();
    const svc = freshServiceWithBackupDir(backupDir);

    const result = await svc.sweepRestoreScratch();

    expect(result).toEqual({ removed: 0, skipped: true });
  });
});
