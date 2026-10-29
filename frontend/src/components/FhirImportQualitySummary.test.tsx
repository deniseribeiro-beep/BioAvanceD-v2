import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import FhirImportQualitySummary from './FhirImportQualitySummary';
import { RCS_SCOPE_NOTICE } from './RcsScopeNotice';

// RF018 AC11 (#1320): the import quality summary shows RCS grades and an
// average RCS, and so states what the RCS is not.
describe('FhirImportQualitySummary', () => {
  it('shows the RCS scope notice beside the grade counts and the average RCS', () => {
    render(<FhirImportQualitySummary summary={{ gradeA: 2, averageRcsScore: 87.5 }} />);
    expect(screen.getByText(/RCS Médio=87.5/)).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(RCS_SCOPE_NOTICE);
  });

  it('renders nothing, and no notice, without a summary', () => {
    const { container } = render(<FhirImportQualitySummary summary={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('note')).toBeNull();
  });
});
