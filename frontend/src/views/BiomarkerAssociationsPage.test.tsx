import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import BiomarkerAssociationsPage from './BiomarkerAssociationsPage';
import { biomarkerAssociationService } from '../services/api';
import type { BiomarkerAssociation } from '../types/models';

vi.mock('../services/api', () => ({
  biomarkerAssociationService: { getAll: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

const ORPHA = 'http://www.orpha.net';
const MONDO = 'http://purl.obolibrary.org/obo/mondo.owl';

const stored: BiomarkerAssociation = {
  _id: '68ab12cd34ef56ab78cd90ef',
  biomarkerId: 'bm-1',
  analyte: { systemUri: 'http://loinc.org', code: '2857-1', display: 'PSA' },
  associatedCondition: [{ systemUri: ORPHA, code: 'ORPHA:1331', display: 'Câncer de próstata' }],
  biomarkerRole: 'diagnostic',
  contextOfUse: 'Rastreamento',
  evidenceReferences: [{ system: 'PMID', value: '12345' }],
  cutoff: { value: 4 },
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
};

const mocked = vi.mocked(biomarkerAssociationService);

type User = ReturnType<typeof userEvent.setup>;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/biomarker-associations']}>
      <BiomarkerAssociationsPage />
    </MemoryRouter>
  );
}

async function openCreateForm(user: User) {
  await screen.findByText('bm-1');
  await user.click(screen.getByRole('button', { name: 'Nova Associação' }));
  return screen.getByLabelText('Contexto de uso').closest('form') as HTMLFormElement;
}

async function fillRequired(user: User) {
  await user.type(screen.getByLabelText('Sistema do analito'), ' http://loinc.org ');
  await user.type(screen.getByLabelText('Código do analito'), '1234-5');
  await user.type(screen.getByLabelText('Código da condição 1'), 'ORPHA:558');
  await user.type(screen.getByLabelText('Nome da condição 1'), 'Marfan');
  await user.click(screen.getByRole('button', { name: 'Adicionar condição' }));
  await user.selectOptions(screen.getByLabelText('Sistema da condição 2'), MONDO);
  await user.type(screen.getByLabelText('Código da condição 2'), 'MONDO:0007947');
  await user.selectOptions(screen.getByLabelText('Papel do biomarcador'), 'prognostic');
  await user.type(screen.getByLabelText('Contexto de uso'), '  Acompanhamento  ');
  await user.selectOptions(screen.getByLabelText('Sistema da evidência 1'), 'DOI');
  await user.type(screen.getByLabelText('Valor da evidência 1'), '10.1000/xyz');
}

describe('BiomarkerAssociationsPage (#1402, ELM-0275..0285)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getAll.mockResolvedValue({ data: { success: true, data: [stored] } } as any);
    mocked.create.mockResolvedValue({ data: { success: true, data: stored } } as any);
    mocked.update.mockResolvedValue({ data: { success: true, data: stored } } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists the stored associations', async () => {
    renderPage();
    expect(await screen.findByText('bm-1')).toBeInTheDocument();
    expect(screen.getByText('PSA')).toBeInTheDocument();
    expect(screen.getByText('PMID:12345')).toBeInTheDocument();
  });

  it('creates with the typed fields and leaves a blank biomarkerId out', async () => {
    const user = userEvent.setup();
    renderPage();
    const form = await openCreateForm(user);
    expect(screen.getByRole('button', { name: 'Remover condição 1' })).toBeDisabled();
    await fillRequired(user);
    await user.click(within(form).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(mocked.create).toHaveBeenCalledTimes(1));
    const payload = mocked.create.mock.calls[0][0];
    expect(payload).toEqual({
      analyte: { systemUri: 'http://loinc.org', code: '1234-5' },
      associatedCondition: [
        { systemUri: ORPHA, code: 'ORPHA:558', display: 'Marfan' },
        { systemUri: MONDO, code: 'MONDO:0007947' },
      ],
      biomarkerRole: 'prognostic',
      contextOfUse: 'Acompanhamento',
      evidenceReferences: [{ system: 'DOI', value: '10.1000/xyz' }],
    });
    expect(payload).not.toHaveProperty('biomarkerId');
    await waitFor(() => expect(mocked.getAll).toHaveBeenCalledTimes(2));
    expect(screen.queryByLabelText('Contexto de uso')).not.toBeInTheDocument();
  });

  it('shows a 409 as a duplicate biomarkerId', async () => {
    mocked.create.mockRejectedValue({
      response: { status: 409, data: { success: false, error: 'Registro duplicado', message: 'biomarkerId já existe' } },
    });
    const user = userEvent.setup();
    renderPage();
    const form = await openCreateForm(user);
    await user.type(screen.getByLabelText('biomarkerId'), 'bm-dup');
    await fillRequired(user);
    await user.click(within(form).getByRole('button', { name: 'Salvar' }));

    expect(await within(form).findByRole('alert')).toHaveTextContent('Já existe uma associação com o biomarkerId bm-dup.');
    expect(mocked.create.mock.calls[0][0]).toHaveProperty('biomarkerId', 'bm-dup');
    expect(screen.getByLabelText('biomarkerId')).toHaveValue('bm-dup');
    expect(screen.getByLabelText('Contexto de uso')).toHaveValue('  Acompanhamento  ');
    expect(mocked.getAll).toHaveBeenCalledTimes(1);
  });

  it('lists each 422 detail', async () => {
    mocked.create.mockRejectedValue({
      response: { status: 422, data: { success: false, error: 'Payload inválido', details: ['a', 'b'] } },
    });
    const user = userEvent.setup();
    renderPage();
    const form = await openCreateForm(user);
    await fillRequired(user);
    await user.click(within(form).getByRole('button', { name: 'Salvar' }));

    const alert = await within(form).findByRole('alert');
    expect(within(alert).getByText('Payload inválido')).toBeInTheDocument();
    expect(within(alert).getByText('a')).toBeInTheDocument();
    expect(within(alert).getByText('b')).toBeInTheDocument();
    expect(screen.getByLabelText('Contexto de uso')).toBeInTheDocument();
  });

  it('edits without sending biomarkerId', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('bm-1');
    await user.click(screen.getByTitle('Editar'));

    const idInput = screen.getByLabelText('biomarkerId');
    expect(idInput).toHaveValue('bm-1');
    expect(idInput).toBeDisabled();
    expect(screen.getByLabelText('Nome do analito')).toHaveValue('PSA');
    expect(screen.getByLabelText('Código da condição 1')).toHaveValue('ORPHA:1331');
    expect(screen.getByLabelText('Papel do biomarcador')).toHaveValue('diagnostic');
    expect(screen.getByLabelText('Sistema da evidência 1')).toHaveValue('PMID');

    const context = screen.getByLabelText('Contexto de uso');
    await user.clear(context);
    await user.type(context, 'Diagnóstico precoce');
    const form = context.closest('form') as HTMLFormElement;
    await user.click(within(form).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(mocked.update).toHaveBeenCalledTimes(1));
    const [id, payload] = mocked.update.mock.calls[0];
    expect(id).toBe('bm-1');
    expect(payload).toEqual({
      analyte: { systemUri: 'http://loinc.org', code: '2857-1', display: 'PSA' },
      associatedCondition: [{ systemUri: ORPHA, code: 'ORPHA:1331', display: 'Câncer de próstata' }],
      biomarkerRole: 'diagnostic',
      contextOfUse: 'Diagnóstico precoce',
      evidenceReferences: [{ system: 'PMID', value: '12345' }],
    });
    expect(payload).not.toHaveProperty('biomarkerId');
    expect(mocked.create).not.toHaveBeenCalled();
  });
});
