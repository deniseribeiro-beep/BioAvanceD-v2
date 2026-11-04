import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import BiomarkerAssociationsPage from './BiomarkerAssociationsPage';
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/biomarker-associations']}>
      <BiomarkerAssociationsPage />
    </MemoryRouter>
  );
}

describe('BiomarkerAssociationsPage (#1402, ELM-0275..0285)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigate.mockReset();
    mocked.getAll.mockResolvedValue({ data: { success: true, data: [stored] } } as any);
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

  it('navigates to Nova Associação', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();
    await screen.findByText('bm-1');
    await user.click(screen.getByRole('button', { name: 'Nova Associação' }));
    expect(navigate).toHaveBeenCalledWith('/biomarker-associations/new');
  });

  it('navigates to edit with state', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();
    await screen.findByText('bm-1');
    await user.click(screen.getByTitle('Editar'));
    expect(navigate).toHaveBeenCalledWith('/biomarker-associations/bm-1/edit', {
      state: { association: stored },
    });
  });
});
