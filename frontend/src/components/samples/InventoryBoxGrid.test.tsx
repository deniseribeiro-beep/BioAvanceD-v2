import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Sample } from '../../types/models';
import InventoryBoxGrid, { groupAllocatedBoxes } from './InventoryBoxGrid';

const t = (key: string, fallback?: string) => fallback || key;

function allocated(fields: Partial<Sample> & { boxId: string; boxName: string; position: string }): Sample {
  return {
    specimenId: fields.specimenId,
    barcode: fields.barcode,
    resolvedStorageLocation: {
      specimenId: String(fields.specimenId || ''),
      path: fields.boxName,
      box: { boxId: fields.boxId, boxName: fields.boxName, position: fields.position },
    },
  } as Sample;
}

describe('groupAllocatedBoxes', () => {
  it('places each allocated sample on its well and keeps the specimen code', () => {
    const boxes = groupAllocatedBoxes([
      allocated({ specimenId: 'SPC-1', barcode: 'BR-1', boxId: 'box-a', boxName: 'Caixa A', position: 'A1' }),
      allocated({ specimenId: 'SPC-2', boxId: 'box-a', boxName: 'Caixa A', position: 'c3' }),
      allocated({ barcode: 'BR-9', boxId: 'box-b', boxName: 'Caixa B', position: 'B2' }),
      { specimenId: 'SPC-FREE' } as Sample,
    ]);

    expect(boxes).toEqual([
      {
        id: 'box-a',
        label: 'Caixa A',
        occupants: [
          { position: 'A1', sampleCode: 'SPC-1' },
          { position: 'C3', sampleCode: 'SPC-2' },
        ],
      },
      {
        id: 'box-b',
        label: 'Caixa B',
        occupants: [{ position: 'B2', sampleCode: 'BR-9' }],
      },
    ]);
  });
});

describe('InventoryBoxGrid', () => {
  it('shows the allocated well code and switches boxes', async () => {
    const user = userEvent.setup();
    render(
      <InventoryBoxGrid
        t={t}
        samples={[
          allocated({ specimenId: 'SPC-1', boxId: 'box-a', boxName: 'Caixa A', position: 'A1' }),
          allocated({ specimenId: 'SPC-9', boxId: 'box-b', boxName: 'Caixa B', position: 'I9' }),
        ]}
      />
    );

    expect(screen.getByRole('button', { name: 'Posição A1 ocupado, amostra SPC-1' })).toHaveAttribute('data-tooltip', 'SPC-1');
    expect(screen.queryByRole('button', { name: /SPC-9/ })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Caixa' }), 'box-b');

    expect(screen.getByRole('button', { name: 'Posição I9 ocupado, amostra SPC-9' })).toHaveAttribute('data-tooltip', 'SPC-9');
  });
});
