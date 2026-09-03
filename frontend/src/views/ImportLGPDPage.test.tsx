import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ImportLGPDPage from './ImportLGPDPage';
import { importLGPDService } from '../services/api';

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
