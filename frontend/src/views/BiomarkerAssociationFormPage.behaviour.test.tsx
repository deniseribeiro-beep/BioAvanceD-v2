import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import BiomarkerAssociationFormPage from './BiomarkerAssociationFormPage';
import { biomarkerAssociationService } from '../services/api';
import type { BiomarkerAssociation } from '../types/models';

const navigate = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

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

function renderForm(path: string, state?: object) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <Routes>
        <Route path="/biomarker-associations/new" element={<BiomarkerAssociationFormPage />} />
        <Route path="/biomarker-associations/:id/edit" element={<BiomarkerAssociationFormPage />} />
      </Routes>
    </MemoryRouter>
  );
}

async function fill(user: User, field: HTMLElement, text: string) {
  await user.click(field);
  await user.paste(text);
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

describe('BiomarkerAssociationFormPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigate.mockReset();
    mocked.create.mockResolvedValue({ data: { success: true, data: stored } } as any);
    mocked.update.mockResolvedValue({ data: { success: true, data: stored } } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates with the typed fields and leaves a blank biomarkerId out', async () => {
    const user = userEvent.setup({ delay: null });
    renderForm('/biomarker-associations/new');
    const form = screen.getByLabelText('Contexto de uso').closest('form') as HTMLFormElement;
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
    expect(navigate).toHaveBeenCalledWith('/biomarker-associations');
  });

  it('shows a 409 as a duplicate biomarkerId', async () => {
    mocked.create.mockRejectedValue({
      response: { status: 409, data: { success: false, error: 'Registro duplicado', message: 'biomarkerId já existe' } },
    });
    const user = userEvent.setup({ delay: null });
    renderForm('/biomarker-associations/new');
    const form = screen.getByLabelText('Contexto de uso').closest('form') as HTMLFormElement;
    await fill(user, screen.getByLabelText('biomarkerId'), 'bm-dup');
    await fillRequired(user);
    await user.click(within(form).getByRole('button', { name: 'Salvar' }));

    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'Já existe uma associação com o biomarkerId bm-dup.'
    );
    expect(mocked.create.mock.calls[0][0]).toHaveProperty('biomarkerId', 'bm-dup');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('lists each 422 detail', async () => {
    mocked.create.mockRejectedValue({
      response: { status: 422, data: { success: false, error: 'Payload inválido', details: ['a', 'b'] } },
    });
    const user = userEvent.setup({ delay: null });
    renderForm('/biomarker-associations/new');
    const form = screen.getByLabelText('Contexto de uso').closest('form') as HTMLFormElement;
    await fillRequired(user);
    await user.click(within(form).getByRole('button', { name: 'Salvar' }));

    const alert = await within(form).findByRole('alert');
    expect(within(alert).getByText('Payload inválido')).toBeInTheDocument();
    expect(within(alert).getByText('a')).toBeInTheDocument();
    expect(within(alert).getByText('b')).toBeInTheDocument();
  });

  it('edits without sending biomarkerId', async () => {
    const user = userEvent.setup({ delay: null });
    renderForm('/biomarker-associations/bm-1/edit', { association: stored });

    const idInput = screen.getByLabelText('biomarkerId');
    expect(idInput).toHaveValue('bm-1');
    expect(idInput).toBeDisabled();
    expect(screen.getByLabelText('Nome do analito')).toHaveValue('PSA');

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

  it('falls back to the default save message when the error carries none', async () => {
    mocked.create.mockRejectedValue({});
    const user = userEvent.setup({ delay: null });
    renderForm('/biomarker-associations/new');
    const form = screen.getByLabelText('Contexto de uso').closest('form') as HTMLFormElement;
    await fillRequired(user);
    await user.click(within(form).getByRole('button', { name: 'Salvar' }));

    const alert = await within(form).findByRole('alert');
    expect(alert).toHaveTextContent(/^Erro ao salvar a associação$/);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('opens a stored row that lacks its fields with every field empty or at its default', () => {
    renderForm('/biomarker-associations/bm-3/edit', { association: { biomarkerId: 'bm-3' } });
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

  it('keeps a stored system outside the lists as its own option', () => {
    const legacy = {
      ...stored,
      biomarkerId: 'bm-5',
      associatedCondition: [{ systemUri: 'http://snomed.info/sct', code: '399068003' }],
      evidenceReferences: [{}, { system: 'ISBN', value: '9780000000002' }],
    };
    renderForm('/biomarker-associations/bm-5/edit', { association: legacy });

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
    const user = userEvent.setup({ delay: null });
    renderForm('/biomarker-associations/bm-1/edit', { association: versioned });

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
    renderForm('/biomarker-associations/new');

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
