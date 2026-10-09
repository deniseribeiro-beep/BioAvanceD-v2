import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ImportLGPDPage from './ImportLGPDPage';
import { importLGPDService, organizationService } from '../services/api';

// #997: the "N linha(s) em branco ignorada(s)" notice at
// ImportLGPDPage.tsx:244-252 renders off `summary.skipped`, and `summary`
// only exists because `summarizeImportResult` (importLgpdFormatters.ts)
// reads `Number(data.skipped) || 0` where `data = response.data.data` --
// i.e. the mocked shape below, `{ data: { data: { skipped, ... } } }`.
// Nothing rendered the component to pin that shape or the notice's
// presence/absence/pluralisation, so a backend field rename or a frontend
// refactor could drift silently. Modeled on
// AnalysisUploadModal.test.tsx's mocking and render approach.
vi.mock('../services/api', () => ({
  importLGPDService: {
    import: vi.fn(),
    downloadTemplate: vi.fn(),
  },
  // #1354: the picker's scope lookup. Left unresolved it rejects, and the
  // page shows no picker, which is what the #997 cases below rely on.
  organizationService: {
    getMine: vi.fn(),
    getAll: vi.fn(),
  },
}));

function mockImportResult(overrides: { skipped: number }) {
  vi.mocked(importLGPDService.import).mockResolvedValue({
    data: {
      success: true,
      data: {
        total: 1,
        success: 1,
        errors: 0,
        duplicatesFound: 0,
        stagingBatchId: null,
        errorsDetails: [],
        ...overrides,
      },
    },
  } as any);
}

async function submitWithFile() {
  const user = userEvent.setup();
  const file = new File(['participantId\n'], 'amostras.csv', { type: 'text/csv' });
  const input = screen.getByTestId('import-lgpd-file');
  await user.upload(input, file);
  await user.click(screen.getByTestId('import-lgpd-submit'));
}

describe('ImportLGPDPage — blank-row "skipped" notice (#997)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the plural skipped-rows notice when the backend reports skipped > 1', async () => {
    mockImportResult({ skipped: 3 });

    render(
      <MemoryRouter>
        <ImportLGPDPage />
      </MemoryRouter>
    );

    await submitWithFile();

    await waitFor(() => {
      expect(screen.getByTestId('import-lgpd-skipped')).toHaveTextContent(
        '3 linhas em branco ignoradas'
      );
    });
  });

  it('shows the singular skipped-rows notice when exactly one row was skipped', async () => {
    mockImportResult({ skipped: 1 });

    render(
      <MemoryRouter>
        <ImportLGPDPage />
      </MemoryRouter>
    );

    await submitWithFile();

    await waitFor(() => {
      expect(screen.getByTestId('import-lgpd-skipped')).toHaveTextContent(
        '1 linha em branco ignorada'
      );
    });
  });

  it('renders no skipped-rows notice when nothing was skipped', async () => {
    mockImportResult({ skipped: 0 });

    render(
      <MemoryRouter>
        <ImportLGPDPage />
      </MemoryRouter>
    );

    await submitWithFile();

    // Wait for the summary card (which the skipped notice lives inside) to
    // actually render before asserting the notice's absence -- otherwise a
    // still-pending submit would make this pass vacuously.
    await waitFor(() => {
      expect(screen.getByTestId('import-lgpd-counts')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('import-lgpd-skipped')).toBeNull();
  });
});

// #1354: a multi-organization user must name the organization an import
// stamps; the backend refuses one that names none.
describe('ImportLGPDPage — organization picker (#1354)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockScope(scope: string, organizations: Array<{ organizationId: string; officialName: string }>) {
    vi.mocked(organizationService.getMine).mockResolvedValue({ data: { success: true, data: { scope, organizations } } } as any);
  }

  function sentOrganizationId() {
    const formData = vi.mocked(importLGPDService.import).mock.calls[0][1] as FormData;
    return formData.get('organizationId');
  }

  it('requires a multi-organization user to pick one, then sends it', async () => {
    mockScope('organization', [
      { organizationId: 'org-a', officialName: 'Hospital A' },
      { organizationId: 'org-b', officialName: 'Hospital B' },
    ]);
    mockImportResult({ skipped: 0 });
    render(
      <MemoryRouter>
        <ImportLGPDPage />
      </MemoryRouter>
    );

    const picker = await screen.findByTestId('import-lgpd-organization');
    await submitWithFile();
    expect(screen.getByTestId('import-lgpd-error').textContent).toMatch(/Selecione a organização/);
    expect(importLGPDService.import).not.toHaveBeenCalled();

    await userEvent.setup().selectOptions(picker, 'org-b');
    await userEvent.setup().click(screen.getByTestId('import-lgpd-submit'));
    await waitFor(() => expect(importLGPDService.import).toHaveBeenCalledTimes(1));
    expect(sentOrganizationId()).toBe('org-b');
  });

  it('shows no picker to a single-organization user, and sends no organization', async () => {
    mockScope('organization', [{ organizationId: 'org-a', officialName: 'Hospital A' }]);
    mockImportResult({ skipped: 0 });
    render(
      <MemoryRouter>
        <ImportLGPDPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(organizationService.getMine).toHaveBeenCalled());
    await submitWithFile();
    await waitFor(() => expect(importLGPDService.import).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('import-lgpd-organization')).toBeNull();
    expect(sentOrganizationId()).toBeNull();
  });
});
