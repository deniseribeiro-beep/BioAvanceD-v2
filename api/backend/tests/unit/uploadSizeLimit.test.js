import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const express = require('express');

const SRC = path.resolve(__dirname, '../../src');
const env = require(path.join(SRC, 'config/env'));
const uploadConfigPath = require.resolve(path.join(SRC, 'config/uploadConfig'));
const uploadControllerPath = require.resolve(path.join(SRC, 'controllers/upload.controller'));
const linkedControllerPath = require.resolve(path.join(SRC, 'controllers/createLinkedFileController'));

// RNF016 C7 (#1555): Object Storage's upload limit is 500 MB. The real
// multer parser reads a multipart body exactly at the limit and one byte over
// it; the body is generated chunk by chunk, so the test holds 1 MB in memory,
// while multer stages up to the limit on disk under a temporary directory and
// removes it.
const LIMIT_BYTES = 500 * 1024 * 1024;
const BOUNDARY = 'rnf016c7boundary';
const CHUNK = Buffer.alloc(1024 * 1024, 0x61);

function multipartRequest(fileBytes, fileName = 'readings.csv', mimeType = 'text/csv') {
  const head = Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\n`
    + `Content-Type: ${mimeType}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${BOUNDARY}--\r\n`);
  let sent = 0;
  let phase = 'head';
  const req = new Readable({
    read() {
      if (phase === 'head') { phase = 'body'; this.push(head); return; }
      if (phase === 'body') {
        const n = Math.min(CHUNK.length, fileBytes - sent);
        if (n > 0) { sent += n; this.push(n === CHUNK.length ? CHUNK : CHUNK.subarray(0, n)); return; }
        phase = 'done';
        this.push(tail);
        this.push(null);
      }
    }
  });
  req.headers = {
    'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
    'content-length': String(head.length + fileBytes + tail.length)
  };
  return req;
}

function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

function linkedController() {
  const createLinkedFileController = require(linkedControllerPath);
  return createLinkedFileController({
    parentCollectionName: 'widgets',
    parentIdParam: 'widgetId',
    parentIdField: 'widgetId',
    fileCollectionName: 'widgetFiles',
    storageSubdir: 'widgets',
    resourceType: 'WidgetFile',
    moduleLabel: 'Widgets'
  });
}

function resMock(onJson = () => {}) {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn((payload) => { onJson(payload); return res; })
  };
  return res;
}

// Runs a middleware on a mocked request and response; resolves with the
// argument it passes next, or with the body it answers.
function runMiddleware(middleware, req) {
  return new Promise((resolve) => {
    const res = resMock((payload) => resolve({ res, body: payload, nextCalled: false }));
    middleware(req, res, (...args) => resolve({ res, nextArgs: args, nextCalled: true }));
  });
}

describe('RNF016 C7: Object Storage accepts an upload of 500 MB and refuses one over it (#1555)', () => {
  const originalStorageDir = env.STORAGE_DIR;
  const originalUploadDir = env.UPLOAD_DIR;
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rnf016-c7-'));
    env.STORAGE_DIR = path.join(tmp, 'storage');
    env.UPLOAD_DIR = path.join(tmp, 'uploads');
    delete require.cache[uploadConfigPath];
    delete require.cache[uploadControllerPath];
    delete require.cache[linkedControllerPath];
  });

  afterEach(() => {
    env.STORAGE_DIR = originalStorageDir;
    env.UPLOAD_DIR = originalUploadDir;
    delete require.cache[uploadConfigPath];
    delete require.cache[uploadControllerPath];
    delete require.cache[linkedControllerPath];
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('RNF016 C7: an assay or dataset file one byte over 500 MB answers 400 File too large and leaves no staged file', async () => {
    const req = multipartRequest(LIMIT_BYTES + 1);
    req.params = { widgetId: 'w-1' };

    const outcome = await runMiddleware(linkedController().uploadMiddleware(), req);

    expect(outcome.nextCalled).toBe(false);
    expect(outcome.res.status).toHaveBeenCalledWith(400);
    expect(outcome.body).toEqual({ success: false, error: 'File too large' });
    expect(filesUnder(path.join(tmp, 'storage'))).toEqual([]);
  }, 60_000);

  it('RNF016 C7: an assay or dataset file of exactly 500 MB passes the upload middleware with the whole file staged', async () => {
    const req = multipartRequest(LIMIT_BYTES);
    req.params = { widgetId: 'w-1' };

    const outcome = await runMiddleware(linkedController().uploadMiddleware(), req);

    expect(outcome.res.status).not.toHaveBeenCalled();
    expect(outcome.nextCalled).toBe(true);
    expect(outcome.nextArgs).toEqual([]);
    expect(req.file.size).toBe(LIMIT_BYTES);
    expect(fs.statSync(req.file.path).size).toBe(LIMIT_BYTES);
  }, 60_000);

  it('RNF016 C7: an analysis file one byte over 500 MB on the route\'s upload middleware is refused with a LIMIT_FILE_SIZE error that carries no status, so Express answers 500 and leaves no staged file', async () => {
    const uploadController = require(uploadControllerPath);
    const app = express();
    let passed;
    let reached = false;
    // The middleware the analysis-file route mounts, with its next observed;
    // the app registers no error handler, as the real one does not.
    const middleware = uploadController.uploadMiddleware();
    app.post('/upload', (req, res, next) => middleware(req, res, (err) => { passed = err; next(err); }), (req, res) => {
      reached = true;
      res.status(201).end();
    });
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
      const body = multipartRequest(LIMIT_BYTES + 1);
      const status = await new Promise((resolve, reject) => {
        const request = http.request({
          host: '127.0.0.1',
          port: server.address().port,
          method: 'POST',
          path: '/upload',
          headers: body.headers
        }, (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode));
        });
        request.on('error', reject);
        body.pipe(request);
      });

      expect(status).toBe(500);
      expect(reached).toBe(false);
      expect(passed).toBeInstanceOf(Error);
      expect(passed.code).toBe('LIMIT_FILE_SIZE');
      expect(passed.status).toBeUndefined();
      expect(passed.statusCode).toBeUndefined();
      expect(filesUnder(path.join(tmp, 'uploads'))).toEqual([]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 60_000);

  it('RNF016 C7: an analysis file of exactly 500 MB passes the route\'s upload middleware with the whole file staged', async () => {
    const uploadController = require(uploadControllerPath);
    const req = multipartRequest(LIMIT_BYTES);

    const outcome = await runMiddleware(uploadController.uploadMiddleware(), req);

    expect(outcome.res.status).not.toHaveBeenCalled();
    expect(outcome.nextCalled).toBe(true);
    expect(outcome.nextArgs).toEqual([]);
    expect(req.file.size).toBe(LIMIT_BYTES);
    expect(fs.statSync(req.file.path).size).toBe(LIMIT_BYTES);
  }, 60_000);
});
