import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSampleFiles } from './useSampleFiles';
import { sampleService } from '../services/api';

// Behaviour of every action useSampleFiles returns: the list load and its
// response shapes, upload/delete reloading the list, the four download-style
// actions (file, HL7 v2.x, FHIR, CDA) and each action's error message order.
// The stale-response race (#901) lives in useSampleFiles.test.tsx.
vi.mock('../services/api', () => ({
  sampleService: {
    listFiles: vi.fn(),
    uploadFile: vi.fn(),
    downloadFile: vi.fn(),
    deleteFile: vi.fn(),
    exportHL7v2: vi.fn(),
    exportFHIR: vi.fn(),
    exportCDA: vi.fn(),
  },
}));

const svc = vi.mocked(sampleService);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function httpError(data: Record<string, unknown>, message = 'Request failed') {
  return Object.assign(new Error(message), { response: { data } });
}

let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
let clickSpy: ReturnType<typeof vi.spyOn>;
let clicked: Array<{ href: string; download: string | null; attached: boolean }>;
const originalCreate = window.URL.createObjectURL;
const originalRevoke = window.URL.revokeObjectURL;

beforeEach(() => {
  vi.clearAllMocks();
  clicked = [];
  createObjectURL = vi.fn(() => 'blob:mock-url');
  revokeObjectURL = vi.fn();
  window.URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
  window.URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({
      href: this.getAttribute('href') ?? '',
      download: this.getAttribute('download'),
      attached: document.body.contains(this),
    });
  });
});

afterEach(() => {
  clickSpy.mockRestore();
  window.URL.createObjectURL = originalCreate;
  window.URL.revokeObjectURL = originalRevoke;
});

function blobPassed(): Blob {
  return createObjectURL.mock.calls[0][0] as Blob;
}

// jsdom's Blob has no text(); FileReader reads it back.
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe('useSampleFiles loadFiles', () => {
  it('starts empty, idle and without error', () => {
    const { result } = renderHook(() => useSampleFiles('s1'));
    expect(result.current.files).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('with no sampleID clears the list and calls no service', async () => {
    svc.listFiles.mockResolvedValue({ data: [{ id: 'f1' }] } as any);
    const { result, rerender } = renderHook(({ id }: { id: string | null }) => useSampleFiles(id), {
      initialProps: { id: 's1' as string | null },
    });
    await act(async () => {
      await result.current.loadFiles();
    });
    expect(result.current.files).toEqual([{ id: 'f1' }]);
    rerender({ id: null });
    await act(async () => {
      await result.current.loadFiles();
    });
    expect(svc.listFiles).toHaveBeenCalledTimes(1);
    expect(result.current.files).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('reads the files from a { success, data: [...] } envelope', async () => {
    svc.listFiles.mockResolvedValue({ data: { success: true, data: [{ id: 'f1' }, { id: 'f2' }] } } as any);
    const { result } = renderHook(() => useSampleFiles('s1'));
    await act(async () => {
      await result.current.loadFiles();
    });
    expect(svc.listFiles).toHaveBeenCalledWith('s1');
    expect(result.current.files).toEqual([{ id: 'f1' }, { id: 'f2' }]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('reads the files from a bare array body', async () => {
    svc.listFiles.mockResolvedValue({ data: [{ id: 'f3' }] } as any);
    const { result } = renderHook(() => useSampleFiles('s1'));
    await act(async () => {
      await result.current.loadFiles();
    });
    expect(result.current.files).toEqual([{ id: 'f3' }]);
  });

  it.each([
    ['an object whose data is not an array', { success: true, data: { id: 'x' } }],
    ['a null body', null],
  ])('falls back to an empty list for %s', async (_label, body) => {
    svc.listFiles.mockResolvedValue({ data: body } as any);
    const { result } = renderHook(() => useSampleFiles('s1'));
    await act(async () => {
      await result.current.loadFiles();
    });
    expect(result.current.files).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('is loading while the request is in flight', async () => {
    const d = deferred<any>();
    svc.listFiles.mockReturnValue(d.promise);
    const { result } = renderHook(() => useSampleFiles('s1'));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.loadFiles();
    });
    await waitFor(() => expect(result.current.loading).toBe(true));
    await act(async () => {
      d.resolve({ data: [] });
      await pending;
    });
    expect(result.current.loading).toBe(false);
  });

  it.each([
    ['the response error field', httpError({ error: 'Amostra inexistente' }), 'Amostra inexistente'],
    ['the error message when the body has no error', httpError({}, 'Network Error'), 'Network Error'],
    ['the default text when nothing else is set', Object.assign(new Error(''), {}), 'Erro ao carregar arquivos'],
  ])('on failure sets error from %s and empties the list', async (_label, err, expected) => {
    svc.listFiles.mockResolvedValueOnce({ data: [{ id: 'old' }] } as any);
    const { result } = renderHook(() => useSampleFiles('s1'));
    await act(async () => {
      await result.current.loadFiles();
    });
    expect(result.current.files).toEqual([{ id: 'old' }]);

    svc.listFiles.mockRejectedValueOnce(err);
    await act(async () => {
      await result.current.loadFiles();
    });
    expect(result.current.error).toBe(expected);
    expect(result.current.files).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('clears an earlier error when a later load succeeds', async () => {
    svc.listFiles.mockRejectedValueOnce(httpError({ error: 'boom' }));
    const { result } = renderHook(() => useSampleFiles('s1'));
    await act(async () => {
      await result.current.loadFiles();
    });
    expect(result.current.error).toBe('boom');

    svc.listFiles.mockResolvedValueOnce({ data: [{ id: 'f1' }] } as any);
    await act(async () => {
      await result.current.loadFiles();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.files).toEqual([{ id: 'f1' }]);
  });

  it('discards the error of a superseded load', async () => {
    const first = deferred<any>();
    svc.listFiles.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ data: [{ id: 'fresh' }] } as any);
    const { result } = renderHook(() => useSampleFiles('s1'));
    let stale!: Promise<void>;
    act(() => {
      stale = result.current.loadFiles();
    });
    await act(async () => {
      await result.current.loadFiles();
    });
    expect(result.current.files).toEqual([{ id: 'fresh' }]);

    await act(async () => {
      first.reject(httpError({ error: 'stale failure' }));
      await stale;
    });
    expect(result.current.error).toBeNull();
    expect(result.current.files).toEqual([{ id: 'fresh' }]);
    expect(result.current.loading).toBe(false);
  });
});

describe('useSampleFiles uploadFile', () => {
  const file = new File(['abc'], 'laudo.pdf', { type: 'application/pdf' });

  it('rejects without a sampleID and calls no service', async () => {
    const { result } = renderHook(() => useSampleFiles(null));
    await expect(result.current.uploadFile(file)).rejects.toThrow('ID da amostra não fornecido');
    expect(svc.uploadFile).not.toHaveBeenCalled();
  });

  it('posts the file as multipart form data, reloads the list and returns the enveloped file', async () => {
    svc.uploadFile.mockResolvedValue({ data: { success: true, data: { id: 'new' } } } as any);
    svc.listFiles.mockResolvedValue({ data: [{ id: 'new' }] } as any);
    const { result } = renderHook(() => useSampleFiles('s1'));
    let returned: unknown;
    await act(async () => {
      returned = await result.current.uploadFile(file);
    });
    expect(returned).toEqual({ id: 'new' });
    const [id, form] = svc.uploadFile.mock.calls[0];
    expect(id).toBe('s1');
    expect(form).toBeInstanceOf(FormData);
    expect((form as FormData).get('file')).toBe(file);
    expect(svc.listFiles).toHaveBeenCalledWith('s1');
    expect(result.current.files).toEqual([{ id: 'new' }]);
  });

  it('returns the body itself when it carries no data envelope', async () => {
    svc.uploadFile.mockResolvedValue({ data: { id: 'bare' } } as any);
    svc.listFiles.mockResolvedValue({ data: [] } as any);
    const { result } = renderHook(() => useSampleFiles('s1'));
    let returned: unknown;
    await act(async () => {
      returned = await result.current.uploadFile(file);
    });
    expect(returned).toEqual({ id: 'bare' });
  });

  it.each([
    ['the response error field', httpError({ error: 'Arquivo grande demais', message: 'ignored' }), 'Arquivo grande demais'],
    ['the response message field', httpError({ message: 'Tipo não permitido' }), 'Tipo não permitido'],
    ['the error message', httpError({}, 'Network Error'), 'Network Error'],
    ['the default text', new Error(''), 'Erro ao fazer upload do arquivo'],
  ])('on failure rethrows %s and does not reload', async (_label, err, expected) => {
    svc.uploadFile.mockRejectedValue(err);
    const { result } = renderHook(() => useSampleFiles('s1'));
    await expect(result.current.uploadFile(file)).rejects.toThrow(new Error(expected));
    expect(svc.listFiles).not.toHaveBeenCalled();
  });
});

describe('useSampleFiles deleteFile', () => {
  it('rejects without a sampleID and calls no service', async () => {
    const { result } = renderHook(() => useSampleFiles(null));
    await expect(result.current.deleteFile('f1')).rejects.toThrow('ID da amostra não fornecido');
    expect(svc.deleteFile).not.toHaveBeenCalled();
  });

  it('deletes the file and reloads the list', async () => {
    svc.deleteFile.mockResolvedValue({ data: {} } as any);
    svc.listFiles.mockResolvedValue({ data: [{ id: 'kept' }] } as any);
    const { result } = renderHook(() => useSampleFiles('s1'));
    await act(async () => {
      await result.current.deleteFile('f1');
    });
    expect(svc.deleteFile).toHaveBeenCalledWith('s1', 'f1');
    expect(svc.listFiles).toHaveBeenCalledWith('s1');
    expect(result.current.files).toEqual([{ id: 'kept' }]);
  });

  it.each([
    ['the response error field', httpError({ error: 'Sem permissão', message: 'ignored' }), 'Sem permissão'],
    ['the response message field', httpError({ message: 'Arquivo em uso' }), 'Arquivo em uso'],
    ['the error message', httpError({}, 'Network Error'), 'Network Error'],
    ['the default text', new Error(''), 'Erro ao excluir arquivo'],
  ])('on failure rethrows %s and does not reload', async (_label, err, expected) => {
    svc.deleteFile.mockRejectedValue(err);
    const { result } = renderHook(() => useSampleFiles('s1'));
    await expect(result.current.deleteFile('f1')).rejects.toThrow(new Error(expected));
    expect(svc.listFiles).not.toHaveBeenCalled();
  });
});

describe('useSampleFiles downloadFile', () => {
  it('rejects without a sampleID and calls no service', async () => {
    const { result } = renderHook(() => useSampleFiles(null));
    await expect(result.current.downloadFile('f1', 'laudo.pdf')).rejects.toThrow('ID da amostra não fornecido');
    expect(svc.downloadFile).not.toHaveBeenCalled();
  });

  it('saves the response body under the given file name through a temporary link', async () => {
    svc.downloadFile.mockResolvedValue({ data: 'PDFBYTES' } as any);
    const { result } = renderHook(() => useSampleFiles('s1'));
    await act(async () => {
      await result.current.downloadFile('f1', 'laudo.pdf');
    });
    expect(svc.downloadFile).toHaveBeenCalledWith('s1', 'f1');
    expect(await readBlob(blobPassed())).toBe('PDFBYTES');
    expect(clicked).toEqual([{ href: 'blob:mock-url', download: 'laudo.pdf', attached: true }]);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it.each([
    ['the response error field', httpError({ error: 'Arquivo removido' }), 'Arquivo removido'],
    ['the error message', httpError({ message: 'not read here' }, 'Network Error'), 'Network Error'],
    ['the default text', new Error(''), 'Erro ao fazer download do arquivo'],
  ])('on failure rethrows %s', async (_label, err, expected) => {
    svc.downloadFile.mockRejectedValue(err);
    const { result } = renderHook(() => useSampleFiles('s1'));
    await expect(result.current.downloadFile('f1', 'laudo.pdf')).rejects.toThrow(new Error(expected));
    expect(clicked).toEqual([]);
  });
});

describe.each([
  {
    action: 'exportHL7v2' as const,
    body: 'MSH|^~\\&|BIO',
    savedText: 'MSH|^~\\&|BIO',
    mime: 'text/plain;charset=utf-8',
    fileName: 'hl7_f1.hl7',
    fallback: 'Erro ao exportar arquivo em HL7 v2.x',
  },
  {
    action: 'exportCDA' as const,
    body: '<ClinicalDocument/>',
    savedText: '<ClinicalDocument/>',
    mime: 'application/xml;charset=utf-8',
    fileName: 'cda_f1.xml',
    fallback: 'Erro ao exportar arquivo em CDA',
  },
  {
    action: 'exportFHIR' as const,
    body: '{"resourceType":"Bundle"}',
    savedText: '{"resourceType":"Bundle"}',
    mime: 'application/json;charset=utf-8',
    fileName: 'fhir_f1.json',
    fallback: 'Erro ao exportar arquivo em FHIR',
  },
])('useSampleFiles $action', ({ action, body, savedText, mime, fileName, fallback }) => {
  it('rejects without a sampleID and calls no service', async () => {
    const { result } = renderHook(() => useSampleFiles(null));
    await expect(result.current[action]('f1')).rejects.toThrow('ID da amostra não fornecido');
    expect(svc[action]).not.toHaveBeenCalled();
  });

  it(`saves the export as ${fileName}`, async () => {
    svc[action].mockResolvedValue({ data: body } as any);
    const { result } = renderHook(() => useSampleFiles('s1'));
    await act(async () => {
      await result.current[action]('f1');
    });
    expect(svc[action]).toHaveBeenCalledWith('s1', 'f1');
    const blob = blobPassed();
    expect(blob.type.replace(/\s/g, '')).toBe(mime);
    expect(await readBlob(blob)).toBe(savedText);
    expect(clicked).toEqual([{ href: 'blob:mock-url', download: fileName, attached: true }]);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it.each([
    ['the response error field', httpError({ error: 'Formato indisponível' }), 'Formato indisponível'],
    ['the error message', httpError({}, 'Network Error'), 'Network Error'],
    ['the default text', new Error(''), fallback],
  ])('on failure rethrows %s', async (_label, err, expected) => {
    svc[action].mockRejectedValue(err);
    const { result } = renderHook(() => useSampleFiles('s1'));
    await expect(result.current[action]('f1')).rejects.toThrow(new Error(expected));
    expect(clicked).toEqual([]);
  });
});

describe('useSampleFiles exportFHIR with a parsed JSON body', () => {
  it('pretty-prints an object body with two-space indent', async () => {
    const bundle = { resourceType: 'Bundle', entry: [] };
    svc.exportFHIR.mockResolvedValue({ data: bundle } as any);
    const { result } = renderHook(() => useSampleFiles('s1'));
    await act(async () => {
      await result.current.exportFHIR('f1');
    });
    expect(await readBlob(blobPassed())).toBe(JSON.stringify(bundle, null, 2));
  });
});
