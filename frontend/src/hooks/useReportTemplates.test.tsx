import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { useReportTemplates } from './useReportTemplates';
import { reportTemplateService } from '../services/api';

vi.mock('../services/api', () => ({
  reportTemplateService: { getAll: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
}));

const list = { data: { data: [{ _id: 't1', name: 'Modelo' }] } };

function Harness() {
  const { reportTemplates, error, createReportTemplate, updateReportTemplate, deleteReportTemplate } = useReportTemplates();
  const [result, setResult] = useState('');
  return (
    <div>
      <div data-testid="rows">{reportTemplates.map((row) => row.name).join(',')}</div>
      <div data-testid="error">{error || ''}</div>
      <div data-testid="result">{result}</div>
      <button type="button" onClick={() => createReportTemplate({ name: 'Novo' }).then((row) => setResult(row.name)).catch((err) => setResult(err.message))}>create</button>
      <button type="button" onClick={() => updateReportTemplate('t1', { name: 'Editado' }).then((row) => setResult(row.name || 'ok')).catch((err) => setResult(err.message))}>update</button>
      <button type="button" onClick={() => deleteReportTemplate('t1').catch((err) => setResult(err.message))}>delete</button>
    </div>
  );
}

describe('useReportTemplates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reportTemplateService.getAll).mockResolvedValue(list as never);
  });

  it('loads and saves a report template', async () => {
    vi.mocked(reportTemplateService.create).mockResolvedValue({ data: { name: 'Novo' } } as never);
    vi.mocked(reportTemplateService.update).mockResolvedValue({ data: { data: { name: 'Editado' } } } as never);
    vi.mocked(reportTemplateService.delete).mockResolvedValue({} as never);
    const user = userEvent.setup();
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('Modelo'));
    await user.click(screen.getByText('create'));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('Novo'));
    await user.click(screen.getByText('update'));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('Editado'));
    await user.click(screen.getByText('delete'));
    await waitFor(() => expect(reportTemplateService.delete).toHaveBeenCalledWith('t1'));
  });

  it('joins the validation details when the template is refused', async () => {
    vi.mocked(reportTemplateService.getAll).mockRejectedValueOnce({ response: { data: { details: ['título', 'código'] } } });
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('título; código'));

    vi.mocked(reportTemplateService.getAll).mockResolvedValue(list as never);
    vi.mocked(reportTemplateService.delete).mockRejectedValue({ response: { data: { error: 'em uso' } } });
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByText('Modelo');
    await user.click(screen.getAllByText('delete')[1]);
    await waitFor(() => expect(screen.getAllByTestId('result')[1]).toHaveTextContent('em uso'));
  });
});
