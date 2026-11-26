import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SamplesStorageSection from './SamplesStorageSection';

vi.mock('../SampleLocator', () => ({
  SampleLocator: () => <div data-testid="sample-locator">locator</div>,
}));

describe('SamplesStorageSection', () => {
  it('renders one title, the guidance card and the locator panel', () => {
    render(<SamplesStorageSection />);

    expect(screen.getByTestId('samples-storage-section')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Localização física de amostras' })).toBeInTheDocument();
    expect(screen.queryByText(/^Armazenagem Física$/)).not.toBeInTheDocument();
    expect(screen.getByText('Escolha a caixa, o sistema define a posição')).toBeInTheDocument();
    expect(screen.getByText(/sem segunda busca/i)).toBeInTheDocument();
    expect(screen.getByTestId('samples-storage-locator-panel')).toContainElement(screen.getByTestId('sample-locator'));
  });
});
