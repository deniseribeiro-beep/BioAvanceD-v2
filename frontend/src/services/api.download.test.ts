import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api, { resultService } from './api';

// #1337: resultService.download saves a result file through a temporary link,
// follows a JSON redirect, and turns every error shape into one message.
const DEFAULT_MESSAGE = 'Erro ao fazer download do arquivo';

function reply(data: unknown, headers: Record<string, string> = {}, status = 200) {
  return { data, headers, status } as any;
}

// jsdom's Blob has no text(); the client reads one with it, so these carry their own.
function textBlob(text: string) {
  return Object.assign(new Blob([text]), { text: async () => text });
}

function jsonBlob(value: unknown) {
  return textBlob(JSON.stringify(value));
}

let clicked: string[];
let open: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clicked = [];
  open = vi.fn();
  vi.spyOn(window, 'open').mockImplementation(open as any);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  (window.URL as any).createObjectURL = vi.fn(() => 'blob:result');
  (window.URL as any).revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this.download);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resultService.download: a file', () => {
  it('requests a blob and saves it under resultado_<id>.pdf with no Content-Disposition', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(reply(new Blob(['%PDF']), { 'content-type': 'application/pdf' }));

    await resultService.download(9);

    expect(get).toHaveBeenCalledWith('/results/9/download', { responseType: 'blob' });
    expect(clicked).toEqual(['resultado_9.pdf']);
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:result');
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it.each([
    ['a quoted name', 'attachment; filename="laudo final.pdf"', 'laudo final.pdf'],
    ['an encoded name', "attachment; filename=laudo%20A.pdf", 'laudo A.pdf'],
    ['a name that is not valid URI encoding', 'attachment; filename=laudo%E0.pdf', 'laudo%E0.pdf'],
    ['a header with no filename', 'inline', 'resultado_9.pdf'],
  ])('takes the file name from %s', async (_label, disposition, expected) => {
    vi.spyOn(api, 'get').mockResolvedValue(reply(new Blob(['x']), { 'content-disposition': disposition }));

    await resultService.download(9);

    expect(clicked).toEqual([expected]);
  });
});

describe('resultService.download: a JSON answer', () => {
  it('opens a redirect URL in a new tab and saves nothing', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(
      reply(jsonBlob({ redirect: true, url: 'https://files.example/r/9' }), { 'content-type': 'application/json' }),
    );

    await expect(resultService.download(9)).resolves.toBeUndefined();

    expect(open).toHaveBeenCalledWith('https://files.example/r/9', '_blank');
    expect(clicked).toEqual([]);
  });

  it.each([
    ['its error', { error: 'arquivo removido' }, 'arquivo removido'],
    ['its message', { message: 'sem permissão' }, 'sem permissão'],
    ['the default text', {}, DEFAULT_MESSAGE],
  ])('throws %s from a JSON body already parsed', async (_label, body, expected) => {
    vi.spyOn(api, 'get').mockResolvedValue(reply(body, { 'content-type': 'application/json; charset=utf-8' }));

    await expect(resultService.download(9)).rejects.toThrow(expected);
    expect(clicked).toEqual([]);
  });

  // #1420: a JSON error body that parses reaches the caller at any status.
  it.each([
    ['its error from a parsed body', 403, { error: 'fora do escopo' }, 'fora do escopo'],
    ['its message from a blob body', 410, jsonBlob({ message: 'link expirado' }), 'link expirado'],
    ['the default text from a body with neither', 404, {}, DEFAULT_MESSAGE],
  ])('throws %s on an error status', async (_label, status, body, expected) => {
    vi.spyOn(api, 'get').mockResolvedValue(reply(body, { 'content-type': 'application/json' }, status));

    await expect(resultService.download(9)).rejects.toHaveProperty('message', expected);
    expect(clicked).toEqual([]);
  });

  it('throws the default text for unparseable JSON on an error status', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(reply('{not json', { 'content-type': 'application/json' }, 500));

    await expect(resultService.download(9)).rejects.toThrow(DEFAULT_MESSAGE);
  });

  it('rethrows the parse error for unparseable JSON on a 200', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(reply('{not json', { 'content-type': 'application/json' }, 200));

    await expect(resultService.download(9)).rejects.toThrow(/JSON/);
  });
});

describe('resultService.download: a failed request', () => {
  // #1420: a blob body's own error text reaches the caller; the status line
  // stands in only when the body does not parse.
  it.each([
    ['a blob body holding a JSON error', { status: 404, statusText: 'Not Found', data: jsonBlob({ error: 'não encontrado' }) }, 'não encontrado'],
    ['a blob body holding a JSON message', { status: 403, statusText: 'Forbidden', data: jsonBlob({ message: 'fora do escopo' }) }, 'fora do escopo'],
    ['a blob body holding JSON with neither', { status: 404, statusText: 'Not Found', data: jsonBlob({}) }, DEFAULT_MESSAGE],
    ['a blob body holding JSON null', { status: 404, statusText: 'Not Found', data: textBlob('null') }, DEFAULT_MESSAGE],
    ['a blob body that is not JSON', { status: 502, statusText: 'Bad Gateway', data: textBlob('<html>') }, 'Erro 502: Bad Gateway'],
    ['a blob body with no status text', { status: 502, data: textBlob('<html>') }, `Erro 502: ${DEFAULT_MESSAGE}`],
    ['a JSON body with an error', { status: 403, data: { error: 'proibido' } }, 'proibido'],
    ['a JSON body with a message', { status: 403, data: { message: 'negado' } }, 'negado'],
    ['an empty JSON body', { status: 403, data: {} }, DEFAULT_MESSAGE],
    ['a text body with a status text', { status: 500, statusText: 'Internal Server Error', data: 'x' }, 'Internal Server Error'],
    ['a text body with no status text', { status: 500, data: 'x' }, 'Erro 500 ao fazer download do arquivo'],
  ])('reports %s', async (_label, response, expected) => {
    vi.spyOn(api, 'get').mockRejectedValue({ response });

    await expect(resultService.download(9)).rejects.toHaveProperty('message', expected);
  });

  it.each([
    ['its message', new Error('Network Error'), 'Network Error'],
    ['the default text', {}, DEFAULT_MESSAGE],
  ])('reports a failure with no response by %s', async (_label, err, expected) => {
    vi.spyOn(api, 'get').mockRejectedValue(err);

    await expect(resultService.download(9)).rejects.toThrow(expected);
  });
});
