import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import RcsScopeNotice, { RCS_SCOPE_NOTICE } from './RcsScopeNotice';

// RF018 AC11 (#1320): the RCS is never represented as clinical validity,
// analytical assay quality or a universal quality measure.
describe('RcsScopeNotice', () => {
  it('states that the RCS is not clinical validity, assay quality or a universal measure', () => {
    render(<RcsScopeNotice />);
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent(RCS_SCOPE_NOTICE);
    expect(note.textContent).toContain('validade clínica');
    expect(note.textContent).toContain('qualidade analítica do ensaio');
    expect(note.textContent).toContain('medida universal');
  });
});
