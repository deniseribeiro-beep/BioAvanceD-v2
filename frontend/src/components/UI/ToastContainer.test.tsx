import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider, useToast } from './ToastContainer';
import { notifyApiToast } from '../../api/client';
import type { ToastType } from './Toast';

const sonner = vi.hoisted(() => ({
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: sonner,
}));

function ShowButton({ message, type, duration }: { message: string; type?: ToastType; duration?: number }) {
  const { showToast } = useToast();
  return <button type="button" onClick={() => showToast(message, type, duration)}>show {message}</button>;
}

function renderProvider(children: React.ReactNode = null) {
  return render(<ToastProvider>{children}</ToastProvider>);
}

// The legacy stack the provider keeps beside sonner's Toaster.
function legacyStack(container: HTMLElement) {
  const stack = container.querySelector('div[aria-live="polite"]');
  if (!stack) throw new Error('no legacy toast stack');
  return stack as HTMLElement;
}

afterEach(() => {
  Object.values(sonner).forEach((fn) => fn.mockReset());
});

describe('useToast', () => {
  it('throws outside a ToastProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<ShowButton message="x" />)).toThrow('useToast must be used within ToastProvider');
    spy.mockRestore();
  });
});

describe('ToastProvider', () => {
  it('shows an info toast for 3 s by default, in sonner and in the legacy stack', async () => {
    const user = userEvent.setup();
    const { container } = renderProvider(<ShowButton message="Salvo" />);
    await user.click(screen.getByRole('button', { name: 'show Salvo' }));
    expect(sonner.info).toHaveBeenCalledWith('Salvo', { duration: 3000 });
    expect(within(legacyStack(container)).getByRole('status')).toHaveTextContent('Salvo');
  });

  it.each([
    ['error', 'error'],
    ['success', 'success'],
    ['warning', 'warning'],
    ['info', 'info'],
  ] as const)('a %s toast goes to sonner.%s with its own duration', async (type, method) => {
    const user = userEvent.setup();
    const { container } = renderProvider(<ShowButton message="Mensagem" type={type} duration={5000} />);
    await user.click(screen.getByRole('button', { name: 'show Mensagem' }));
    expect(sonner[method]).toHaveBeenCalledWith('Mensagem', { duration: 5000 });
    for (const other of Object.keys(sonner).filter((name) => name !== method)) {
      expect(sonner[other as keyof typeof sonner]).not.toHaveBeenCalled();
    }
    expect(legacyStack(container)).toHaveTextContent('Mensagem');
  });

  it('closing one legacy toast removes only that one', async () => {
    const user = userEvent.setup();
    const { container } = renderProvider(
      <>
        <ShowButton message="Primeiro" type="success" duration={0} />
        <ShowButton message="Segundo" type="success" duration={0} />
        <ShowButton message="Terceiro" type="success" duration={0} />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'show Primeiro' }));
    await user.click(screen.getByRole('button', { name: 'show Segundo' }));
    await user.click(screen.getByRole('button', { name: 'show Terceiro' }));
    const stack = legacyStack(container);
    expect(within(stack).getAllByRole('alert')).toHaveLength(3);
    const middle = within(stack).getByText('Segundo').closest('[role="alert"]') as HTMLElement;
    await user.click(within(middle).getByRole('button', { name: 'Close' }));
    expect(within(stack).queryByText('Segundo')).not.toBeInTheDocument();
    expect(within(stack).getByText('Primeiro')).toBeInTheDocument();
    expect(within(stack).getByText('Terceiro')).toBeInTheDocument();
  });

  it('shows a toast the API client sends as a window event, info when it names no type', () => {
    const { container } = renderProvider();
    act(() => notifyApiToast({ message: 'Sessão expirada', type: 'warning', duration: 4000 }));
    expect(sonner.warning).toHaveBeenCalledWith('Sessão expirada', { duration: 4000 });
    act(() => notifyApiToast({ message: 'Sincronizado' }));
    expect(sonner.info).toHaveBeenCalledWith('Sincronizado', { duration: 3000 });
    expect(within(legacyStack(container)).getByRole('alert')).toHaveTextContent('Sessão expirada');
    expect(within(legacyStack(container)).getByRole('status')).toHaveTextContent('Sincronizado');
  });

  it('ignores a window event with no message', () => {
    const { container } = renderProvider();
    act(() => notifyApiToast({ message: '' }));
    Object.values(sonner).forEach((fn) => expect(fn).not.toHaveBeenCalled());
    expect(legacyStack(container)).toBeEmptyDOMElement();
  });

  it('stops listening for window events once unmounted', () => {
    const { unmount } = renderProvider();
    unmount();
    notifyApiToast({ message: 'Depois', type: 'error' });
    expect(sonner.error).not.toHaveBeenCalled();
  });
});
