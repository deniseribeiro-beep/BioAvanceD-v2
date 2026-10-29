import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const close = vi.fn();
vi.mock('../../services/api', () => ({
  sampleService: { close: (...args: unknown[]) => close(...args) },
}));

import CloseSpecimenAction, { canCloseSpecimen } from './CloseSpecimenAction';

const t = (_key: string, fallback?: string) => fallback || _key;

// RF026 AC7: POST /samples/:id/close closes a fully consumed specimen; it is
// offered only for quantityStatus depleted on a specimen not yet closed, is
// confirmed first, and surfaces the 409 refusal's message.
describe('canCloseSpecimen', () => {
  it('is true only for a depleted specimen that is not closed', () => {
    expect(canCloseSpecimen({ specimenStatus: 'available', quantityStatus: 'depleted' })).toBe(true);
    expect(canCloseSpecimen({ specimenStatus: 'available', initialQuantity: 10, currentQuantity: 0 })).toBe(true);
    expect(canCloseSpecimen({ specimenStatus: 'available', quantityStatus: 'partial' })).toBe(false);
    expect(canCloseSpecimen({ specimenStatus: 'available', quantityStatus: 'full' })).toBe(false);
    expect(canCloseSpecimen({ specimenStatus: 'closed', quantityStatus: 'depleted' })).toBe(false);
    expect(canCloseSpecimen(null)).toBe(false);
  });
});

describe('CloseSpecimenAction', () => {
  const depleted = { _id: 'abc', specimenId: 'SPC-1', specimenStatus: 'available', quantityStatus: 'depleted' as const };

  beforeEach(() => {
    close.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing for a partial specimen, a closed one, or a user without edit permission', () => {
    const { container, rerender } = render(
      <CloseSpecimenAction sample={{ ...depleted, quantityStatus: 'partial' }} canEdit t={t} onClosed={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<CloseSpecimenAction sample={{ ...depleted, specimenStatus: 'closed' }} canEdit t={t} onClosed={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<CloseSpecimenAction sample={depleted} canEdit={false} t={t} onClosed={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('does not call the route when the confirmation is declined', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<CloseSpecimenAction sample={depleted} canEdit t={t} onClosed={vi.fn()} />);
    fireEvent.click(screen.getByTestId('sample-detail-close-button'));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it('closes after confirmation and hands the closed result back', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const result = {
      specimenId: 'SPC-1',
      previousStatus: 'available',
      specimenStatus: 'closed',
      quantityStatus: 'depleted',
      operationalStateDecisionId: 'osd-1',
      triggerEventId: 'evt-1',
    };
    close.mockResolvedValue({ data: { success: true, data: result } });
    const onClosed = vi.fn();
    render(<CloseSpecimenAction sample={depleted} canEdit t={t} onClosed={onClosed} />);

    fireEvent.click(screen.getByTestId('sample-detail-close-button'));

    await waitFor(() => expect(onClosed).toHaveBeenCalledWith(result));
    expect(close).toHaveBeenCalledWith('abc');
    expect(screen.queryByTestId('sample-detail-close-error')).toBeNull();
  });

  it('shows the 409 SPECIMEN_CLOSE_REFUSED message and does not report a close', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    close.mockRejectedValue({
      response: { status: 409, data: { success: false, error: 'SPECIMEN_CLOSE_REFUSED', message: 'A amostra ainda possui material disponível' } },
    });
    const onClosed = vi.fn();
    render(<CloseSpecimenAction sample={depleted} canEdit t={t} onClosed={onClosed} />);

    fireEvent.click(screen.getByTestId('sample-detail-close-button'));

    expect(await screen.findByTestId('sample-detail-close-error')).toHaveTextContent('A amostra ainda possui material disponível');
    expect(onClosed).not.toHaveBeenCalled();
  });
});
