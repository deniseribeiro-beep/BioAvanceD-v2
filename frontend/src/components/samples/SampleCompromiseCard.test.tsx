import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const getGraphStatus = vi.fn();
vi.mock('../../services/api', () => ({
  sampleService: { getGraphStatus: (...args: unknown[]) => getGraphStatus(...args) },
}));

import SampleCompromiseCard from './SampleCompromiseCard';

const t = (_key: string, fallback?: string) => fallback || _key;

const status = (overrides: Record<string, unknown> = {}) => ({
  data: {
    success: true,
    data: {
      sampleId: 'oid-1',
      projected: true,
      status: null,
      compromisedAt: null,
      compromiseFreezerKey: null,
      compromiseBreachedSince: null,
      ...overrides,
    },
  },
});

const graphStatus = () => screen.getByTestId('sample-graph-status');

// #1559: GET /samples/:id/graph-status projects a freezer breach onto the
// sample; the card names the freezer and the times of the breach.
describe('SampleCompromiseCard', () => {
  beforeEach(() => {
    getGraphStatus.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the freezer and since-time of a compromised sample', async () => {
    const breachedSince = '2026-11-10T08:00:00.000Z';
    const compromisedAt = '2026-11-10T09:30:00.000Z';
    getGraphStatus.mockResolvedValue(status({
      status: 'COMPROMISED',
      compromiseFreezerKey: 'SENSOR-A',
      compromiseBreachedSince: breachedSince,
      compromisedAt,
    }));
    render(<SampleCompromiseCard sampleId="oid-1" t={t} locale="en-US" />);
    await waitFor(() => expect(graphStatus()).toHaveAttribute('data-state', 'compromised'));
    expect(graphStatus()).toHaveTextContent('Cadeia de frio comprometida');
    expect(screen.getByTestId('sample-compromise-freezer')).toHaveTextContent('SENSOR-A');
    expect(screen.getByTestId('sample-compromise-breached-since')).toHaveTextContent(new Date(breachedSince).toLocaleString('en-US'));
    expect(screen.getByTestId('sample-compromise-marked-at')).toHaveTextContent(new Date(compromisedAt).toLocaleString('en-US'));
  });

  it('shows no compromise for a clear projected status', async () => {
    getGraphStatus.mockResolvedValue(status({ status: 'AVAILABLE' }));
    render(<SampleCompromiseCard sampleId="oid-1" t={t} locale="pt-BR" />);
    await waitFor(() => expect(graphStatus()).toHaveAttribute('data-state', 'clear'));
    expect(screen.queryByTestId('sample-compromise-freezer')).not.toBeInTheDocument();
    expect(graphStatus()).toBeEmptyDOMElement();
  });

  it('shows unavailable when the graph read fails', async () => {
    getGraphStatus.mockRejectedValue(new Error('503'));
    render(<SampleCompromiseCard sampleId="oid-1" t={t} locale="pt-BR" />);
    await waitFor(() => expect(graphStatus()).toHaveAttribute('data-state', 'unavailable'));
    expect(graphStatus()).toHaveTextContent('Estado projetado indisponível.');
    expect(screen.queryByTestId('sample-compromise-freezer')).not.toBeInTheDocument();
  });

  it('shows unavailable for a graph status body without data', async () => {
    getGraphStatus.mockResolvedValue({ data: { success: true } });
    render(<SampleCompromiseCard sampleId="oid-1" t={t} locale="pt-BR" />);
    await waitFor(() => expect(graphStatus()).toHaveAttribute('data-state', 'unavailable'));
    expect(graphStatus()).toHaveTextContent('Estado projetado indisponível.');
  });

  it('asks for the graph status of the given sample id', async () => {
    getGraphStatus.mockResolvedValue(status());
    const { rerender } = render(<SampleCompromiseCard sampleId="oid-1" t={t} locale="pt-BR" />);
    await waitFor(() => expect(graphStatus()).not.toHaveAttribute('data-state', 'loading'));
    expect(getGraphStatus).toHaveBeenCalledTimes(1);
    expect(getGraphStatus).toHaveBeenCalledWith('oid-1');

    rerender(<SampleCompromiseCard sampleId="oid-2" t={t} locale="pt-BR" />);
    await waitFor(() => expect(getGraphStatus).toHaveBeenCalledTimes(2));
    expect(getGraphStatus).toHaveBeenLastCalledWith('oid-2');
  });
});
