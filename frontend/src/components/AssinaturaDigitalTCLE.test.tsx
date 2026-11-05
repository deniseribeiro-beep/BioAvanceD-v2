import { forwardRef, useImperativeHandle } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// TCLE digital signature (eConsent). react-signature-canvas needs a real 2D
// canvas, which jsdom lacks, so it is replaced by a stand-in whose ref API
// (isEmpty, clear, getTrimmedCanvas) each case sets through `h`.
const h = vi.hoisted(() => ({
  empty: false,
  blob: null as Blob | null,
  dataUrl: 'data:image/png;base64,QUJD',
  clear: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('react-signature-canvas', () => ({
  default: forwardRef(function SignatureCanvasStub(
    props: { canvasProps: Record<string, unknown>; onBegin?: () => void },
    ref,
  ) {
    useImperativeHandle(ref, () => ({
      isEmpty: () => h.empty,
      clear: h.clear,
      getTrimmedCanvas: () => ({
        toDataURL: () => h.dataUrl,
        toBlob: (cb: (b: Blob | null) => void) => cb(h.blob),
      }),
    }));
    return <canvas {...props.canvasProps} onMouseDown={props.onBegin} />;
  }),
}));
vi.mock('@/api/requestId', () => ({
  fetchWithRequestId: (...args: unknown[]) => h.fetch(...args),
}));

import AssinaturaDigitalTCLE from '@/components/AssinaturaDigitalTCLE';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  h.empty = false;
  h.blob = new Blob(['png'], { type: 'image/png' });
  h.dataUrl = 'data:image/png;base64,QUJD';
  h.clear.mockReset();
  h.fetch.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (navigator as { webdriver?: boolean }).webdriver;
});

describe('AssinaturaDigitalTCLE', () => {
  it('asks for a signature when the canvas is empty and calls nothing', () => {
    h.empty = true;
    const onDone = vi.fn();
    render(<AssinaturaDigitalTCLE onAssinaturaConfirmada={onDone} />);
    fireEvent.click(screen.getByTestId('signature-confirm-button'));
    expect(screen.getByTestId('signature-error')).toHaveTextContent('Assine no quadro antes de confirmar.');
    expect(h.fetch).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('posts the signature with the donor id to the endpoint and reports success', async () => {
    h.fetch.mockResolvedValue({ ok: true });
    const onDone = vi.fn();
    render(
      <AssinaturaDigitalTCLE endpoint="/api/x/sig" doadorId="D-42" onAssinaturaConfirmada={onDone} />,
    );
    fireEvent.click(screen.getByTestId('signature-confirm-button'));
    await waitFor(() =>
      expect(screen.getByTestId('signature-success')).toHaveTextContent('Assinatura confirmada com sucesso.'),
    );
    expect(h.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = h.fetch.mock.calls[0] as [string, { method: string; body: FormData }];
    expect(url).toBe('/api/x/sig');
    expect(init.method).toBe('POST');
    expect(init.body.get('doadorId')).toBe('D-42');
    const file = init.body.get('assinatura') as File;
    expect(file).toBeInstanceOf(Blob);
    expect(file.name).toMatch(/^assinatura-\d+\.png$/);
    expect(onDone).toHaveBeenCalledWith({ assinaturaBase64: h.dataUrl, assinaturaBlob: h.blob });
    expect(screen.queryByTestId('signature-error')).toBeNull();
  });

  it('uses the default endpoint when none is given', async () => {
    h.fetch.mockResolvedValue({ ok: true });
    render(<AssinaturaDigitalTCLE onAssinaturaConfirmada={undefined} />);
    fireEvent.click(screen.getByTestId('signature-confirm-button'));
    await waitFor(() => expect(screen.getByTestId('signature-success')).toBeInTheDocument());
    expect(h.fetch.mock.calls[0][0]).toBe('/api/v1/consent/signature');
  });

  it('skips the backend when persistence is off and still hands the signature back', async () => {
    const onDone = vi.fn();
    render(<AssinaturaDigitalTCLE persistirNoBackend={false} onAssinaturaConfirmada={onDone} />);
    fireEvent.click(screen.getByTestId('signature-confirm-button'));
    await waitFor(() =>
      expect(screen.getByTestId('signature-success')).toHaveTextContent(
        'Assinatura confirmada para envio junto ao consentimento.',
      ),
    );
    expect(h.fetch).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith({ assinaturaBase64: h.dataUrl, assinaturaBlob: h.blob });
  });

  it('shows the backend message of a refused post', async () => {
    h.fetch.mockResolvedValue({ ok: false, json: async () => ({ message: 'TCLE expirado' }) });
    const onDone = vi.fn();
    render(<AssinaturaDigitalTCLE onAssinaturaConfirmada={onDone} />);
    fireEvent.click(screen.getByTestId('signature-confirm-button'));
    await waitFor(() => expect(screen.getByTestId('signature-error')).toHaveTextContent('TCLE expirado'));
    expect(screen.queryByTestId('signature-success')).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('falls back to the payload error field of a refused post', async () => {
    h.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'FORBIDDEN' }) });
    render(<AssinaturaDigitalTCLE onAssinaturaConfirmada={undefined} />);
    fireEvent.click(screen.getByTestId('signature-confirm-button'));
    await waitFor(() => expect(screen.getByTestId('signature-error')).toHaveTextContent('FORBIDDEN'));
  });

  it('uses the generic message when a refused post has no readable body', async () => {
    h.fetch.mockResolvedValue({ ok: false, json: async () => Promise.reject(new Error('not json')) });
    render(<AssinaturaDigitalTCLE onAssinaturaConfirmada={undefined} />);
    fireEvent.click(screen.getByTestId('signature-confirm-button'));
    await waitFor(() =>
      expect(screen.getByTestId('signature-error')).toHaveTextContent('Falha ao registrar a assinatura digital.'),
    );
  });

  it('reports a canvas that cannot become an image', async () => {
    h.blob = null;
    const onDone = vi.fn();
    render(<AssinaturaDigitalTCLE onAssinaturaConfirmada={onDone} />);
    fireEvent.click(screen.getByTestId('signature-confirm-button'));
    await waitFor(() =>
      expect(screen.getByTestId('signature-error')).toHaveTextContent(
        'Não foi possível converter a assinatura em arquivo de imagem.',
      ),
    );
    expect(h.fetch).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('reports a generic error when the post rejects with a non-Error', async () => {
    h.fetch.mockRejectedValue('offline');
    render(<AssinaturaDigitalTCLE onAssinaturaConfirmada={undefined} />);
    fireEvent.click(screen.getByTestId('signature-confirm-button'));
    await waitFor(() =>
      expect(screen.getByTestId('signature-error')).toHaveTextContent('Erro ao confirmar assinatura digital.'),
    );
  });

  it('disables both buttons and shows progress while the post is pending', async () => {
    const pending = deferred<{ ok: boolean }>();
    h.fetch.mockReturnValue(pending.promise);
    render(<AssinaturaDigitalTCLE onAssinaturaConfirmada={undefined} />);
    fireEvent.click(screen.getByTestId('signature-confirm-button'));
    await waitFor(() => expect(screen.getByTestId('signature-confirm-button')).toBeDisabled());
    expect(screen.getByTestId('signature-confirm-button')).toHaveTextContent('Confirmando...');
    expect(screen.getByTestId('signature-clear-button')).toBeDisabled();
    await act(async () => {
      pending.resolve({ ok: true });
    });
    expect(screen.getByTestId('signature-confirm-button')).not.toBeDisabled();
    expect(screen.getByTestId('signature-confirm-button')).toHaveTextContent('Confirmar e Assinar');
  });

  it('clears the canvas and the feedback', () => {
    h.empty = true;
    render(<AssinaturaDigitalTCLE onAssinaturaConfirmada={undefined} />);
    fireEvent.click(screen.getByTestId('signature-confirm-button'));
    expect(screen.getByTestId('signature-error')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('signature-clear-button'));
    expect(h.clear).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('signature-error')).toBeNull();
  });

  it('clears the feedback when a new stroke begins', () => {
    h.empty = true;
    render(<AssinaturaDigitalTCLE onAssinaturaConfirmada={undefined} />);
    fireEvent.click(screen.getByTestId('signature-confirm-button'));
    expect(screen.getByTestId('signature-error')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('signature-canvas'));
    expect(screen.queryByTestId('signature-error')).toBeNull();
    expect(h.clear).not.toHaveBeenCalled();
  });

  it('prefixes every test id with testIdPrefix', () => {
    render(<AssinaturaDigitalTCLE testIdPrefix="tcle" onAssinaturaConfirmada={undefined} />);
    expect(screen.getByTestId('tcle-section')).toBeInTheDocument();
    expect(screen.getByTestId('tcle-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('tcle-confirm-button')).toBeInTheDocument();
    expect(screen.queryByTestId('signature-section')).toBeNull();
  });

  it('shows the automation bypass only under webdriver, and it confirms without a blob', () => {
    render(<AssinaturaDigitalTCLE onAssinaturaConfirmada={undefined} />);
    expect(screen.queryByTestId('signature-e2e-bypass-button')).toBeNull();
    cleanup();

    Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true });
    const onDone = vi.fn();
    render(<AssinaturaDigitalTCLE onAssinaturaConfirmada={onDone} />);
    fireEvent.click(screen.getByTestId('signature-e2e-bypass-button'));
    expect(screen.getByTestId('signature-success')).toHaveTextContent(
      'Assinatura confirmada para envio junto ao consentimento.',
    );
    expect(onDone).toHaveBeenCalledTimes(1);
    const arg = onDone.mock.calls[0][0] as { assinaturaBase64: string; assinaturaBlob: Blob | null };
    expect(arg.assinaturaBase64).toMatch(/^data:image\/png;base64,/);
    expect(arg.assinaturaBlob).toBeNull();
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('confirms through the bypass with no callback given', () => {
    Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true });
    render(<AssinaturaDigitalTCLE onAssinaturaConfirmada={undefined} />);
    fireEvent.click(screen.getByTestId('signature-e2e-bypass-button'));
    expect(screen.getByTestId('signature-success')).toBeInTheDocument();
  });

  it('sizes the canvas from its container, never below 280 px, on window resize', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    let width = 0;
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(() => width);
    const { unmount } = render(<AssinaturaDigitalTCLE onAssinaturaConfirmada={undefined} />);
    // jsdom lays nothing out: an offsetWidth of 0 falls back to 720.
    expect(screen.getByTestId('signature-canvas')).toHaveAttribute('width', '718');
    expect(screen.getByTestId('signature-canvas')).toHaveAttribute('height', '260');

    width = 200;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByTestId('signature-canvas')).toHaveAttribute('width', '280');

    width = 500;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByTestId('signature-canvas')).toHaveAttribute('width', '498');

    const handler = add.mock.calls.find(([type]) => type === 'resize')?.[1];
    expect(handler).toBeTypeOf('function');
    unmount();
    expect(remove).toHaveBeenCalledWith('resize', handler);
  });

  it('watches the container with ResizeObserver where it exists and disconnects on unmount', () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    let callback: (() => void) | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          callback = cb;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    const add = vi.spyOn(window, 'addEventListener');
    let width = 0;
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(() => width);
    const { unmount } = render(<AssinaturaDigitalTCLE onAssinaturaConfirmada={undefined} />);
    expect(observe).toHaveBeenCalledWith(screen.getByTestId('signature-canvas-wrapper'));
    expect(add.mock.calls.some(([type]) => type === 'resize')).toBe(false);

    width = 402;
    act(() => {
      callback?.();
    });
    expect(screen.getByTestId('signature-canvas')).toHaveAttribute('width', '400');

    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
