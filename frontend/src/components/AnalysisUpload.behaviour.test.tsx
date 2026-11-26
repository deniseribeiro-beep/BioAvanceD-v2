import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import AnalysisUpload from './AnalysisUpload.jsx';
import { analysisFileService } from '../services/api';

vi.mock('../services/api', () => ({
  analysisFileService: {
    upload: vi.fn(),
    validateSample: vi.fn(),
  },
}));

// validateSample resolves to the Axios response, whose body is the result.
type ValidationBody = { success: boolean; error?: string; sample?: Record<string, string>; patient?: { _id: string } };
type ProgressEvent = { loaded: number; total?: number };
const validateSample = analysisFileService.validateSample as unknown as Mock<
  (id: string) => Promise<{ data: ValidationBody }>
>;
const upload = analysisFileService.upload as unknown as Mock<
  (fd: FormData, cb: (e: ProgressEvent) => void) => Promise<unknown>
>;

const TYPED_PLACEHOLDER = 'Digite o ID, código de barras ou escaneie QR code';
const QR_PLACEHOLDER = 'Escaneie o código de barras/QR code';

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const sendButton = () => screen.getByRole('button', { name: /Enviar Arquivo|Enviando\.\.\./ });
const typedInput = () => screen.getByPlaceholderText(TYPED_PLACEHOLDER) as HTMLInputElement;
const fileInput = () => screen.getByLabelText('Arquivo') as HTMLInputElement;
const progressLabel = (c: HTMLElement) => c.querySelector('.analysis-upload-progress-label')?.textContent;
const progressWidth = (c: HTMLElement) =>
  (c.querySelector('.analysis-upload-progress-fill') as HTMLElement).style.width;
const validationBox = (c: HTMLElement) => c.querySelector('.analysis-upload-validation');

const pickFile = (file: File | null) => {
  fireEvent.change(fileInput(), { target: { files: file ? [file] : [] } });
};

const makeFile = (name: string, size: number) => {
  const f = new File(['x'], name);
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

// Scans `id` through the QR input, which validates it at once.
const scan = async (id: string) => {
  fireEvent.click(screen.getByRole('button', { name: /QR Code/ }));
  await act(async () => {
    fireEvent.change(screen.getByPlaceholderText(QR_PLACEHOLDER), { target: { value: id } });
  });
};

const validSample = { data: { success: true, sample: { specimenId: 'SP-1', barcode: 'BC-9' }, patient: { _id: 'p1' } } };

beforeEach(() => {
  validateSample.mockReset();
  upload.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AnalysisUpload initial render', () => {
  it('shows 0% progress, no validation box, no file card, and a disabled send button', () => {
    const { container } = render(<AnalysisUpload />);
    expect(progressLabel(container)).toBe('0%');
    expect(progressWidth(container)).toBe('0%');
    expect(validationBox(container)).toBeNull();
    expect(container.querySelector('.analysis-upload-file')).toBeNull();
    expect(typedInput().value).toBe('');
    expect(sendButton()).toBeDisabled();
    expect(sendButton()).toHaveTextContent('Enviar Arquivo');
  });

  it('pre-fills the sample id from the sampleId prop', () => {
    render(<AnalysisUpload sampleId="AM-7" />);
    expect(typedInput().value).toBe('AM-7');
  });
});

describe('AnalysisUpload file selection', () => {
  it.each([
    ['photo.JPG', 1536, '.jpg', '1.50 KB', 'lucide-file-image'],
    ['report.pdf', 5 * 1024 * 1024, '.pdf', '5.00 MB', 'lucide-file-text'],
    ['bundle.zip', 0, '.zip', '0.00 B', 'lucide-archive'],
    ['data.bin', 3 * 1024 * 1024 * 1024, '.bin', '3.00 GB', 'lucide-file'],
    ['README', 512, 'Sem extensao', '512.00 B', 'lucide-file'],
  ])('%s shows extension %s, size %s and the %s icon', (name, size, ext, bytes, icon) => {
    const { container } = render(<AnalysisUpload />);
    pickFile(makeFile(name, size));
    const card = container.querySelector('.analysis-upload-file') as HTMLElement;
    expect(card.querySelector('.analysis-upload-file-name')?.textContent).toBe(name);
    const meta = Array.from(card.querySelectorAll('.analysis-upload-file-meta span')).map((s) => s.textContent);
    expect(meta).toEqual([ext, bytes]);
    const svg = card.querySelector('.analysis-upload-file-icon svg') as SVGElement;
    expect(svg.getAttribute('class')?.split(' ')).toContain(icon);
  });

  it('keeps units at GB above 1024 GB', () => {
    const { container } = render(<AnalysisUpload />);
    pickFile(makeFile('huge.raw', 2048 * 1024 * 1024 * 1024));
    const meta = Array.from(container.querySelectorAll('.analysis-upload-file-meta span')).map((s) => s.textContent);
    expect(meta).toEqual(['.raw', '2048.00 GB']);
  });

  it('removes the file card when the selection is emptied', () => {
    const { container } = render(<AnalysisUpload />);
    pickFile(makeFile('a.csv', 10));
    expect(container.querySelector('.analysis-upload-file')).not.toBeNull();
    pickFile(null);
    expect(container.querySelector('.analysis-upload-file')).toBeNull();
  });
});

describe('AnalysisUpload sample validation', () => {
  it('a scanned id is validated and shown with its specimenId and barcode, and the scan input closes', async () => {
    validateSample.mockResolvedValue(validSample);
    const { container } = render(<AnalysisUpload />);
    await scan('  AM-1  ');
    expect(validateSample).toHaveBeenCalledTimes(1);
    expect(validateSample).toHaveBeenCalledWith('AM-1');
    const box = validationBox(container) as HTMLElement;
    expect(box.className).toBe('analysis-upload-validation success');
    expect(box.textContent).toBe('✓ Amostra válida: SP-1 (BC-9)Paciente com consentimento assinado');
    expect(screen.queryByPlaceholderText(QR_PLACEHOLDER)).toBeNull();
    expect(typedInput().value).toBe('AM-1');
    expect(sendButton()).toBeEnabled();
  });

  it('falls back to the sample _id when it has no specimenId', async () => {
    validateSample.mockResolvedValue({ data: { success: true, sample: { _id: 'obj-42', barcode: 'BC-1' } } });
    const { container } = render(<AnalysisUpload />);
    await scan('AM-2');
    expect(validationBox(container)?.textContent).toContain('✓ Amostra válida: obj-42 (BC-1)');
  });

  it('shows "Validando amostra..." while the request is in flight', async () => {
    const d = deferred<typeof validSample>();
    validateSample.mockReturnValue(d.promise);
    const { container } = render(<AnalysisUpload />);
    await scan('AM-3');
    expect(container.querySelector('.analysis-upload-validating')?.textContent).toBe('Validando amostra...');
    await act(async () => d.resolve(validSample));
    expect(container.querySelector('.analysis-upload-validating')).toBeNull();
  });

  it.each([
    ['the response error', { success: false, error: 'Sem consentimento' }, 'Sem consentimento'],
    ['the default text', { success: false }, 'Falha na validação'],
  ])('an unsuccessful response shows %s and keeps the button disabled', async (_n, response, shown) => {
    validateSample.mockResolvedValue({ data: response });
    const { container } = render(<AnalysisUpload />);
    await scan('AM-4');
    const box = validationBox(container) as HTMLElement;
    expect(box.className).toBe('analysis-upload-validation error');
    expect(box.textContent).toBe(`✗ Erro: ${shown}`);
    expect(sendButton()).toBeDisabled();
  });

  it.each([
    ['response.data.error', { response: { data: { error: 'Amostra inexistente' } }, message: 'x' }, 'Amostra inexistente'],
    ['err.message', new Error('Network Error'), 'Network Error'],
    ['the default text', {}, 'Erro ao validar amostra'],
  ])('a thrown validation shows %s', async (_n, thrown, shown) => {
    validateSample.mockRejectedValue(thrown);
    const { container } = render(<AnalysisUpload />);
    await scan('AM-5');
    expect(validationBox(container)?.textContent).toBe(`✗ Erro: ${shown}`);
    expect(container.querySelector('.analysis-upload-validating')).toBeNull();
  });

  it('a blank scan validates nothing and leaves the scan input open', () => {
    render(<AnalysisUpload />);
    fireEvent.click(screen.getByRole('button', { name: /QR Code/ }));
    fireEvent.change(screen.getByPlaceholderText(QR_PLACEHOLDER), { target: { value: '   ' } });
    expect(validateSample).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText(QR_PLACEHOLDER)).toBeInTheDocument();
  });

  it('the QR button toggles the scan input, and blurring it returns to the typed input', () => {
    render(<AnalysisUpload />);
    const toggle = screen.getByRole('button', { name: /QR Code/ });
    fireEvent.click(toggle);
    expect(screen.queryByPlaceholderText(TYPED_PLACEHOLDER)).toBeNull();
    fireEvent.click(toggle);
    expect(screen.queryByPlaceholderText(QR_PLACEHOLDER)).toBeNull();
    fireEvent.click(toggle);
    fireEvent.blur(screen.getByPlaceholderText(QR_PLACEHOLDER));
    expect(screen.queryByPlaceholderText(QR_PLACEHOLDER)).toBeNull();
    expect(typedInput()).toBeInTheDocument();
  });

  // #1444: a typed id is validated once typing pauses for 800 ms, and only
  // the latest value is.
  it('a typed id is validated after 800 ms and enables the send button', async () => {
    vi.useFakeTimers();
    validateSample.mockResolvedValue(validSample);
    const { container } = render(<AnalysisUpload />);
    fireEvent.change(typedInput(), { target: { value: 'AM-6' } });
    expect(typedInput().value).toBe('AM-6');
    act(() => {
      vi.advanceTimersByTime(799);
    });
    expect(validateSample).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(validateSample).toHaveBeenCalledTimes(1);
    expect(validateSample).toHaveBeenCalledWith('AM-6');
    expect(validationBox(container)?.textContent).toContain('✓ Amostra válida: SP-1 (BC-9)');
    expect(sendButton()).toBeEnabled();
  });

  it('a typed value superseded within 800 ms is not validated; only the latest is', async () => {
    vi.useFakeTimers();
    validateSample.mockResolvedValue(validSample);
    render(<AnalysisUpload />);
    fireEvent.change(typedInput(), { target: { value: 'AM-6' } });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.change(typedInput(), { target: { value: 'AM-61' } });
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(validateSample).toHaveBeenCalledTimes(1);
    expect(validateSample).toHaveBeenCalledWith('AM-61');
  });

  it('a scan cancels a pending typed validation', async () => {
    vi.useFakeTimers();
    validateSample.mockResolvedValue(validSample);
    render(<AnalysisUpload />);
    fireEvent.change(typedInput(), { target: { value: 'AM-6' } });
    await scan('AM-8');
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(validateSample).toHaveBeenCalledTimes(1);
    expect(validateSample).toHaveBeenCalledWith('AM-8');
  });

  it('a typed id is validated without its surrounding spaces', async () => {
    vi.useFakeTimers();
    validateSample.mockResolvedValue(validSample);
    render(<AnalysisUpload />);
    fireEvent.change(typedInput(), { target: { value: ' AM-9 ' } });
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(validateSample).toHaveBeenCalledTimes(1);
    expect(validateSample).toHaveBeenCalledWith('AM-9');
  });

  it('a late response for a superseded typed id is discarded; the box and send button follow the latest id', async () => {
    vi.useFakeTimers();
    const first = deferred<{ data: ValidationBody }>();
    const second = deferred<{ data: ValidationBody }>();
    validateSample.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { container } = render(<AnalysisUpload />);
    fireEvent.change(typedInput(), { target: { value: 'GOOD' } });
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    fireEvent.change(typedInput(), { target: { value: 'BAD' } });
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(validateSample.mock.calls).toEqual([['GOOD'], ['BAD']]);
    await act(async () => first.resolve(validSample));
    expect(validationBox(container)).toBeNull();
    expect(container.querySelector('.analysis-upload-validating')?.textContent).toBe('Validando amostra...');
    expect(sendButton()).toBeDisabled();
    await act(async () => second.resolve({ data: { success: false, error: 'Sem consentimento' } }));
    expect(typedInput().value).toBe('BAD');
    expect(validationBox(container)?.textContent).toBe('✗ Erro: Sem consentimento');
    expect(container.querySelector('.analysis-upload-validating')).toBeNull();
    expect(sendButton()).toBeDisabled();
  });

  it('a late failure for a superseded typed id is discarded', async () => {
    vi.useFakeTimers();
    const first = deferred<{ data: ValidationBody }>();
    validateSample.mockReturnValueOnce(first.promise).mockResolvedValueOnce(validSample);
    const { container } = render(<AnalysisUpload />);
    fireEvent.change(typedInput(), { target: { value: 'AM-6' } });
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    fireEvent.change(typedInput(), { target: { value: 'AM-61' } });
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    await act(async () => first.reject(new Error('Network Error')));
    expect(validationBox(container)?.textContent).toContain('✓ Amostra válida: SP-1 (BC-9)');
    expect(sendButton()).toBeEnabled();
  });

  it('a new scan clears the previous result while it validates', async () => {
    const d = deferred<{ data: ValidationBody }>();
    validateSample.mockResolvedValueOnce(validSample).mockReturnValueOnce(d.promise);
    const { container } = render(<AnalysisUpload />);
    await scan('AM-1');
    expect(sendButton()).toBeEnabled();
    await scan('AM-2');
    expect(validationBox(container)).toBeNull();
    expect(sendButton()).toBeDisabled();
    await act(async () => d.resolve(validSample));
    expect(sendButton()).toBeEnabled();
  });

  it('editing a validated id clears its result until the new id is validated', async () => {
    vi.useFakeTimers();
    validateSample.mockResolvedValue(validSample);
    const { container } = render(<AnalysisUpload />);
    await scan('AM-1');
    expect(sendButton()).toBeEnabled();
    fireEvent.change(typedInput(), { target: { value: 'AM-12' } });
    expect(validationBox(container)).toBeNull();
    expect(sendButton()).toBeDisabled();
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(validateSample).toHaveBeenLastCalledWith('AM-12');
    expect(sendButton()).toBeEnabled();
  });

  it('editing the id while a validation is in flight drops its "Validando amostra..."', async () => {
    const d = deferred<typeof validSample>();
    validateSample.mockReturnValue(d.promise);
    const { container } = render(<AnalysisUpload />);
    await scan('AM-3');
    fireEvent.blur(screen.getByPlaceholderText(QR_PLACEHOLDER));
    expect(container.querySelector('.analysis-upload-validating')).not.toBeNull();
    fireEvent.change(typedInput(), { target: { value: 'AM-30' } });
    expect(container.querySelector('.analysis-upload-validating')).toBeNull();
  });

  it('clearing the typed id removes a previous validation result', async () => {
    validateSample.mockResolvedValue(validSample);
    const { container } = render(<AnalysisUpload />);
    await scan('AM-7');
    expect(validationBox(container)).not.toBeNull();
    fireEvent.change(typedInput(), { target: { value: '' } });
    expect(validationBox(container)).toBeNull();
    expect(sendButton()).toBeDisabled();
  });
});

describe('AnalysisUpload upload', () => {
  it('without a file, a click says to select one and sends nothing', async () => {
    validateSample.mockResolvedValue(validSample);
    const { container } = render(<AnalysisUpload />);
    await scan('AM-8');
    fireEvent.click(sendButton());
    expect(container.querySelector('.analysis-upload-error')?.textContent).toBe('Selecione um arquivo para upload');
    expect(upload).not.toHaveBeenCalled();
  });

  it('when the id was cleared while a scan was validating, its late response is dropped and send stays disabled', async () => {
    const d = deferred<typeof validSample>();
    validateSample.mockReturnValue(d.promise);
    const { container } = render(<AnalysisUpload />);
    pickFile(makeFile('a.csv', 10));
    await scan('AM-9');
    fireEvent.blur(screen.getByPlaceholderText(QR_PLACEHOLDER));
    fireEvent.change(typedInput(), { target: { value: '' } });
    await act(async () => d.resolve(validSample));
    expect(validationBox(container)).toBeNull();
    expect(sendButton()).toBeDisabled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('sends the file and sample id, tracks progress, then clears the form', async () => {
    validateSample.mockResolvedValue(validSample);
    const d = deferred<unknown>();
    let onProgress: (e: ProgressEvent) => void = () => {};
    upload.mockImplementation((_fd, cb) => {
      onProgress = cb;
      return d.promise;
    });
    const { container } = render(<AnalysisUpload />);
    const file = makeFile('scan.png', 2048);
    pickFile(file);
    await scan('AM-10');
    fireEvent.click(sendButton());

    expect(upload).toHaveBeenCalledTimes(1);
    const fd = upload.mock.calls[0][0] as FormData;
    expect(fd.get('file')).toBe(file);
    expect(fd.get('sampleId')).toBe('AM-10');
    expect(Array.from(fd.keys())).toEqual(['file', 'sampleId']);

    expect(sendButton()).toHaveTextContent('Enviando...');
    expect(sendButton()).toBeDisabled();
    expect(fileInput()).toBeDisabled();
    expect(typedInput()).toBeDisabled();

    act(() => onProgress({ loaded: 50, total: 200 }));
    expect(progressLabel(container)).toBe('25%');
    expect(progressWidth(container)).toBe('25%');
    act(() => onProgress({ loaded: 1, total: 3 }));
    expect(progressLabel(container)).toBe('33%');
    act(() => onProgress({ loaded: 90, total: 0 }));
    expect(progressLabel(container)).toBe('33%');
    act(() => onProgress({ loaded: 90 }));
    expect(progressLabel(container)).toBe('33%');

    await act(async () => d.resolve({}));
    expect(container.querySelector('.analysis-upload-success')?.textContent).toBe('Arquivo enviado com sucesso');
    expect(container.querySelector('.analysis-upload-error')).toBeNull();
    expect(container.querySelector('.analysis-upload-file')).toBeNull();
    expect(progressLabel(container)).toBe('0%');
    expect(typedInput().value).toBe('');
    expect(validationBox(container)).toBeNull();
    expect(sendButton()).toHaveTextContent('Enviar Arquivo');
    expect(sendButton()).toBeDisabled();
  });

  it('picking a new file clears the success message', async () => {
    validateSample.mockResolvedValue(validSample);
    upload.mockResolvedValue({});
    const { container } = render(<AnalysisUpload />);
    pickFile(makeFile('a.txt', 1));
    await scan('AM-11');
    await act(async () => {
      fireEvent.click(sendButton());
    });
    expect(container.querySelector('.analysis-upload-success')).not.toBeNull();
    pickFile(makeFile('b.txt', 1));
    expect(container.querySelector('.analysis-upload-success')).toBeNull();
  });

  it('picking a new file after a failed upload resets its progress and clears its error', async () => {
    validateSample.mockResolvedValue(validSample);
    upload.mockImplementation(async (_fd, cb) => {
      cb({ loaded: 1, total: 2 });
      throw new Error('falhou');
    });
    const { container } = render(<AnalysisUpload />);
    pickFile(makeFile('a.txt', 1));
    await scan('AM-15');
    await act(async () => {
      fireEvent.click(sendButton());
    });
    expect(progressLabel(container)).toBe('50%');
    expect(container.querySelector('.analysis-upload-error')?.textContent).toBe('falhou');
    pickFile(makeFile('b.txt', 1));
    expect(progressLabel(container)).toBe('0%');
    expect(container.querySelector('.analysis-upload-error')).toBeNull();
  });

  it('picking a file after the select-a-file guard clears its error', async () => {
    validateSample.mockResolvedValue(validSample);
    const { container } = render(<AnalysisUpload />);
    await scan('AM-16');
    fireEvent.click(sendButton());
    expect(container.querySelector('.analysis-upload-error')?.textContent).toBe('Selecione um arquivo para upload');
    pickFile(makeFile('a.txt', 1));
    expect(container.querySelector('.analysis-upload-error')).toBeNull();
  });

  it('a retry after a failed upload clears the earlier error once it starts', async () => {
    validateSample.mockResolvedValue(validSample);
    const d = deferred<unknown>();
    upload.mockRejectedValueOnce(new Error('falhou')).mockReturnValueOnce(d.promise);
    const { container } = render(<AnalysisUpload />);
    pickFile(makeFile('a.txt', 1));
    await scan('AM-17');
    await act(async () => {
      fireEvent.click(sendButton());
    });
    expect(container.querySelector('.analysis-upload-error')?.textContent).toBe('falhou');
    fireEvent.click(sendButton());
    expect(upload).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.analysis-upload-error')).toBeNull();
    await act(async () => d.resolve({}));
    expect(container.querySelector('.analysis-upload-success')?.textContent).toBe('Arquivo enviado com sucesso');
    expect(container.querySelector('.analysis-upload-error')).toBeNull();
  });

  it.each([
    ['response.data.error', { response: { data: { error: 'Arquivo grande demais' } }, message: 'x' }, 'Arquivo grande demais'],
    ['err.message', new Error('timeout of 0ms exceeded'), 'timeout of 0ms exceeded'],
    ['the default text', {}, 'Erro ao enviar arquivo'],
  ])('a failed upload shows %s and keeps the file and validation', async (_n, thrown, shown) => {
    validateSample.mockResolvedValue(validSample);
    upload.mockRejectedValue(thrown);
    const { container } = render(<AnalysisUpload />);
    pickFile(makeFile('keep.fcs', 4));
    await scan('AM-12');
    await act(async () => {
      fireEvent.click(sendButton());
    });
    expect(container.querySelector('.analysis-upload-error')?.textContent).toBe(shown);
    expect(container.querySelector('.analysis-upload-success')).toBeNull();
    expect(container.querySelector('.analysis-upload-file-name')?.textContent).toBe('keep.fcs');
    expect(typedInput().value).toBe('AM-12');
    expect(sendButton()).toHaveTextContent('Enviar Arquivo');
    expect(sendButton()).toBeEnabled();
  });

  it('a later scan clears an earlier upload error', async () => {
    validateSample.mockResolvedValue(validSample);
    upload.mockRejectedValue(new Error('boom'));
    const { container } = render(<AnalysisUpload />);
    pickFile(makeFile('a.png', 1));
    await scan('AM-13');
    await act(async () => {
      fireEvent.click(sendButton());
    });
    expect(container.querySelector('.analysis-upload-error')?.textContent).toBe('boom');
    await scan('AM-14');
    expect(container.querySelector('.analysis-upload-error')).toBeNull();
  });
});
