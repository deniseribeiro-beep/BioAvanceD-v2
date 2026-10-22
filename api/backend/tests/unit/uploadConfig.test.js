import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fs = require('fs');
const os = require('os');
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

  // #1321 (RF007 AC1, RNF029 C1): the extension AND its MIME must both be
  // allowed; an allowed extension no longer carries an unrelated MIME.
  it('rejects an allowed extension whose mimetype is not allowed for it', () => {
    const cb = vi.fn();
    uploadConfig.fileFilter({}, buildFile('report.pdf', 'application/unknown'), cb);

    const [err, allowed] = cb.mock.calls[0];
    expect(err.message).toBe('Invalid file type');
    expect(allowed).toBe(false);
  });

  it('rejects an unrecognized extension even with an allowed mimetype', () => {
    const cb = vi.fn();
    uploadConfig.fileFilter({}, buildFile('data.unknownext', 'text/csv'), cb);

    const [err, allowed] = cb.mock.calls[0];
    expect(err.message).toBe('Invalid file type');
    expect(allowed).toBe(false);
  });

  it('rejects a file whose extension and mimetype are both unrecognized', () => {
    const cb = vi.fn();
    uploadConfig.fileFilter({}, buildFile('data.xyz', 'application/x-weird'), cb);

    const [err, allowed] = cb.mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Invalid file type');
    expect(allowed).toBe(false);
  });

  it('rejects a missing originalname, which has no extension', () => {
    const cb = vi.fn();
    uploadConfig.fileFilter({}, { originalname: undefined, mimetype: 'image/jpeg' }, cb);

    const [err, allowed] = cb.mock.calls[0];
    expect(err.message).toBe('Invalid file type');
    expect(allowed).toBe(false);
  });

  it('rejects an extension with a format policy that this upload does not allow', () => {
    const cb = vi.fn();
    uploadConfig.fileFilter({}, buildFile('notes.json', 'application/json'), cb);

    const [err, allowed] = cb.mock.calls[0];
    expect(err.message).toBe('Invalid file type');
    expect(allowed).toBe(false);
  });

  it('accepts an allowed extension with its own mimetype', () => {
    const cb = vi.fn();
    uploadConfig.fileFilter({}, buildFile('report.pdf', 'application/pdf'), cb);

    expect(cb).toHaveBeenCalledWith(null, true);
  });

  it('accepts an allowed extension sent as application/octet-stream', () => {
    const cb = vi.fn();
    uploadConfig.fileFilter({}, buildFile('scan.raw', 'application/octet-stream'), cb);

    expect(cb).toHaveBeenCalledWith(null, true);
  });
});

// #1321 (RF007 AC1, RNF029 C1): after multer writes the file, its leading
// bytes must match the extension's format, or the upload is removed.
describe('uploadConfig - verifyUploadedFileSignature', () => {
  const written = [];

  function writeTemp(name, content) {
    const filePath = path.join(os.tmpdir(), `upload-config-${process.pid}-${written.length}-${Date.now()}-${name}`);
    fs.writeFileSync(filePath, content);
    written.push(filePath);
    return filePath;
  }

  const buildRes = () => ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis()
  });

  afterEach(() => {
    while (written.length) {
      const filePath = written.pop();
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  });

  it('calls next for a .pdf that starts with a PDF header', () => {
    const filePath = writeTemp('report.pdf', '%PDF-1.7\n');
    const req = { file: { originalname: 'report.pdf', path: filePath } };
    const res = buildRes();
    const next = vi.fn();

    uploadConfig.verifyUploadedFileSignature(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('answers 400 and removes a .pdf whose content is not a PDF', () => {
    const filePath = writeTemp('report.pdf', 'hello');
    const req = { file: { originalname: 'report.pdf', path: filePath } };
    const res = buildRes();
    const next = vi.fn();

    uploadConfig.verifyUploadedFileSignature(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Invalid file content' });
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('calls next when no file was uploaded', () => {
    const res = buildRes();
    const next = vi.fn();

    uploadConfig.verifyUploadedFileSignature({}, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
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
