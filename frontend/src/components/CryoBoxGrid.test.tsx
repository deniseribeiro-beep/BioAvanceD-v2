import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CryoBoxGrid } from './CryoBoxGrid';

describe('CryoBoxGrid', () => {
  it('marks an allocated well and exposes the sample code on hover', () => {
    render(<CryoBoxGrid occupants={[{ position: 'a1', sampleCode: 'SPC-100' }]} />);

    const occupied = screen.getByRole('button', { name: 'Posição A1 ocupado, amostra SPC-100' });
    expect(occupied).toHaveAttribute('data-tooltip', 'SPC-100');
    expect(screen.getByRole('button', { name: 'Posição B2 livre' })).toBeInTheDocument();
  });
});
