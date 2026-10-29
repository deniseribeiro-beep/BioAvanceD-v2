import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from './Sidebar';

// #1409 (RNF027): Firefox makes the scrollable sidebar nav a Tab stop, so the
// landmark carries an accessible name that a keyboard stop on it announces.
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (_k: string, fb?: string) => fb ?? _k, language: 'pt-BR' }),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { roleName: 'Administrador' } }),
}));

describe('Sidebar', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  it('names its navigation landmark, so a keyboard stop on it is announced (#1409)', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Sidebar />
      </MemoryRouter>
    );

    expect(screen.getByRole('navigation', { name: 'Navegação principal' })).toBeInTheDocument();
  });
});
