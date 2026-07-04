import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');
const uploadConfig = require('../../src/config/uploadConfig');

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
