import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');
const uploadConfig = require('../../src/config/uploadConfig');
const env = require('../../src/config/env');

// #893: UPLOADS_BASE/STORAGE_BASE resolve module-scope at require time, same
// as backup.service.js's getBackupBaseDir(), so the env vs. default branch
// has to be exercised on a fresh require -- see
// tests/unit/services/backup.service.test.js:47-59 for the shape this
// copies.
const uploadConfigPath = require.resolve('../../src/config/uploadConfig');

function freshUploadConfig() {
  delete require.cache[uploadConfigPath];
  return require(uploadConfigPath);
}

describe('uploadConfig - fileFilter', () => {
  const buildFile = (originalname, mimetype) => ({ originalname, mimetype });

  it('rejects blocked extensions even with an allowed mimetype', () => {
    const cb = vi.fn();
    uploadConfig.fileFilter({}, buildFile('virus.exe', 'application/octet-stream'), cb);

    expect(cb).toHaveBeenCalledTimes(1);
    const [err, allowed] = cb.mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('File type not allowed');
    expect(allowed).toBe(false);
  });

  it('rejects blocked extensions case-insensitively', () => {
    const cb = vi.fn();
    uploadConfig.fileFilter({}, buildFile('script.SH', 'text/plain'), cb);

    const [err, allowed] = cb.mock.calls[0];
    expect(err.message).toBe('File type not allowed');
    expect(allowed).toBe(false);
  });

  it('accepts a file with an allowed extension even if mimetype is unrecognized', () => {
    const cb = vi.fn();
    uploadConfig.fileFilter({}, buildFile('report.pdf', 'application/unknown'), cb);

    expect(cb).toHaveBeenCalledWith(null, true);
  });

  it('accepts a file with an allowed mimetype even if extension is unrecognized', () => {
    const cb = vi.fn();
    uploadConfig.fileFilter({}, buildFile('data.unknownext', 'text/csv'), cb);

    expect(cb).toHaveBeenCalledWith(null, true);
  });

  it('rejects a file whose extension and mimetype are both unrecognized', () => {
    const cb = vi.fn();
    uploadConfig.fileFilter({}, buildFile('data.xyz', 'application/x-weird'), cb);

    const [err, allowed] = cb.mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Invalid file type');
    expect(allowed).toBe(false);
  });

  it('treats a missing originalname as having no extension', () => {
    const cb = vi.fn();
    uploadConfig.fileFilter({}, { originalname: undefined, mimetype: 'image/jpeg' }, cb);

    expect(cb).toHaveBeenCalledWith(null, true);
  });
});

describe('uploadConfig - storage.filename', () => {
  it('sanitizes unsafe characters and preserves the extension in a unique name', () => {
    const cb = vi.fn();
    uploadConfig.storage.getFilename({}, { originalname: '../weird name!@#.png' }, cb);

    expect(cb).toHaveBeenCalledTimes(1);
    const [err, fileName] = cb.mock.calls[0];
    expect(err).toBeNull();
    expect(fileName).toMatch(/^\d+-[0-9a-f-]{36}-weird_name___\.png$/);
  });

  it('falls back to a default base name when originalname is missing', () => {
    const cb = vi.fn();
    uploadConfig.storage.getFilename({}, { originalname: undefined }, cb);

    const [err, fileName] = cb.mock.calls[0];
    expect(err).toBeNull();
    expect(fileName).toMatch(/^\d+-[0-9a-f-]{36}-file$/);
  });

  it('strips directory components from originalname (path traversal)', () => {
    const cb = vi.fn();
    uploadConfig.storage.getFilename({}, { originalname: '/etc/passwd' }, cb);

    const [, fileName] = cb.mock.calls[0];
    expect(fileName.endsWith('-passwd')).toBe(true);
    expect(fileName).not.toContain('/');
  });
});

describe('uploadConfig - storage.destination', () => {
  beforeEach(() => {
    vi.spyOn(fs, 'existsSync');
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates the year/month directory when it does not already exist', () => {
    fs.existsSync.mockReturnValue(false);
    const cb = vi.fn();

    uploadConfig.storage.getDestination({}, {}, cb);

    expect(fs.mkdirSync).toHaveBeenCalledTimes(1);
    const [dirArg, opts] = fs.mkdirSync.mock.calls[0];
    expect(opts).toEqual({ recursive: true });
    expect(cb).toHaveBeenCalledWith(null, dirArg);

    const now = new Date();
    const year = String(now.getFullYear());
    const month = String(now.getMonth() + 1).padStart(2, '0');
    expect(dirArg).toBe(path.join(uploadConfig.UPLOAD_ROOT, year, month));
  });

  it('does not recreate the directory when it already exists', () => {
    fs.existsSync.mockReturnValue(true);
    const cb = vi.fn();

    uploadConfig.storage.getDestination({}, {}, cb);

    expect(fs.mkdirSync).not.toHaveBeenCalled();
    expect(cb).toHaveBeenCalledWith(null, expect.any(String));
  });

  it('routes errors to the callback instead of throwing', () => {
    fs.existsSync.mockImplementation(() => {
      throw new Error('disk unavailable');
    });
    const cb = vi.fn();

    uploadConfig.storage.getDestination({}, {}, cb);

    expect(cb).toHaveBeenCalledTimes(1);
    const [err, dir] = cb.mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('disk unavailable');
    expect(dir).toBeNull();
  });
});

// #893: read_only:true prod containers have no writable mount under /app --
// UPLOAD_DIR/STORAGE_DIR let compose.prod.yml point these roots at a volume
// mounted outside it, while every existing caller keeps today's default.
describe('uploadConfig - UPLOADS_BASE / STORAGE_BASE (#893)', () => {
  const originalUploadDir = env.UPLOAD_DIR;
  const originalStorageDir = env.STORAGE_DIR;

  afterEach(() => {
    env.UPLOAD_DIR = originalUploadDir;
    env.STORAGE_DIR = originalStorageDir;
    delete require.cache[uploadConfigPath];
  });

  it('defaults UPLOADS_BASE to __dirname/../../uploads when UPLOAD_DIR is unset', () => {
    env.UPLOAD_DIR = undefined;
    const fresh = freshUploadConfig();
    const expected = path.join(path.dirname(uploadConfigPath), '..', '..', 'uploads');
    expect(fresh.UPLOADS_BASE).toBe(expected);
  });

  it('uses env.UPLOAD_DIR for UPLOADS_BASE when set', () => {
    env.UPLOAD_DIR = path.join('C:', 'tmp', 'custom-uploads');
    const fresh = freshUploadConfig();
    expect(fresh.UPLOADS_BASE).toBe(path.join('C:', 'tmp', 'custom-uploads'));
  });

  it('defaults STORAGE_BASE to __dirname/../../storage when STORAGE_DIR is unset', () => {
    env.STORAGE_DIR = undefined;
    const fresh = freshUploadConfig();
    const expected = path.join(path.dirname(uploadConfigPath), '..', '..', 'storage');
    expect(fresh.STORAGE_BASE).toBe(expected);
  });

  it('uses env.STORAGE_DIR for STORAGE_BASE when set', () => {
    env.STORAGE_DIR = path.join('C:', 'tmp', 'custom-storage');
    const fresh = freshUploadConfig();
    expect(fresh.STORAGE_BASE).toBe(path.join('C:', 'tmp', 'custom-storage'));
  });

  it('keeps UPLOAD_ROOT derived from UPLOADS_BASE', () => {
    env.UPLOAD_DIR = path.join('C:', 'tmp', 'custom-uploads-2');
    const fresh = freshUploadConfig();
    expect(fresh.UPLOAD_ROOT).toBe(path.join(fresh.UPLOADS_BASE, 'analysis'));
  });
});
