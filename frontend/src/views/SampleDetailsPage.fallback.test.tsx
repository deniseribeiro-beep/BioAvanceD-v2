import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// #1430: the samples list is capped, so a deep link to a specimen outside the
// loaded window must fetch it with GET /samples/:id before showing not-found.
vi.mock('../contexts/LanguageContext', () => ({
  // An empty string for a key with no fallback, so the page's own `|| '...'` text shows.
  useLanguage: () => ({ t: (_k: string, fb?: string) => fb ?? '', language: 'pt-BR' }),
}));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { roleName: 'Tecnico' }, hasRole: () => false }),
}));

const noop = () => Promise.resolve();
// One array for every render: the page's lookup effect depends on `samples`.
const loadedSamples = [{ _id: 'loaded-1', specimenId: 'SPC-LOADED' }];
vi.mock('../hooks/useSamples', () => ({
  useSamples: () => ({ samples: loadedSamples, loading: false, error: null, updateSample: noop, loadSamples: noop }),
}));
const noResults: unknown[] = [];
vi.mock('../hooks/useResults', () => ({
  useResults: () => ({ results: noResults, loadResults: noop }),
}));
const noEquipment: unknown[] = [];
vi.mock('../hooks/useEquipment', () => ({
  useEquipment: () => ({ equipment: noEquipment }),
}));
vi.mock('../components/AnalysisUploadModal', () => ({ default: () => null }));
vi.mock('../components/SampleFilesSection', () => ({ default: () => null }));
vi.mock('../components/samples/InlineStorageMovementPanel', () => ({ default: () => null }));
vi.mock('../components/samples/CloseSpecimenAction', () => ({ default: () => null }));
vi.mock('../services/storageApi', () => ({
  storageApi: { getSampleLocation: vi.fn().mockResolvedValue({ success: false }) },
}));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  sampleService: {
    getById: vi.fn(),
    getComplianceGraph: vi.fn().mockResolvedValue({ data: null }),
    getGraphStatus: vi.fn().mockResolvedValue({ data: { success: true, data: { sampleId: 'oid-1', projected: false, status: null, compromisedAt: null, compromiseFreezerKey: null, compromiseBreachedSince: null } } }),
  },
  resultService: { download: vi.fn() },
}));

import { sampleService } from '../services/api';
import SampleDetailsPage from './SampleDetailsPage';

const getById = vi.mocked(sampleService.getById);

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/samples/${id}`]}>
      <Routes>
        <Route path="/samples/:id" element={<SampleDetailsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  getById.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SampleDetailsPage sample lookup', () => {
  it('shows a sample from the loaded list without a GET', async () => {
    renderAt('SPC-LOADED');

    expect(await screen.findByTestId('sample-detail-page-title')).toHaveTextContent('SPC-LOADED');
    expect(getById).not.toHaveBeenCalled();
  });

  it('fetches a sample missing from the loaded list with getById and shows it', async () => {
    getById.mockResolvedValue({ data: { success: true, data: { _id: 'remote-1', specimenId: 'SPC-REMOTE' } } } as never);
    renderAt('SPC-REMOTE');

    expect(await screen.findByTestId('sample-detail-page-title')).toHaveTextContent('SPC-REMOTE');
    expect(getById).toHaveBeenCalledWith('SPC-REMOTE');
  });

  it('keeps the not-found state when getById fails', async () => {
    getById.mockRejectedValue(new Error('404'));
    renderAt('SPC-MISSING');

    await waitFor(() => expect(getById).toHaveBeenCalledWith('SPC-MISSING'));
    expect(await screen.findByText('Amostra não encontrada')).toBeInTheDocument();
    expect(screen.queryByTestId('sample-detail-page-title')).not.toBeInTheDocument();
  });
});
