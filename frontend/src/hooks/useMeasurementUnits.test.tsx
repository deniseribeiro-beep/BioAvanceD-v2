import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { useMeasurementUnits } from './useMeasurementUnits';
import { measurementUnitService } from '../services/api';

// #898: master-data.routes.js's POST /measurement-units returns
// { success, data } (master-data.routes.js:97) and PUT
// /measurement-units/:id returns { success, data } (master-data.routes.js:125).
// useMeasurementUnits used to write the raw axios envelope into `units`
// state instead of the entity.
vi.mock('../services/api', () => ({
  measurementUnitService: {
    getAll: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

const baseUnit = {
  unitID: 1,
  description: 'Existing unit',
};

function MeasurementUnitsHarness() {
  const { units, createUnit, updateUnit } = useMeasurementUnits();
  const [result, setResult] = useState<unknown>(null);

  return (
    <div>
      <div data-testid="units">{JSON.stringify(units)}</div>
      <div data-testid="result">{JSON.stringify(result)}</div>
      <button
        onClick={async () => {
          const r = await createUnit({ description: 'New unit' } as any);
          setResult(r);
        }}
      >
        create
      </button>
      <button
        onClick={async () => {
          const r = await updateUnit(1, { description: 'Updated unit' } as any);
          setResult(r);
        }}
      >
        update
      </button>
    </div>
  );
}

describe('useMeasurementUnits mutations (#898)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createUnit pushes the unwrapped entity, not the {success,data} envelope', async () => {
    vi.mocked(measurementUnitService.getAll).mockResolvedValue({ data: { success: true, data: [baseUnit] }, status: 200 } as any);
    vi.mocked(measurementUnitService.create).mockResolvedValue({
      data: { success: true, data: { unitID: 2, description: 'New unit' } },
      status: 201,
    } as any);

    render(<MeasurementUnitsHarness />);
    await waitFor(() => expect(screen.getByTestId('units')).toHaveTextContent('Existing unit'));

    const user = userEvent.setup();
    await user.click(screen.getByText('create'));

    await waitFor(() => {
      const units = JSON.parse(screen.getByTestId('units').textContent || '[]');
      expect(units).toHaveLength(2);
      expect(units[1]).toMatchObject({ unitID: 2, description: 'New unit' });
      expect(units[1].success).toBeUndefined();
    });
  });

  it('updateUnit pushes the unwrapped entity, not the {success,data} envelope', async () => {
    vi.mocked(measurementUnitService.getAll).mockResolvedValue({ data: { success: true, data: [baseUnit] }, status: 200 } as any);
    vi.mocked(measurementUnitService.update).mockResolvedValue({
      data: { success: true, data: { unitID: 1, description: 'Updated unit' } },
      status: 200,
    } as any);

    render(<MeasurementUnitsHarness />);
    await waitFor(() => expect(screen.getByTestId('units')).toHaveTextContent('Existing unit'));

    const user = userEvent.setup();
    await user.click(screen.getByText('update'));

    await waitFor(() => {
      const units = JSON.parse(screen.getByTestId('units').textContent || '[]');
      expect(units).toHaveLength(1);
      expect(units[0]).toMatchObject({ unitID: 1, description: 'Updated unit' });
      expect(units[0].success).toBeUndefined();
    });
  });
});
