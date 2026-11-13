import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);

const env = require('../../src/config/env');
const childProcess = require('child_process');

const execFileMock = vi.fn();
childProcess.execFile = execFileMock;

const auditTsaService = require('../../src/services/audit-tsa.service');
const { runWithRequestId } = require('../../src/utils/requestContext');

function writeFakeReplyForQuery(args) {
  const outIndex = args.indexOf('-out');
  const queryPath = args[outIndex + 1];
  fs.writeFileSync(queryPath, Buffer.from('fake-tsq-content'));
}

describe('audit-tsa.service', () => {
  beforeEach(() => {
    env.AUDIT_RFC3161_TSA_URL = 'https://tsa.example.test/token';
    execFileMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lanca erro quando AUDIT_RFC3161_TSA_URL nao esta configurado', async () => {
    env.AUDIT_RFC3161_TSA_URL = '';

    await expect(auditTsaService.requestTimestamp('a'.repeat(64))).rejects.toThrow(
      'AUDIT_RFC3161_TSA_URL não configurado',
    );
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('lanca erro quando AUDIT_RFC3161_TSA_URL e apenas espacos em branco', async () => {
    env.AUDIT_RFC3161_TSA_URL = '   ';

    await expect(auditTsaService.requestTimestamp('a'.repeat(64))).rejects.toThrow(
      'AUDIT_RFC3161_TSA_URL não configurado',
    );
  });

  it('propaga erro do execFile (openssl) e remove o diretorio temporario', async () => {
    let capturedWorkDir;
    execFileMock.mockImplementation((file, args, options, callback) => {
      const outIndex = args.indexOf('-out');
      capturedWorkDir = path.dirname(args[outIndex + 1]);
      const error = new Error('openssl_failed');
      callback(error, '', 'stderr output');
    });

    await expect(auditTsaService.requestTimestamp('b'.repeat(64))).rejects.toThrow(
      'openssl_failed',
    );

    expect(capturedWorkDir).toBeTruthy();
    expect(fs.existsSync(capturedWorkDir)).toBe(false);
  });

  it('lanca erro tsa_http_<status> quando o TSA responde com status nao-ok e remove o diretorio temporario', async () => {
    let capturedWorkDir;
    execFileMock.mockImplementation((file, args, options, callback) => {
      capturedWorkDir = path.dirname(args[args.indexOf('-out') + 1]);
      writeFakeReplyForQuery(args);
      callback(null, '', '');
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    await expect(auditTsaService.requestTimestamp('c'.repeat(64))).rejects.toThrow(
      'tsa_http_503',
    );

    expect(fs.existsSync(capturedWorkDir)).toBe(false);
  });

  it('retorna TIMESTAMPED com token/tokenDerHex/messageImprint em caso de sucesso e remove o diretorio temporario', async () => {
    let capturedWorkDir;
    execFileMock.mockImplementation((file, args, options, callback) => {
      capturedWorkDir = path.dirname(args[args.indexOf('-out') + 1]);
      writeFakeReplyForQuery(args);
      callback(null, '', '');
    });
    const replyBytes = Buffer.from('fake-tsr-reply');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => replyBytes.buffer.slice(
          replyBytes.byteOffset,
          replyBytes.byteOffset + replyBytes.byteLength,
        ),
      }),
    );

    const messageImprint = 'd'.repeat(64);
    const result = await auditTsaService.requestTimestamp(messageImprint);

    expect(result.status).toBe('TIMESTAMPED');
    expect(result.token).toBe(replyBytes.toString('base64'));
    expect(result.tokenDerHex).toBe(replyBytes.toString('hex'));
    expect(result.messageImprint).toBe(messageImprint);
    expect(fs.existsSync(capturedWorkDir)).toBe(false);

    expect(execFileMock).toHaveBeenCalledWith(
      'openssl',
      ['ts', '-query', '-digest', messageImprint, '-sha256', '-cert', '-out', expect.any(String)],
      expect.objectContaining({ windowsHide: true }),
      expect.any(Function),
    );
  });

  it('chama o TSA via POST com o corpo da query e o content-type correto', async () => {
    execFileMock.mockImplementation((file, args, options, callback) => {
      writeFakeReplyForQuery(args);
      callback(null, '', '');
    });
    const replyBytes = Buffer.from('another-reply');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => replyBytes.buffer.slice(
        replyBytes.byteOffset,
        replyBytes.byteOffset + replyBytes.byteLength,
      ),
    });
    vi.stubGlobal('fetch', fetchMock);

    await auditTsaService.requestTimestamp('e'.repeat(64));

    expect(fetchMock).toHaveBeenCalledWith(
      env.AUDIT_RFC3161_TSA_URL,
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/timestamp-query' },
        body: expect.any(Buffer),
      }),
    );
  });

  // #1468 (RNF015 C3): the TSA can tie the call to the request or job that made it.
  it('envia X-Request-Id ao TSA dentro de um request e nenhum fora dele', async () => {
    execFileMock.mockImplementation((file, args, options, callback) => {
      writeFakeReplyForQuery(args);
      callback(null, '', '');
    });
    const replyBytes = Buffer.from('reply-1468');
    const fetchMock = vi.fn().mockImplementation(async () => ({
      ok: true,
      arrayBuffer: async () => replyBytes.buffer.slice(
        replyBytes.byteOffset,
        replyBytes.byteOffset + replyBytes.byteLength,
      ),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await runWithRequestId('req-1468-0001', () => auditTsaService.requestTimestamp('f'.repeat(64)));
    await auditTsaService.requestTimestamp('f'.repeat(64));

    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      'content-type': 'application/timestamp-query',
      'X-Request-Id': 'req-1468-0001',
    });
    expect(fetchMock.mock.calls[1][1].headers).not.toHaveProperty('X-Request-Id');
  });
});
