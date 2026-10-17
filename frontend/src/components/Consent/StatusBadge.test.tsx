import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBadge, { type ConsentStatus } from './StatusBadge';

// #1383: the derived consent states RF010 AC5 sends each have their own
// label, rather than falling back to Expirado or Desconhecido.
describe('StatusBadge', () => {
  it('labels PARTIALLY_REVOKED as Revogado parcialmente', () => {
    render(<StatusBadge status="PARTIALLY_REVOKED" />);
    expect(screen.getByText('Revogado parcialmente')).toBeInTheDocument();
    expect(screen.queryByText('Expirado')).not.toBeInTheDocument();
    expect(screen.queryByText('Desconhecido')).not.toBeInTheDocument();
  });

  it('labels SUPERSEDED as Substituído', () => {
    render(<StatusBadge status="SUPERSEDED" />);
    expect(screen.getByText('Substituído')).toBeInTheDocument();
    expect(screen.queryByText('Expirado')).not.toBeInTheDocument();
    expect(screen.queryByText('Desconhecido')).not.toBeInTheDocument();
  });

  it('renders a distinct label for each consent status', () => {
    const statuses: ConsentStatus[] = [
      'GRANTED',
      'PARTIALLY_REVOKED',
      'REVOKED',
      'SUPERSEDED',
      'PENDING',
      'EXPIRED',
      'UNKNOWN'
    ];
    const labels = statuses.map((status) => {
      const { container, unmount } = render(<StatusBadge status={status} />);
      const label = container.textContent;
      unmount();
      return label;
    });
    expect(new Set(labels).size).toBe(statuses.length);
  });
});
