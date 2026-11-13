import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { useSensors } from './useSensors';
import { sensorService } from '../services/api';

vi.mock('../services/api', () => ({
  sensorService: { getAll: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
}));

const list = { data: { data: [{ _id: 's1', name: 'Sala' }] } };

function Harness() {
  const { sensors, error, createSensor, updateSensor, deleteSensor } = useSensors();
  const [result, setResult] = useState('');
  return (
    <div>
      <div data-testid="rows">{sensors.map((sensor) => sensor.name).join(',')}</div>
      <div data-testid="error">{error || ''}</div>
      <div data-testid="result">{result}</div>
      <button type="button" onClick={() => createSensor({ name: 'Novo' }).then((row) => setResult(row.name)).catch((err) => setResult(err.message))}>create</button>
      <button type="button" onClick={() => updateSensor('s1', { name: 'Editado' }).then((row) => setResult(row.name)).catch((err) => setResult(err.message))}>update</button>
      <button type="button" onClick={() => deleteSensor('s1').catch((err) => setResult(err.message))}>delete</button>
    </div>
  );
}

describe('useSensors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sensorService.getAll).mockResolvedValue(list as never);
  });

  it('loads, creates, updates and deletes a sensor', async () => {
    vi.mocked(sensorService.create).mockResolvedValue({ data: { name: 'Novo' } } as never);
    vi.mocked(sensorService.update).mockResolvedValue({ data: { data: { name: 'Editado' } } } as never);
    vi.mocked(sensorService.delete).mockResolvedValue({} as never);
    const user = userEvent.setup();
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('Sala'));
    await user.click(screen.getByText('create'));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('Novo'));
    await user.click(screen.getByText('update'));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('Editado'));
    await user.click(screen.getByText('delete'));
    await waitFor(() => expect(sensorService.delete).toHaveBeenCalledWith('s1'));
  });

  it('keeps the load error and the mutation error', async () => {
    vi.mocked(sensorService.getAll).mockRejectedValueOnce(new Error('offline'));
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('offline'));

    vi.mocked(sensorService.getAll).mockResolvedValue(list as never);
    vi.mocked(sensorService.create).mockRejectedValue({});
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByText('Sala');
    await user.click(screen.getAllByText('create')[1]);
    await waitFor(() => expect(screen.getAllByTestId('result')[1]).toHaveTextContent('Erro ao criar sensor'));
  });
});
