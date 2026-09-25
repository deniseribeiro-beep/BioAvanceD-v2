import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ReportViewPage from './ReportViewPage';

const getById = vi.fn();

vi.mock('../services/api', () => ({
  reportsService: {
    getById: (...args: unknown[]) => getById(...args),
    delete: vi.fn(),
  },
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));

function renderSavedReport(reportData: Record<string, unknown>) {
  getById.mockResolvedValue({
    data: { reportID: 7, reportType: 'samples', generatedAt: '2026-09-25T00:00:00Z', reportData: JSON.stringify(reportData) },
  });
  return render(
    <MemoryRouter initialEntries={['/reports/7']}>
      <Routes>
        <Route path="/reports/:id" element={<ReportViewPage />} />
      </Routes>
    </MemoryRouter>
  );
}

// #1213: a saved report's rows carry the canonical names the reports route's
// export catalog declares -- participantId, specimenId, registeredAt. The
// page read patientID, sampleID and registrationDate, which no model has, so
// those cells always rendered blank.
describe('ReportViewPage renders the canonical row fields', () => {
  beforeEach(() => {
    getById.mockReset();
  });

  it('#1213: the patients table shows participantId', async () => {
    renderSavedReport({ total: 1, patients: [{ participantId: 'P-REPORT-1', status: 'active' }] });

    expect(await screen.findByText('P-REPORT-1')).toBeInTheDocument();
  });

  it('#1213: the samples table shows specimenId and registeredAt', async () => {
    renderSavedReport({ total: 1, samples: [{ specimenId: 'S-REPORT-1', sampleType: 'blood', registeredAt: '2026-03-04T12:00:00Z' }] });

    expect(await screen.findByText('S-REPORT-1')).toBeInTheDocument();
    const row = screen.getByText('S-REPORT-1').closest('tr');
    expect(row?.textContent).toMatch(/2026/);
  });

  // CONTROL (#695): a column the page already read correctly renders before
  // and after the fix, so a red here is the harness, not the bug.
  it('CONTROL: the samples table shows sampleType', async () => {
    renderSavedReport({ total: 1, samples: [{ specimenId: 'S-REPORT-1', sampleType: 'plasma-control' }] });

    expect(await screen.findByText('plasma-control')).toBeInTheDocument();
  });
});
