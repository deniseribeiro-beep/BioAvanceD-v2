import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  accept: vi.fn(),
}));

vi.mock('../services/api', () => ({
  productLegalService: {
    getDocument: (...args: unknown[]) => mocks.getDocument(...args),
    accept: (...args: unknown[]) => mocks.accept(...args),
  },
}));

import LegalDocumentPage from './LegalDocumentPage';

describe('LegalDocumentPage (G13)', () => {
  beforeEach(() => {
    mocks.getDocument.mockReset();
    mocks.accept.mockReset();
  });

  it('renders document body (uppercase React components) and accepts version', async () => {
    mocks.getDocument.mockResolvedValueOnce({
      data: {
        data: {
          docType: 'terms',
          docVersion: '2.1.0',
          title: 'Termos de uso do BioAvanceD',
          body: 'Parágrafo um.\n\nParágrafo dois.',
          publishedAt: '2026-11-26T00:00:00.000Z',
        },
      },
    });
    mocks.accept.mockResolvedValueOnce({ data: { success: true } });

    render(
      <MemoryRouter initialEntries={['/legal/terms']}>
        <Routes>
          <Route path="/legal/terms" element={<LegalDocumentPage />} />
          <Route path="/dashboard" element={<p>dashboard</p>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('legal-document-body')).toBeInTheDocument();
    expect(screen.getByText('Termos de uso do BioAvanceD')).toBeInTheDocument();
    expect(screen.getByText('Parágrafo um.')).toBeInTheDocument();
    expect(screen.getByText(/é o TCLE de participante/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Aceito a versão 2\.1\.0/i }));
    await waitFor(() => expect(mocks.accept).toHaveBeenCalledWith('terms', '2.1.0'));
    expect(await screen.findByText('dashboard')).toBeInTheDocument();
  });
});
