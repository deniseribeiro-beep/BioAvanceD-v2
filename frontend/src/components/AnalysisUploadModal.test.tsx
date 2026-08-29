import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import AnalysisUploadModal from './AnalysisUploadModal';
import { equipmentService } from '../services/api';

// #898: the backend wraps /equipment/analytical in a { success, data }
// envelope, but the component used to assume a bare array and silently
// fell back to an empty list on every real call. These mocks isolate
// loadAnalyticalEquipment's unwrapping from the modal's other data hooks.
vi.mock('../services/api', () => ({
  equipmentService: {
    getAnalytical: vi.fn(),
    getAll: vi.fn().mockResolvedValue({ data: { success: true, data: [] } }),
  },
  resultService: {
    upload: vi.fn(),
  },
}));

vi.mock('../hooks/useSamples', () => ({
  useSamples: () => ({ samples: [] }),
}));

vi.mock('../hooks/useAnalysisTypes', () => ({
  useAnalysisTypes: () => ({ types: [], loading: false, error: null }),
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { name: 'Test User' }, hasRole: () => false }),
}));

describe('AnalysisUploadModal — analytical equipment loading (#898)', () => {
  beforeEach(() => {
    vi.mocked(equipmentService.getAnalytical).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('populates the dropdown from the { success, data } envelope the backend actually sends', async () => {
    vi.mocked(equipmentService.getAnalytical).mockResolvedValue({
      data: {
        success: true,
        data: [{ equipmentID: 1, name: 'HPLC', serialNumber: 'SN-1', status: 'Active' }],
      },
    } as any);

    render(<AnalysisUploadModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('HPLC (SN-1)')).toBeInTheDocument();
    });
  });

  it('still supports a bare array response (backward compatibility)', async () => {
    vi.mocked(equipmentService.getAnalytical).mockResolvedValue({
      data: [{ equipmentID: 2, name: 'Centrifuge', serialNumber: 'SN-2', status: 'Active' }],
    } as any);

    render(<AnalysisUploadModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('Centrifuge (SN-2)')).toBeInTheDocument();
    });
  });

  it('does not silently populate the list for an unrecognised response shape, and logs it instead', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(equipmentService.getAnalytical).mockResolvedValue({
      data: { unexpected: 'shape' },
    } as any);

    render(<AnalysisUploadModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('Nenhum equipamento analítico disponível')).toBeInTheDocument();
    });
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
