import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ResultsPage from './ResultsPage';
import { importService, resultService, equipmentService } from '../services/api';
import { LanguageProvider } from '../contexts/LanguageContext';

// #1007: import-worker.js now OMITS `skippedRecords`/`duplicatesFound` (via a
// conditional spread) instead of writing a literal 0 when the worker counted
// neither. ResultsPage.tsx:385/399 gate the "Duplicados"/"Ignorados" report
// tiles on `!== undefined` precisely so an uncounted job renders no tile
// rather than a fabricated zero -- that false branch was unreachable before
// #1007 because the backend always wrote a defined value. Modeled on
// ImportLGPDPage.test.tsx's mocking/render approach (the repo's only other
// page-render RTL test).
vi.mock('../services/api', () => ({
  importService: {
    listJobs: vi.fn(),
    getImportReport: vi.fn(),
  },
  resultService: {
    getAll: vi.fn(),
    download: vi.fn(),
  },
  equipmentService: {
    getAll: vi.fn(),
  },
}));

// AnalysisUpload.jsx (unrelated to this subject) has no direct render
// coverage anywhere in the repo and does not import React itself; under this
// project's vitest config (no @vitejs/plugin-react in vitest.config.js,
// unlike vite.config.js) .jsx files get the classic JSX runtime, so
// rendering it throws `ReferenceError: React is not defined` and takes the
// whole ResultsPage tree down with it. Stubbed out here -- it lives in the
// import section, entirely separate from the report modal this file tests.
vi.mock('../components/AnalysisUpload.jsx', () => ({
  default: () => null,
}));

const baseJob = {
  jobID: 'job-1',
  userID: 'u1',
  userName: 'user',
  dataType: 'results',
  fileName: 'analysis.zip',
  filePath: '/tmp/analysis.zip',
  fileSize: 10,
  fileFormat: 'ZIP',
  status: 'completed',
};

function mockJobsList() {
  vi.mocked(importService.listJobs).mockResolvedValue({
    data: { success: true, data: { jobs: [baseJob], total: 1, limit: 20, skip: 0 } },
    status: 200,
  } as any);
}

function mockReport(metricOverrides: Record<string, unknown>) {
  vi.mocked(importService.getImportReport).mockResolvedValue({
    data: {
      success: true,
      data: {
        ...baseJob,
        metrics: {
          totalRecords: 5,
          successfulRecords: 4,
          failedRecords: 1,
          ...metricOverrides,
        },
        errors: [],
      },
    },
    status: 200,
  } as any);
}

async function openReport() {
  const user = userEvent.setup();
  await waitFor(() => {
    expect(screen.getByText('analysis.zip')).toBeInTheDocument();
  });
  await user.click(screen.getByRole('button', { name: /Relatório/ }));
}

function renderPage() {
  render(
    <MemoryRouter>
      <LanguageProvider>
        <ResultsPage />
      </LanguageProvider>
    </MemoryRouter>
  );
}

describe('ResultsPage — skipped/duplicates report tiles (#1007)', () => {
  beforeEach(() => {
    // initLanguage() falls back to navigator.language, which is
    // environment-dependent (jsdom's default resolved to en-US here) --
    // pin pt-BR explicitly so the assertions below are deterministic
    // regardless of what runs the suite.
    localStorage.setItem('app_language', 'pt-BR');
    vi.mocked(resultService.getAll).mockResolvedValue({
      data: { success: true, data: [] },
      status: 200,
    } as any);
    vi.mocked(equipmentService.getAll).mockResolvedValue({
      data: { success: true, data: [] },
      status: 200,
    } as any);
    mockJobsList();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('omits both tiles when the report carries neither key (the branch #1007 unblocked)', async () => {
    // No skippedRecords/duplicatesFound keys at all -- the real production
    // shape for a `results`-dataType job now that import-worker.js spreads
    // conditionally instead of writing `|| 0`.
    mockReport({});
    renderPage();
    await openReport();

    // Guard against a vacuous pass: prove the metrics section itself
    // actually rendered before asserting the tiles' absence.
    await waitFor(() => {
      expect(screen.getByText('Total de Registros')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('results-metric-skipped')).toBeNull();
    expect(screen.queryByTestId('results-metric-duplicates')).toBeNull();
  });

  // Gate-guard, NOT coverage of a live path. ResultsPage.tsx:121 filters the
  // job list to `dataType === 'results'`, and
  // `git grep -nE "skipped|duplicates" -- api/backend/src/workers/workers/result-worker.js`
  // returned no matches -- result-worker.js's accumulator/return object never
  // mentions either field in any of its branches. So no job this view can
  // currently display reaches the present branch below. These two tests only
  // pin that the `!== undefined` gate still renders a real value (including
  // a genuine zero) when the fields ARE present, guarding against a future
  // simplification of the gate into a truthiness check -- they are not proof
  // that a live job takes this path today.
  it('renders a genuine measured zero for both tiles when the fields are present', async () => {
    mockReport({ skippedRecords: 0, duplicatesFound: 0 });
    renderPage();
    await openReport();

    await waitFor(() => {
      expect(screen.getByTestId('results-metric-skipped')).toBeInTheDocument();
    });
    expect(screen.getByTestId('results-metric-skipped')).toHaveTextContent('0');
    expect(screen.getByTestId('results-metric-duplicates')).toHaveTextContent('0');
  });

  it('renders a non-zero measured value for both tiles', async () => {
    mockReport({ skippedRecords: 7, duplicatesFound: 3 });
    renderPage();
    await openReport();

    await waitFor(() => {
      expect(screen.getByTestId('results-metric-skipped')).toBeInTheDocument();
    });
    expect(screen.getByTestId('results-metric-skipped')).toHaveTextContent('7');
    expect(screen.getByTestId('results-metric-duplicates')).toHaveTextContent('3');
  });
});
