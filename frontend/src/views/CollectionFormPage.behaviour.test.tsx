import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const navigate = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (_k: string, fb?: string) => fb ?? _k, language: 'pt-BR' }),
}));

const collectionsHook = vi.hoisted(() => ({
  collections: [] as any[],
  createCollection: vi.fn(),
  updateCollection: vi.fn(),
}));

vi.mock('../hooks/useCollections', () => ({
  useCollections: () => collectionsHook,
}));

vi.mock('../services/api', () => ({
  collectionsService: { getById: vi.fn() },
}));

import CollectionFormPage from './CollectionFormPage';

async function fill(user: ReturnType<typeof userEvent.setup>, input: HTMLElement, value: string) {
  await user.clear(input);
  await user.paste(value);
}

function renderForm(path: string, state?: object) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <Routes>
        <Route path="/collections/new" element={<CollectionFormPage />} />
        <Route path="/collections/:id/edit" element={<CollectionFormPage />} />
      </Routes>
    </MemoryRouter>
  );
}

let alertSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  navigate.mockReset();
  collectionsHook.collections = [];
  collectionsHook.createCollection.mockResolvedValue(undefined);
  collectionsHook.updateCollection.mockResolvedValue(undefined);
  alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CollectionFormPage', () => {
  it('creates with sample types as text objects', async () => {
    const user = userEvent.setup();
    renderForm('/collections/new');
    const regime = screen.getByTestId('collection-governance-regime-select');
    expect(regime).toBeEnabled();
    await fill(user, screen.getByTestId('collection-id-input'), 'col-new');
    await fill(user, screen.getByTestId('collection-name-input'), 'Coleção Nova');
    await user.selectOptions(regime, 'biorepository');
    await fill(user, screen.getByTestId('collection-sample-types-input'), 'plasma; serum');
    await user.click(screen.getByTestId('collection-form-submit'));
    await waitFor(() =>
      expect(collectionsHook.createCollection).toHaveBeenCalledWith(
        expect.objectContaining({
          collectionId: 'col-new',
          collectionName: 'Coleção Nova',
          governanceRegime: 'biorepository',
          sampleTypes: [{ text: 'plasma' }, { text: 'serum' }],
        })
      )
    );
    expect(navigate).toHaveBeenCalledWith('/system-management?tab=collections');
  });

  it('edits without id input and with regime locked', async () => {
    const user = userEvent.setup();
    const collection = {
      collectionId: 'col-1',
      collectionName: 'Coleção Oncológica',
      collectionStatus: 'active',
      governanceRegime: 'biobank',
      sampleTypes: [{ text: 'plasma' }],
    };
    renderForm('/collections/col-1/edit', { collection });
    expect(screen.queryByTestId('collection-id-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('collection-governance-regime-select')).toBeDisabled();
    await fill(user, screen.getByTestId('collection-name-input'), 'Coleção Renomeada');
    await user.click(screen.getByTestId('collection-form-submit'));
    await waitFor(() =>
      expect(collectionsHook.updateCollection).toHaveBeenCalledWith(
        'col-1',
        expect.objectContaining({
          collectionName: 'Coleção Renomeada',
          governanceRegime: 'biobank',
        })
      )
    );
  });

  it('alerts on failed save', async () => {
    const user = userEvent.setup();
    collectionsHook.createCollection.mockRejectedValueOnce(new Error('Coleção bloqueada'));
    renderForm('/collections/new');
    await fill(user, screen.getByTestId('collection-id-input'), 'col-x');
    await fill(user, screen.getByTestId('collection-name-input'), 'X');
    await user.selectOptions(screen.getByTestId('collection-governance-regime-select'), 'biobank');
    await user.click(screen.getByTestId('collection-form-submit'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Coleção bloqueada'));
    expect(navigate).not.toHaveBeenCalled();
  });
});
