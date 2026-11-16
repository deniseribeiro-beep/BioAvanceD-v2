import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SampleLineageCard from './SampleLineageCard';

const t = (_key: string, fallback?: string) => fallback || _key;

function renderCard(parentSpecimenIds: unknown) {
  return render(
    <MemoryRouter>
      <SampleLineageCard parentSpecimenIds={parentSpecimenIds} t={t} />
    </MemoryRouter>,
  );
}

// #1559: a derivative's page links each parent specimen to its own page.
describe('SampleLineageCard', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders nothing for a sample without parents', () => {
    for (const parents of [undefined, [], ['', '  '], 'SPC-0', [42, null]]) {
      const { container } = renderCard(parents);
      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByTestId('sample-lineage-card')).not.toBeInTheDocument();
      cleanup();
    }
  });

  it('links each parent to its sample page', () => {
    renderCard(['SPC-0', 'LOT 7/A']);
    expect(screen.getByTestId('sample-lineage-card')).toHaveTextContent('Linhagem');
    expect(screen.getByTestId('sample-lineage-card')).toHaveTextContent('Amostras de origem');
    const plain = screen.getByTestId('sample-lineage-parent-link-SPC-0');
    expect(plain).toHaveTextContent('SPC-0');
    expect(plain).toHaveAttribute('href', '/samples/SPC-0');
    const encoded = screen.getByTestId('sample-lineage-parent-link-LOT 7/A');
    expect(encoded).toHaveTextContent('LOT 7/A');
    expect(encoded).toHaveAttribute('href', '/samples/LOT%207%2FA');
  });
});
