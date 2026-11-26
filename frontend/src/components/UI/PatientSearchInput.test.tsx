import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const validateID = vi.fn();
const search = vi.fn();
const getAll = vi.fn();
vi.mock('@/services/api', () => ({
  patientService: {
    validateID: (...args: unknown[]) => validateID(...args),
    search: (...args: unknown[]) => search(...args),
    getAll: (...args: unknown[]) => getAll(...args),
  },
}));

import PatientSearchInput from './PatientSearchInput';

const PLACEHOLDER = 'Buscar por ID ou prontuário...';

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const input = () => screen.getByPlaceholderText(PLACEHOLDER) as HTMLInputElement;

// Types a term and lets the 500 ms debounce fire and the search settle.
const typeAndWait = async (term: string) => {
  fireEvent.change(input(), { target: { value: term } });
  await act(async () => {
    vi.advanceTimersByTime(500);
  });
};

const patients = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ participantId: String(10000000 + i), recordNumber: `PR-${i}` }));

describe('PatientSearchInput', () => {
  beforeEach(() => {
    validateID.mockReset();
    search.mockReset();
    getAll.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('labels', () => {
    it('renders the default label, placeholder and help text, with no asterisk when not required', () => {
      render(<PatientSearchInput value="" onChange={vi.fn()} />);
      expect(screen.getByLabelText('ID do Paciente')).toBe(input());
      expect(screen.getByText('Busque por ID (8 dígitos) ou prontuário do paciente')).toBeInTheDocument();
      expect(screen.queryByText(/\*/)).not.toBeInTheDocument();
      expect(input().required).toBe(false);
      expect(screen.queryByRole('button', { name: 'Alternar lista de pacientes' })).not.toBeInTheDocument();
    });

    it('renders a custom label and placeholder, marked required', () => {
      render(<PatientSearchInput value="" onChange={vi.fn()} label="Paciente" placeholder="Digite" required />);
      const field = screen.getByPlaceholderText('Digite') as HTMLInputElement;
      expect(screen.getByText('Paciente *')).toBeInTheDocument();
      expect(field.required).toBe(true);
    });
  });

  describe('validating the value prop', () => {
    it('reports null and validates nothing for an empty value', () => {
      const onValidationChange = vi.fn();
      render(<PatientSearchInput value="" onChange={vi.fn()} onValidationChange={onValidationChange} />);
      expect(onValidationChange).toHaveBeenCalledWith(null);
      expect(validateID).not.toHaveBeenCalled();
    });

    it('reports an id that is not 8 characters invalid without calling the api or showing not-found', () => {
      const onValidationChange = vi.fn();
      render(<PatientSearchInput value="123" onChange={vi.fn()} onValidationChange={onValidationChange} />);
      expect(onValidationChange).toHaveBeenCalledWith(false);
      expect(validateID).not.toHaveBeenCalled();
      expect(screen.queryByText('ID de paciente não encontrado')).not.toBeInTheDocument();
      expect(input().getAttribute('style')).toContain('var(--danger)');
    });

    it('reports 8 non-digit characters invalid and shows not-found without calling the api', () => {
      const onValidationChange = vi.fn();
      render(<PatientSearchInput value="abcdefgh" onChange={vi.fn()} onValidationChange={onValidationChange} />);
      expect(onValidationChange).toHaveBeenCalledWith(false);
      expect(validateID).not.toHaveBeenCalled();
      expect(screen.getByText('ID de paciente não encontrado')).toBeInTheDocument();
    });

    it('validates an 8-digit id with the api, showing Validando... until it answers valid', async () => {
      const call = deferred<{ data: { valid: boolean } }>();
      validateID.mockReturnValue(call.promise);
      const onValidationChange = vi.fn();
      const { container } = render(
        <PatientSearchInput value="12345678" onChange={vi.fn()} onValidationChange={onValidationChange} />,
      );
      expect(validateID).toHaveBeenCalledWith('12345678');
      expect(screen.getByText('Validando...')).toBeInTheDocument();
      expect(container.querySelector('svg.lucide-loader')?.getAttribute('style')).toContain('right: 0.75rem');
      await act(async () => {
        call.resolve({ data: { valid: true } });
      });
      expect(screen.queryByText('Validando...')).not.toBeInTheDocument();
      expect(screen.getByText('✓ ID válido')).toBeInTheDocument();
      expect(onValidationChange).toHaveBeenLastCalledWith(true);
      expect(input().getAttribute('style')).toContain('var(--success)');
      expect(input().value).toBe('12345678');
    });

    it('shows not-found when the api answers the 8-digit id is not valid', async () => {
      validateID.mockResolvedValue({ data: { valid: false } });
      const onValidationChange = vi.fn();
      render(<PatientSearchInput value="87654321" onChange={vi.fn()} onValidationChange={onValidationChange} />);
      expect(await screen.findByText('ID de paciente não encontrado')).toBeInTheDocument();
      expect(onValidationChange).toHaveBeenLastCalledWith(false);
      expect(screen.queryByText('✓ ID válido')).not.toBeInTheDocument();
    });

    it('treats a failing validation call as not found', async () => {
      validateID.mockRejectedValue(new Error('network'));
      const onValidationChange = vi.fn();
      render(<PatientSearchInput value="87654321" onChange={vi.fn()} onValidationChange={onValidationChange} />);
      expect(await screen.findByText('ID de paciente não encontrado')).toBeInTheDocument();
      expect(onValidationChange).toHaveBeenLastCalledWith(false);
    });

    it('validates without an onValidationChange callback', async () => {
      validateID.mockResolvedValue({ data: { valid: true } });
      const { rerender } = render(<PatientSearchInput value="12345678" onChange={vi.fn()} />);
      expect(await screen.findByText('✓ ID válido')).toBeInTheDocument();
      rerender(<PatientSearchInput value="123" onChange={vi.fn()} />);
      expect(screen.queryByText('✓ ID válido')).not.toBeInTheDocument();
      rerender(<PatientSearchInput value="" onChange={vi.fn()} />);
      expect(input().getAttribute('style')).toContain('var(--border)');
    });
  });

  describe('typing', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('passes a typed 8-digit id straight to onChange without searching', async () => {
      const onChange = vi.fn();
      const onValidationChange = vi.fn();
      render(<PatientSearchInput value="" onChange={onChange} onValidationChange={onValidationChange} />);
      onValidationChange.mockClear();
      await typeAndWait('12345678');
      expect(onChange).toHaveBeenCalledWith('12345678');
      expect(onValidationChange).toHaveBeenCalledWith(null);
      expect(search).not.toHaveBeenCalled();
    });

    it('searches the trimmed term 500 ms after the last keystroke, once', async () => {
      search.mockResolvedValue({ data: { patients: patients(1) } });
      render(<PatientSearchInput value="" onChange={vi.fn()} />);
      fireEvent.change(input(), { target: { value: 'ab' } });
      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      fireEvent.change(input(), { target: { value: ' abc ' } });
      await act(async () => {
        vi.advanceTimersByTime(499);
      });
      expect(search).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(search).toHaveBeenCalledTimes(1);
      expect(search).toHaveBeenCalledWith('abc');
      expect(screen.getByText('ID: 10000000')).toBeInTheDocument();
      expect(screen.getByText('Prontuário: PR-0')).toBeInTheDocument();
    });

    it('does not search a one-character term and shows no list', async () => {
      render(<PatientSearchInput value="" onChange={vi.fn()} />);
      await typeAndWait('a');
      expect(search).not.toHaveBeenCalled();
      expect(screen.queryByText('Nenhum paciente encontrado')).not.toBeInTheDocument();
    });

    it.each([
      ['data.patients', { data: { patients: [{ participantId: '11111111' }] } }],
      ['patients', { patients: [{ participantId: '11111111' }] }],
      ['data', { data: [{ participantId: '11111111' }] }],
      ['a bare array', [{ participantId: '11111111' }]],
    ])('reads the results from %s', async (_shape, body) => {
      search.mockResolvedValue({ data: body });
      render(<PatientSearchInput value="" onChange={vi.fn()} />);
      await typeAndWait('11');
      expect(screen.getByText('ID: 11111111')).toBeInTheDocument();
      expect(screen.queryByText(/Prontuário:/)).not.toBeInTheDocument();
    });

    it('shows Nenhum paciente encontrado for a response it cannot read', async () => {
      search.mockResolvedValue({ data: { total: 0 } });
      render(<PatientSearchInput value="" onChange={vi.fn()} />);
      await typeAndWait('zz');
      expect(screen.getByText('Nenhum paciente encontrado')).toBeInTheDocument();
    });

    it('shows Buscando... while a search runs with the list open, and no list before the first answer', async () => {
      const first = deferred<{ data: unknown }>();
      search.mockReturnValueOnce(first.promise);
      render(<PatientSearchInput value="" onChange={vi.fn()} />);
      await typeAndWait('ab');
      expect(screen.queryByText('Buscando...')).not.toBeInTheDocument();
      await act(async () => {
        first.resolve({ data: patients(1) });
      });
      const call = deferred<{ data: unknown }>();
      search.mockReturnValueOnce(call.promise);
      await typeAndWait('abc');
      expect(screen.getByText('Buscando...')).toBeInTheDocument();
      expect(screen.queryByText('Nenhum paciente encontrado')).not.toBeInTheDocument();
      await act(async () => {
        call.resolve({ data: [] });
      });
      expect(screen.queryByText('Buscando...')).not.toBeInTheDocument();
      expect(screen.getByText('Nenhum paciente encontrado')).toBeInTheDocument();
    });

    it('logs a failed search and shows Nenhum paciente encontrado', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const failure = new Error('boom');
      search.mockRejectedValue(failure);
      render(<PatientSearchInput value="" onChange={vi.fn()} />);
      await typeAndWait('ab');
      expect(error).toHaveBeenCalledWith('Erro ao buscar pacientes:', failure);
      expect(screen.getByText('Nenhum paciente encontrado')).toBeInTheDocument();
    });

    it('lists the first 10 results and counts the rest', async () => {
      search.mockResolvedValue({ data: patients(12) });
      render(<PatientSearchInput value="" onChange={vi.fn()} />);
      await typeAndWait('PR');
      expect(screen.getAllByText(/^ID: /)).toHaveLength(10);
      expect(screen.getByText('ID: 10000009')).toBeInTheDocument();
      expect(screen.queryByText('ID: 10000010')).not.toBeInTheDocument();
      expect(screen.getByText('+2 resultado(s) encontrado(s)')).toBeInTheDocument();
    });

    it('lists exactly 10 results with no overflow line', async () => {
      search.mockResolvedValue({ data: patients(10) });
      render(<PatientSearchInput value="" onChange={vi.fn()} />);
      await typeAndWait('PR');
      expect(screen.getAllByText(/^ID: /)).toHaveLength(10);
      expect(screen.queryByText(/resultado\(s\) encontrado\(s\)/)).not.toBeInTheDocument();
    });

    it('renders results that lack a participantId', async () => {
      search.mockResolvedValue({ data: [{ _id: 'a1', recordNumber: 7 }, { recordNumber: null }] });
      render(<PatientSearchInput value="" onChange={vi.fn()} />);
      await typeAndWait('PR');
      expect(screen.getAllByText(/^ID:/)).toHaveLength(2);
      expect(screen.getByText('Prontuário: 7')).toBeInTheDocument();
    });

    it('selecting a result sets the field, calls onChange and marks it valid', async () => {
      search.mockResolvedValue({ data: patients(2) });
      const onChange = vi.fn();
      const onValidationChange = vi.fn();
      render(<PatientSearchInput value="" onChange={onChange} onValidationChange={onValidationChange} />);
      await typeAndWait('PR');
      fireEvent.click(screen.getByText('ID: 10000001'));
      expect(onChange).toHaveBeenCalledWith('10000001');
      expect(onValidationChange).toHaveBeenLastCalledWith(true);
      expect(input().value).toBe('10000001');
      expect(screen.getByText('✓ ID válido')).toBeInTheDocument();
      expect(screen.queryByText('ID: 10000000')).not.toBeInTheDocument();
    });

    it('closes the list on a mousedown outside it, not inside it', async () => {
      search.mockResolvedValue({ data: patients(1) });
      render(
        <div>
          <span>outside</span>
          <PatientSearchInput value="" onChange={vi.fn()} />
        </div>,
      );
      await typeAndWait('PR');
      fireEvent.mouseDown(screen.getByText('ID: 10000000'));
      expect(screen.getByText('ID: 10000000')).toBeInTheDocument();
      fireEvent.mouseDown(screen.getByText('outside'));
      expect(screen.queryByText('ID: 10000000')).not.toBeInTheDocument();
    });

    it('reopens the kept results on focus without searching again', async () => {
      search.mockResolvedValue({ data: patients(1) });
      render(
        <div>
          <span>outside</span>
          <PatientSearchInput value="" onChange={vi.fn()} />
        </div>,
      );
      await typeAndWait('PR');
      fireEvent.mouseDown(screen.getByText('outside'));
      fireEvent.focus(input());
      expect(screen.getByText('ID: 10000000')).toBeInTheDocument();
      expect(search).toHaveBeenCalledTimes(1);
    });

    it('searches again on focus when the typed term found nothing', async () => {
      search.mockResolvedValue({ data: [] });
      render(<PatientSearchInput value="" onChange={vi.fn()} />);
      await typeAndWait('ab');
      await act(async () => {
        fireEvent.focus(input());
      });
      expect(search).toHaveBeenCalledTimes(2);
      expect(search).toHaveBeenLastCalledWith('ab');
    });

    it('does nothing on focus with no term and no initial dropdown', async () => {
      render(<PatientSearchInput value="" onChange={vi.fn()} />);
      await act(async () => {
        fireEvent.focus(input());
      });
      expect(search).not.toHaveBeenCalled();
      expect(getAll).not.toHaveBeenCalled();
    });

    it('hides the list when the field is cleared, without an initial dropdown', async () => {
      search.mockResolvedValue({ data: patients(1) });
      render(<PatientSearchInput value="" onChange={vi.fn()} />);
      await typeAndWait('PR');
      await typeAndWait('');
      expect(screen.queryByText('ID: 10000000')).not.toBeInTheDocument();
      expect(getAll).not.toHaveBeenCalled();
    });
  });

  describe('initial dropdown', () => {
    it('loads the first initialLimit patients from the toggle, then closes on a second click', async () => {
      const call = deferred<{ data: unknown }>();
      getAll.mockReturnValue(call.promise);
      const { container } = render(<PatientSearchInput value="" onChange={vi.fn()} enableInitialDropdown initialLimit={5} />);
      const toggle = screen.getByRole('button', { name: 'Alternar lista de pacientes' });
      expect(container.querySelector('svg.lucide-chevron-down')?.getAttribute('class')).not.toContain('open');
      fireEvent.click(toggle);
      expect(getAll).toHaveBeenCalledWith({ limit: 5, skip: 0 });
      expect(screen.getByText('Buscando...')).toBeInTheDocument();
      await act(async () => {
        call.resolve({ data: { data: patients(3) } });
      });
      expect(screen.getAllByText(/^ID: /)).toHaveLength(3);
      expect(container.querySelector('svg.lucide-chevron-down')?.getAttribute('class')).toContain('open');
      fireEvent.click(toggle);
      expect(screen.queryByText('ID: 10000000')).not.toBeInTheDocument();
      expect(getAll).toHaveBeenCalledTimes(1);
    });

    it('asks for 20 patients by default and says when none are available', async () => {
      getAll.mockResolvedValue({ data: { data: [] } });
      render(<PatientSearchInput value="" onChange={vi.fn()} enableInitialDropdown />);
      await act(async () => {
        fireEvent.focus(input());
      });
      expect(getAll).toHaveBeenCalledWith({ limit: 20, skip: 0 });
      expect(screen.getByText('Nenhum paciente disponível')).toBeInTheDocument();
    });

    it('logs a failed load and says none are available', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const failure = new Error('down');
      getAll.mockRejectedValue(failure);
      render(<PatientSearchInput value="" onChange={vi.fn()} enableInitialDropdown />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Alternar lista de pacientes' }));
      });
      expect(error).toHaveBeenCalledWith('Erro ao carregar pacientes iniciais:', failure);
      expect(screen.getByText('Nenhum paciente disponível')).toBeInTheDocument();
    });

    it('reloads the initial list when the typed term is cleared', async () => {
      vi.useFakeTimers();
      search.mockResolvedValue({ data: [] });
      getAll.mockResolvedValue({ data: patients(2) });
      render(<PatientSearchInput value="" onChange={vi.fn()} enableInitialDropdown />);
      await typeAndWait('zz');
      expect(getAll).not.toHaveBeenCalled();
      await typeAndWait('  ');
      expect(getAll).toHaveBeenCalledWith({ limit: 20, skip: 0 });
      expect(screen.getAllByText(/^ID: /)).toHaveLength(2);
    });

    it('keeps the toggle from taking focus on mousedown', () => {
      render(<PatientSearchInput value="" onChange={vi.fn()} enableInitialDropdown />);
      const toggle = screen.getByRole('button', { name: 'Alternar lista de pacientes' });
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      toggle.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });

    it('moves the status icon left of the toggle', async () => {
      validateID.mockResolvedValue({ data: { valid: true } });
      const { container } = render(<PatientSearchInput value="12345678" onChange={vi.fn()} enableInitialDropdown />);
      expect(container.querySelector('svg.lucide-loader')?.getAttribute('style')).toContain('right: 2.5rem');
      expect(await screen.findByText('✓ ID válido')).toBeInTheDocument();
      expect(container.querySelector('svg.lucide-check-circle')?.getAttribute('style')).toContain('right: 2.5rem');
    });

    it('places the not-found icon at the right edge without a toggle, and left of it with one', async () => {
      validateID.mockResolvedValue({ data: { valid: false } });
      const { container, unmount } = render(<PatientSearchInput value="87654321" onChange={vi.fn()} />);
      await screen.findByText('ID de paciente não encontrado');
      expect(container.querySelector('svg.lucide-xcircle')?.getAttribute('style')).toContain('right: 0.75rem');
      unmount();
      const second = render(<PatientSearchInput value="87654321" onChange={vi.fn()} enableInitialDropdown />);
      await screen.findByText('ID de paciente não encontrado');
      expect(second.container.querySelector('svg.lucide-xcircle')?.getAttribute('style')).toContain('right: 2.5rem');
    });
  });
});
