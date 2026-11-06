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

// One input event per field: a user.type per keystroke re-renders the whole form
// each key, which ran past the 5 s test timeout under a loaded parallel run (#1414).
async function fill(user: User, field: HTMLElement, text: string) {
  await user.click(field);
  await user.paste(text);
}

async function openCreateForm(user: User) {
  await screen.findByText('bm-1');
  await user.click(screen.getByRole('button', { name: 'Nova Associação' }));
  return screen.getByLabelText('Contexto de uso').closest('form') as HTMLFormElement;
}

async function fillRequired(user: User) {
  await fill(user, screen.getByLabelText('Sistema do analito'), ' http://loinc.org ');
  await fill(user, screen.getByLabelText('Código do analito'), '1234-5');
  await fill(user, screen.getByLabelText('Código da condição 1'), 'ORPHA:558');
  await fill(user, screen.getByLabelText('Nome da condição 1'), 'Marfan');
  await user.click(screen.getByRole('button', { name: 'Adicionar condição' }));
  await user.selectOptions(screen.getByLabelText('Sistema da condição 2'), MONDO);
  await fill(user, screen.getByLabelText('Código da condição 2'), 'MONDO:0007947');
  await user.selectOptions(screen.getByLabelText('Papel do biomarcador'), 'prognostic');
  await fill(user, screen.getByLabelText('Contexto de uso'), '  Acompanhamento  ');
  await user.selectOptions(screen.getByLabelText('Sistema da evidência 1'), 'DOI');
  await fill(user, screen.getByLabelText('Valor da evidência 1'), '10.1000/xyz');
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
    const user = userEvent.setup({ delay: null });
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
    const user = userEvent.setup({ delay: null });
    renderPage();
    const form = await openCreateForm(user);
    await fill(user, screen.getByLabelText('biomarkerId'), 'bm-dup');
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
    const user = userEvent.setup({ delay: null });
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
    const user = userEvent.setup({ delay: null });
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
    await fill(user, context, 'Diagnóstico precoce');
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

  it('lists each load error reading, object details by their message', async () => {
    mocked.getAll.mockRejectedValue({
      response: { status: 500, data: { message: 'Falha no banco', details: [{ message: 'detalhe 1' }, null, 'detalhe 2'] } },
    });
    renderPage();
    expect(await screen.findByText('Erro: Falha no banco')).toBeInTheDocument();
    expect(screen.getByText('Erro: detalhe 1')).toBeInTheDocument();
    expect(screen.getByText('Erro: detalhe 2')).toBeInTheDocument();
    expect(screen.getAllByText(/^Erro: /)).toHaveLength(3);
    expect(screen.queryByText('Carregando...')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Editar')).not.toBeInTheDocument();
  });

  it('shows a bare Error message when the load fails without a response', async () => {
    mocked.getAll.mockRejectedValue(new Error('Network Error'));
    renderPage();
    expect(await screen.findByText('Erro: Network Error')).toBeInTheDocument();
    expect(screen.getAllByText(/^Erro: /)).toHaveLength(1);
  });

  it('falls back to the default save message when the error carries none', async () => {
    mocked.create.mockRejectedValue({});
    const user = userEvent.setup({ delay: null });
    renderPage();
    const form = await openCreateForm(user);
    await fillRequired(user);
    await user.click(within(form).getByRole('button', { name: 'Salvar' }));

    const alert = await within(form).findByRole('alert');
    expect(alert).toHaveTextContent(/^Erro ao salvar a associação$/);
    expect(mocked.getAll).toHaveBeenCalledTimes(1);
  });

  it('lists and opens a stored row that lacks its fields', async () => {
    const codeOnly = { biomarkerId: 'bm-2', analyte: { systemUri: 'http://loinc.org', code: '2345-7' } };
    const bare = { biomarkerId: 'bm-3' };
    mocked.getAll.mockResolvedValue({ data: { success: true, data: [codeOnly, bare] } } as any);
    const user = userEvent.setup({ delay: null });
    renderPage();

    const codeRow = (await screen.findByText('bm-2')).closest('tr') as HTMLTableRowElement;
    expect(within(codeRow).getByText('2345-7')).toBeInTheDocument();
    const bareRow = screen.getByText('bm-3').closest('tr') as HTMLTableRowElement;
    const cells = within(bareRow).getAllByRole('cell').map((cell) => cell.textContent);
    expect(cells.slice(0, 6)).toEqual(['bm-3', '-', '', '', '', '']);

    await user.click(within(bareRow).getByTitle('Editar'));
    expect(screen.getByLabelText('biomarkerId')).toHaveValue('bm-3');
    expect(screen.getByLabelText('Sistema do analito')).toHaveValue('');
    expect(screen.getByLabelText('Código do analito')).toHaveValue('');
    expect(screen.getByLabelText('Nome do analito')).toHaveValue('');
    expect(screen.getByLabelText('Sistema da condição 1')).toHaveValue(ORPHA);
    expect(screen.getByLabelText('Código da condição 1')).toHaveValue('');
    expect(screen.queryByLabelText('Código da condição 2')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Papel do biomarcador')).toHaveValue('');
    expect(screen.getByLabelText('Contexto de uso')).toHaveValue('');
    expect(screen.getByLabelText('Sistema da evidência 1')).toHaveValue('DOI');
    expect(screen.getByLabelText('Valor da evidência 1')).toHaveValue('');
    expect(screen.queryByLabelText('Valor da evidência 2')).not.toBeInTheDocument();
  });

  it('keeps a stored system outside the lists as its own option', async () => {
    const legacy = {
      ...stored,
      biomarkerId: 'bm-5',
      associatedCondition: [{ systemUri: 'http://snomed.info/sct', code: '399068003' }],
      evidenceReferences: [{}, { system: 'ISBN', value: '9780000000002' }],
    };
    mocked.getAll.mockResolvedValue({ data: { success: true, data: [legacy] } } as any);
    const user = userEvent.setup({ delay: null });
    renderPage();
    await screen.findByText('bm-5');
    await user.click(screen.getByTitle('Editar'));

    const optionsOf = (select: HTMLElement) => within(select).getAllByRole('option').map((option) => option.textContent);
    const conditionSystem = screen.getByLabelText('Sistema da condição 1');
    expect(conditionSystem).toHaveValue('http://snomed.info/sct');
    expect(optionsOf(conditionSystem)).toEqual(['ORPHA', 'ICD-11', 'MONDO', 'http://snomed.info/sct']);
    const firstEvidence = screen.getByLabelText('Sistema da evidência 1');
    expect(firstEvidence).toHaveValue('DOI');
    expect(optionsOf(firstEvidence)).toEqual(['DOI', 'PMID']);
    expect(screen.getByLabelText('Valor da evidência 1')).toHaveValue('');
    const secondEvidence = screen.getByLabelText('Sistema da evidência 2');
    expect(secondEvidence).toHaveValue('ISBN');
    expect(optionsOf(secondEvidence)).toEqual(['DOI', 'PMID', 'ISBN']);
  });

  it('sends a stored version back with the typed analyte name', async () => {
    const versioned = { ...stored, analyte: { ...stored.analyte, version: ' 2.74 ' } };
    mocked.getAll.mockResolvedValue({ data: { success: true, data: [versioned] } } as any);
    const user = userEvent.setup({ delay: null });
    renderPage();
    await screen.findByText('bm-1');
    await user.click(screen.getByTitle('Editar'));

    const name = screen.getByLabelText('Nome do analito');
    await user.clear(name);
    await fill(user, name, 'PSA total');
    const form = name.closest('form') as HTMLFormElement;
    await user.click(within(form).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(mocked.update).toHaveBeenCalledTimes(1));
    expect(mocked.update.mock.calls[0][1].analyte).toEqual({
      systemUri: 'http://loinc.org', code: '2857-1', version: '2.74', display: 'PSA total',
    });
  });

  it('adds and removes condition and evidence rows, each edit touching only its own row', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();
    await openCreateForm(user);

    await fill(user, screen.getByLabelText('Código da condição 1'), 'ORPHA:558');
    await user.click(screen.getByRole('button', { name: 'Adicionar condição' }));
    await fill(user, screen.getByLabelText('Código da condição 2'), 'ORPHA:909');
    expect(screen.getByLabelText('Código da condição 1')).toHaveValue('ORPHA:558');
    await user.click(screen.getByRole('button', { name: 'Remover condição 1' }));
    expect(screen.getByLabelText('Código da condição 1')).toHaveValue('ORPHA:909');
    expect(screen.queryByLabelText('Código da condição 2')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remover condição 1' })).toBeDisabled();

    expect(screen.getByRole('button', { name: 'Remover evidência 1' })).toBeDisabled();
    await fill(user, screen.getByLabelText('Valor da evidência 1'), '111');
    await user.click(screen.getByRole('button', { name: 'Adicionar evidência' }));
    expect(screen.getByLabelText('Sistema da evidência 2')).toHaveValue('DOI');
    await fill(user, screen.getByLabelText('Valor da evidência 2'), '999');
    expect(screen.getByLabelText('Valor da evidência 1')).toHaveValue('111');
    await user.click(screen.getByRole('button', { name: 'Remover evidência 1' }));
    expect(screen.getByLabelText('Valor da evidência 1')).toHaveValue('999');
    expect(screen.queryByLabelText('Valor da evidência 2')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remover evidência 1' })).toBeDisabled();
  });
});
