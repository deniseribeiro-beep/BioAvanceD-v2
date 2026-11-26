import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import FoundationApp from './FoundationApp';

// FoundationApp is mounted by App.tsx at `/next/*`, under the same router
// future flags. `/next/intake` is its own App route and ranks ahead of the
// splat, so this harness registers a stand-in for it.
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <LocationProbe />
      <Routes>
        <Route path="/next/intake" element={<div>intake wizard</div>} />
        <Route path="/next/*" element={<FoundationApp />} />
        <Route path="/patients" element={<div>patients page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function navLink(name: string) {
  const nav = screen.getByRole('navigation', { name: 'Rotas da nova fundação' });
  return within(nav).getByRole('link', { name });
}

describe('FoundationApp', () => {
  it('renders the overview at /next with the contract counts and catalog tags', async () => {
    renderAt('/next');

    expect(await screen.findByRole('heading', { name: 'Fundação limpa para migrar o legado sem ruptura' })).toBeInTheDocument();
    const metric = (label: string) => screen.getByText(label).closest('article') as HTMLElement;
    expect(within(metric('Perfis de acesso')).getByText('4')).toBeInTheDocument();
    expect(within(metric('Escopos de consentimento')).getByText('11')).toBeInTheDocument();
    expect(within(metric('Status de amostra')).getByText('6')).toBeInTheDocument();
    expect(within(metric('Tipos de armazenamento')).getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Administrador #4')).toBeInTheDocument();
    expect(screen.getByText('Usuário Externo #1')).toBeInTheDocument();
    expect(screen.getByText('Suspenso')).toBeInTheDocument();
  });

  it('marks only the overview entry active at /next and links every entry to its absolute route', async () => {
    renderAt('/next');
    await screen.findByRole('heading', { name: 'Fundação limpa para migrar o legado sem ruptura' });

    expect(navLink('Visão geral')).toHaveAttribute('href', '/next');
    expect(navLink('Visão geral')).toHaveClass('is-active');
    expect(navLink('Contratos')).toHaveAttribute('href', '/next/contracts');
    expect(navLink('Contratos')).not.toHaveClass('is-active');
    expect(navLink('Cadastro Integrado')).toHaveAttribute('href', '/next/intake');
  });

  it('keeps the sidebar links absolute on /next/contracts and marks Contratos active', async () => {
    renderAt('/next/contracts');
    await screen.findByRole('heading', { name: 'Domínio centralizado' });

    expect(navLink('Contratos')).toHaveAttribute('href', '/next/contracts');
    expect(navLink('Contratos')).toHaveClass('is-active');
    expect(navLink('Visão geral')).not.toHaveClass('is-active');
    expect(navLink('Cadastro Integrado')).toHaveAttribute('href', '/next/intake');
  });

  it('lists the contract catalog on the contracts page', async () => {
    renderAt('/next/contracts');
    await screen.findByRole('heading', { name: 'Domínio centralizado' });

    expect(screen.getByText('AccessType 4')).toBeInTheDocument();
    expect(screen.getByText('AccessType 1')).toBeInTheDocument();
    expect(screen.getByText('Bloqueado')).toBeInTheDocument();
    expect(screen.getByText('Disponível / Available')).toBeInTheDocument();
    expect(screen.getByText('Esgotada / TotallyWithdrawn')).toBeInTheDocument();
    expect(screen.getByText('Não registrada / Unknown')).toBeInTheDocument();
    expect(screen.getByText('Prateleira')).toBeInTheDocument();
    expect(screen.getByText('Desativada')).toBeInTheDocument();

    const scope = screen.getByText('Uso Comercial').closest('.foundation-scope-item') as HTMLElement;
    expect(within(scope).getByText('Uso de amostras para fins comerciais e desenvolvimento de produtos.')).toBeInTheDocument();
    expect(within(scope).getByText('high')).toHaveClass('foundation-pill--high');
  });

  it('opens the contracts page from the overview call to action', async () => {
    renderAt('/next');
    await userEvent.click(await screen.findByRole('link', { name: 'Ver contratos' }));

    expect(await screen.findByRole('heading', { name: 'Domínio centralizado' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/next/contracts');
  });

  it('redirects an unknown /next path to the overview', async () => {
    renderAt('/next/no-such-page');

    expect(await screen.findByRole('heading', { name: 'Fundação limpa para migrar o legado sem ruptura' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/next$/);
  });
});
