import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
}));

vi.mock('../services/api', () => ({
  productLegalService: {
    getStatus: (...args: unknown[]) => mocks.getStatus(...args),
  },
}));

import LegalAcceptanceGate from './LegalAcceptanceGate';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="*"
          element={(
            <LegalAcceptanceGate>
              <p data-testid="gated-child">child</p>
            </LegalAcceptanceGate>
          )}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LegalAcceptanceGate (G13)', () => {
  beforeEach(() => {
    mocks.getStatus.mockReset();
  });

  it('blocks authenticated product routes when acceptance is pending', async () => {
    mocks.getStatus.mockResolvedValueOnce({
      data: {
        data: {
          pending: [{ docType: 'terms', docVersion: '2.1.0', title: 'Termos de uso do BioAvanceD' }],
          requiresAcceptance: true,
        },
      },
    });

    renderAt('/dashboard');
    expect(await screen.findByTestId('legal-acceptance-gate')).toBeInTheDocument();
    expect(screen.getByText(/Aceite pendente/i)).toBeInTheDocument();
    expect(screen.getByTestId('gated-child')).toBeInTheDocument();
  });

  it('does not exempt /patients (authenticated) from the gate', async () => {
    mocks.getStatus.mockResolvedValueOnce({
      data: {
        data: {
          pending: [{ docType: 'privacy', docVersion: '2.1.0', title: 'Política' }],
          requiresAcceptance: true,
        },
      },
    });

    renderAt('/patients');
    expect(await screen.findByTestId('legal-acceptance-gate')).toBeInTheDocument();
    expect(mocks.getStatus).toHaveBeenCalled();
  });

  it('exempts /legal/* so the user can read and accept', async () => {
    renderAt('/legal/terms');
    await waitFor(() => expect(screen.getByTestId('gated-child')).toBeInTheDocument());
    expect(screen.queryByTestId('legal-acceptance-gate')).toBeNull();
    expect(mocks.getStatus).not.toHaveBeenCalled();
  });
});
