import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import InlineStorageMovementPanel from '@/components/samples/InlineStorageMovementPanel';
import type { SampleWithId } from '@/hooks/samples/useSamplesPage';

// #1337: the inline storage panel of the samples list as an operator uses it --
// the sample's current location, the freezer list and tree it loads, the
// shelf > rack > box cascade, the automatic or specific position, and the
// allocate, move and auto-assign calls with their success and error outcomes.
const mocks = vi.hoisted(() => ({
  getSampleLocation: vi.fn(),
  listFreezers: vi.fn(),
  getFreezerTree: vi.fn(),
  allocateSample: vi.fn(),
  autoAssignSampleToBox: vi.fn(),
  moveSample: vi.fn(),
  notifyApiToast: vi.fn(),
}));

vi.mock('@/services/storageApi', () => ({
  storageApi: {
    getSampleLocation: (...args: unknown[]) => mocks.getSampleLocation(...args),
    listFreezers: (...args: unknown[]) => mocks.listFreezers(...args),
    getFreezerTree: (...args: unknown[]) => mocks.getFreezerTree(...args),
    allocateSample: (...args: unknown[]) => mocks.allocateSample(...args),
    autoAssignSampleToBox: (...args: unknown[]) => mocks.autoAssignSampleToBox(...args),
    moveSample: (...args: unknown[]) => mocks.moveSample(...args),
  },
}));

vi.mock('@/api/client', () => ({
  notifyApiToast: (...args: unknown[]) => mocks.notifyApiToast(...args),
}));

// A stable identity: `t` is a dependency of the load effects, so a new
// function per render would reload the freezers on every render.
const t = (key: string) => key;

const SAMPLE = { id: 'S-1', barcode: 'BR-2026-001', participantId: 'P-1', sampleType: 'Sangue' } as SampleWithId;

const TREE = {
  freezerName: 'Freezer A',
  shelves: [
    {
      shelfName: 'Prateleira 1',
      racks: [
        {
          rackName: 'Rack 1',
          boxes: [
            { boxId: 'B-1', boxName: 'Caixa 1', stats: { occupancyPercent: 40 } },
            { boxId: 'B-2' },
          ],
        },
        {},
      ],
    },
    {},
  ],
};

function renderPanel(overrides: Partial<Parameters<typeof InlineStorageMovementPanel>[0]> = {}) {
  const props = { sample: SAMPLE, t, onCancel: vi.fn(), onCompleted: vi.fn(), ...overrides };
  const view = render(<InlineStorageMovementPanel {...props} />);
  return { props, ...view };
}

async function pickBox(boxId = 'B-1') {
  await screen.findByLabelText('samples.storageInline.shelf');
  fireEvent.change(screen.getByLabelText('samples.storageInline.shelf'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('samples.storageInline.rack'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('samples.storageInline.box'), { target: { value: boxId } });
}

function confirmButton() {
  return screen.getByRole('button', { name: 'samples.storageInline.confirm' });
}

function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('InlineStorageMovementPanel', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
    mocks.getSampleLocation.mockResolvedValue({ success: false });
    mocks.listFreezers.mockResolvedValue({
      success: true,
      data: [{ _id: 'F-1', freezerName: 'Freezer A' }, { _id: 'F-2', name: 'Freezer B' }, { _id: 'F-3' }],
    });
    mocks.getFreezerTree.mockResolvedValue({ success: true, data: TREE });
  });

  it('shows the loading freezer option and the sample summary with its fallbacks', async () => {
    const list = deferred<unknown>();
    mocks.listFreezers.mockReturnValue(list.promise);
    renderPanel({ sample: { id: 'S-9', specimenId: 'SP-9' } as SampleWithId });
    expect(screen.getByRole('heading', { name: 'SP-9' })).toBeInTheDocument();
    expect(screen.getByText('samples.participantIdColumn: N/A')).toBeInTheDocument();
    expect(screen.getByText('samples.tableHeaders.type: N/A')).toBeInTheDocument();
    expect(screen.getByText('samples.storageInline.destination: samples.storageInline.selectDestination')).toBeInTheDocument();
    expect(screen.getByLabelText('samples.storageInline.freezer')).toBeDisabled();
    expect(screen.getByRole('option', { name: 'common.loading' })).toBeInTheDocument();
    expect(mocks.getSampleLocation).toHaveBeenCalledWith('S-9');
    list.resolve({ success: true, data: [] });
    expect(await screen.findByRole('option', { name: 'samples.storageInline.selectFreezer' })).toBeInTheDocument();
  });

  it('falls back to the sample id when it has no barcode or specimen id', async () => {
    renderPanel({ sample: { id: 'S-7' } as SampleWithId });
    expect(screen.getByRole('heading', { name: 'S-7' })).toBeInTheDocument();
    await screen.findByLabelText('samples.storageInline.shelf');
  });

  it('loads the freezers, selects the first one and shows its tree', async () => {
    renderPanel();
    expect(screen.getByRole('heading', { name: 'BR-2026-001' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.getFreezerTree).toHaveBeenCalledWith('F-1'));
    expect(screen.getByLabelText('samples.storageInline.freezer')).toHaveValue('F-1');
    expect(screen.getByRole('option', { name: 'Freezer B' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'F-3' })).toBeInTheDocument();
    await screen.findByLabelText('samples.storageInline.shelf');
    // An unnamed shelf takes the numbered fallback label.
    expect(screen.getByRole('option', { name: 'samples.storageInline.shelf 2' })).toBeInTheDocument();
    expect(screen.getByLabelText('samples.storageInline.rack')).toBeDisabled();
    expect(screen.getByLabelText('samples.storageInline.box')).toBeDisabled();
    expect(screen.getByText(/samples\.storageInline\.destination: Freezer A$/)).toBeInTheDocument();
    expect(screen.getByText(/preenchida automaticamente/)).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
  });

  it('shows the tree loading state, then reloads the tree when another freezer is picked', async () => {
    const tree = deferred<unknown>();
    mocks.getFreezerTree.mockReturnValueOnce(tree.promise);
    renderPanel();
    expect(await screen.findByText('samples.storageInline.loadingTree')).toBeInTheDocument();
    tree.resolve({ success: true, data: TREE });
    await pickBox();
    fireEvent.change(screen.getByLabelText('samples.storageInline.freezer'), { target: { value: 'F-2' } });
    await waitFor(() => expect(mocks.getFreezerTree).toHaveBeenCalledWith('F-2'));
    // The new tree starts with no shelf picked.
    expect(await screen.findByLabelText('samples.storageInline.shelf')).toHaveValue('');
  });

  it('loads no tree when the freezer list is empty', async () => {
    mocks.listFreezers.mockResolvedValue({ success: true, data: [] });
    renderPanel();
    expect(await screen.findByRole('option', { name: 'samples.storageInline.selectFreezer' })).toBeInTheDocument();
    expect(mocks.getFreezerTree).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('samples.storageInline.shelf')).not.toBeInTheDocument();
  });

  it('keeps the picked freezer when the sample changes and the list reloads', async () => {
    const { rerender, props } = renderPanel();
    await screen.findByLabelText('samples.storageInline.shelf');
    fireEvent.change(screen.getByLabelText('samples.storageInline.freezer'), { target: { value: 'F-2' } });
    await waitFor(() => expect(mocks.getFreezerTree).toHaveBeenCalledWith('F-2'));
    rerender(<InlineStorageMovementPanel {...props} sample={{ ...SAMPLE, id: 'S-2' }} />);
    await waitFor(() => expect(mocks.listFreezers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.getSampleLocation).toHaveBeenCalledWith('S-2'));
    expect(screen.getByLabelText('samples.storageInline.freezer')).toHaveValue('F-2');
  });

  it('shows the API error when the freezer list is refused', async () => {
    mocks.listFreezers.mockResolvedValue({ success: false, error: 'Sem permissão' });
    renderPanel();
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem permissão');
    expect(mocks.getFreezerTree).not.toHaveBeenCalled();
  });

  it('falls back to the load error when the refusal names none, the data is no list, or the request throws', async () => {
    mocks.listFreezers.mockResolvedValueOnce({ success: false });
    const first = renderPanel();
    expect(await screen.findByRole('alert')).toHaveTextContent('samples.storageInline.loadError');
    first.unmount();

    mocks.listFreezers.mockResolvedValueOnce({ success: true, data: { _id: 'F-1' } });
    const second = renderPanel();
    expect(await screen.findByRole('alert')).toHaveTextContent('samples.storageInline.loadError');
    second.unmount();

    mocks.listFreezers.mockRejectedValueOnce(new Error('network'));
    renderPanel();
    expect(await screen.findByRole('alert')).toHaveTextContent('samples.storageInline.loadError');
  });

  it('shows the tree error: the refusal message, the fallback, or the fallback on a throw', async () => {
    mocks.getFreezerTree.mockResolvedValueOnce({ success: false, error: 'Freezer inativo' });
    const first = renderPanel();
    expect(await screen.findByRole('alert')).toHaveTextContent('Freezer inativo');
    first.unmount();

    mocks.getFreezerTree.mockResolvedValueOnce({ success: false });
    const second = renderPanel();
    expect(await screen.findByRole('alert')).toHaveTextContent('samples.storageInline.treeLoadError');
    second.unmount();

    mocks.getFreezerTree.mockRejectedValueOnce(new Error('network'));
    renderPanel();
    expect(await screen.findByRole('alert')).toHaveTextContent('samples.storageInline.treeLoadError');
    expect(confirmButton()).toBeDisabled();
  });

  it('walks shelf, rack and box with their labels and the destination path', async () => {
    renderPanel();
    await screen.findByLabelText('samples.storageInline.shelf');
    fireEvent.change(screen.getByLabelText('samples.storageInline.shelf'), { target: { value: '0' } });
    expect(screen.getByRole('option', { name: 'samples.storageInline.rack 2' })).toBeInTheDocument();
    expect(screen.getByText(/destination: Freezer A > Prateleira 1$/)).toBeInTheDocument();
    // A rack with no boxes leaves only the placeholder box option.
    fireEvent.change(screen.getByLabelText('samples.storageInline.rack'), { target: { value: '1' } });
    expect(screen.getByLabelText('samples.storageInline.box')).toBeEnabled();
    expect(screen.getAllByRole('option', { name: 'samples.storageInline.selectBox' })).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('samples.storageInline.rack'), { target: { value: '0' } });
    expect(screen.getByRole('option', { name: 'Caixa 1 - 40%' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'samples.storageInline.box - 0%' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('samples.storageInline.box'), { target: { value: 'B-2' } });
    // An unnamed box shows its id in the path.
    expect(screen.getByText(/destination: Freezer A > Prateleira 1 > Rack 1 > B-2$/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('samples.storageInline.box'), { target: { value: 'B-1' } });
    expect(screen.getByText(/destination: Freezer A > Prateleira 1 > Rack 1 > Caixa 1$/)).toBeInTheDocument();
    expect(confirmButton()).toBeEnabled();
    // A new rack clears the box, and a new shelf clears rack and box.
    fireEvent.change(screen.getByLabelText('samples.storageInline.rack'), { target: { value: '1' } });
    expect(screen.getByLabelText('samples.storageInline.box')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('samples.storageInline.shelf'), { target: { value: '' } });
    expect(screen.getByLabelText('samples.storageInline.rack')).toBeDisabled();
    expect(confirmButton()).toBeDisabled();
  });

  it('auto-assigns the sample to the box and names the assigned position', async () => {
    const { props } = renderPanel();
    mocks.autoAssignSampleToBox.mockResolvedValue({ success: true, data: { position: 'C3' } });
    await pickBox();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(props.onCompleted).toHaveBeenCalledTimes(1));
    expect(mocks.autoAssignSampleToBox).toHaveBeenCalledWith('S-1', 'B-1');
    expect(mocks.allocateSample).not.toHaveBeenCalled();
    expect(mocks.notifyApiToast).toHaveBeenCalledWith({
      message: 'Sucesso! Amostra alocada automaticamente na Posição C3',
      type: 'success',
      duration: 4500,
    });
  });

  it('reads the assigned position from sampleLocation, or falls back to the success message', async () => {
    mocks.autoAssignSampleToBox.mockResolvedValueOnce({ success: true, sampleLocation: { position: 'D4' } });
    const first = renderPanel();
    await pickBox();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(first.props.onCompleted).toHaveBeenCalledTimes(1));
    expect(mocks.notifyApiToast).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: 'Sucesso! Amostra alocada automaticamente na Posição D4' }),
    );
    first.unmount();

    mocks.autoAssignSampleToBox.mockResolvedValueOnce({ success: true });
    const second = renderPanel();
    await pickBox();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(second.props.onCompleted).toHaveBeenCalledTimes(1));
    expect(mocks.notifyApiToast).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: 'samples.storageInline.success', type: 'success' }),
    );
  });

  it('allocates an unstored sample to a specific position, upper-cased and trimmed', async () => {
    const { props } = renderPanel();
    mocks.allocateSample.mockResolvedValue({ success: true });
    await pickBox();
    fireEvent.click(screen.getByRole('checkbox', { name: 'samples.storageInline.specifyPosition' }));
    const position = screen.getByLabelText('samples.storageInline.targetPosition');
    // An empty position shows no error yet but keeps confirm disabled.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
    fireEvent.change(position, { target: { value: 'ZZ' } });
    expect(screen.getByRole('alert')).toHaveTextContent('samples.storageInline.invalidPosition');
    expect(confirmButton()).toBeDisabled();
    fireEvent.change(position, { target: { value: ' b12 ' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(props.onCompleted).toHaveBeenCalledTimes(1));
    expect(mocks.allocateSample).toHaveBeenCalledWith('S-1', 'B-1', 'B12');
    expect(mocks.moveSample).not.toHaveBeenCalled();
  });

  it('clears the typed position when the specific-position toggle is turned off and on', async () => {
    renderPanel();
    await pickBox();
    const toggle = screen.getByRole('checkbox', { name: 'samples.storageInline.specifyPosition' });
    fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText('samples.storageInline.targetPosition'), { target: { value: 'A1' } });
    fireEvent.click(toggle);
    expect(screen.queryByLabelText('samples.storageInline.targetPosition')).not.toBeInTheDocument();
    expect(screen.getByText(/preenchida automaticamente/)).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByLabelText('samples.storageInline.targetPosition')).toHaveValue('');
  });

  it('moves an already stored sample to the specific position', async () => {
    mocks.getSampleLocation.mockResolvedValue({ success: true, data: { box: { boxId: 'B-9', position: 'A1' } } });
    const { props } = renderPanel();
    mocks.moveSample.mockResolvedValue({ success: true, data: { position: 'A2' } });
    await waitFor(() => expect(mocks.getSampleLocation).toHaveBeenCalledWith('S-1'));
    await pickBox();
    fireEvent.click(screen.getByRole('checkbox', { name: 'samples.storageInline.specifyPosition' }));
    fireEvent.change(screen.getByLabelText('samples.storageInline.targetPosition'), { target: { value: 'a2' } });
    fireEvent.click(confirmButton());
    await waitFor(() => expect(props.onCompleted).toHaveBeenCalledTimes(1));
    expect(mocks.moveSample).toHaveBeenCalledWith('S-1', 'B-1', 'A2');
    expect(mocks.allocateSample).not.toHaveBeenCalled();
  });

  it('allocates rather than moves when the stored location has no position', async () => {
    mocks.getSampleLocation.mockResolvedValue({ success: true, data: { box: { boxId: 'B-9' } } });
    renderPanel();
    mocks.allocateSample.mockResolvedValue({ success: true });
    await waitFor(() => expect(mocks.getSampleLocation).toHaveBeenCalled());
    await pickBox();
    fireEvent.click(screen.getByRole('checkbox', { name: 'samples.storageInline.specifyPosition' }));
    fireEvent.change(screen.getByLabelText('samples.storageInline.targetPosition'), { target: { value: 'A2' } });
    fireEvent.click(confirmButton());
    await waitFor(() => expect(mocks.allocateSample).toHaveBeenCalledWith('S-1', 'B-1', 'A2'));
    expect(mocks.moveSample).not.toHaveBeenCalled();
  });

  it('shows the refusal message, then the refusal error, then the fallback', async () => {
    for (const [response, expected] of [
      [{ success: false, message: 'Caixa cheia', error: 'BOX_FULL' }, 'Caixa cheia'],
      [{ success: false, error: 'BOX_FULL' }, 'BOX_FULL'],
      [{ success: false }, 'samples.storageInline.allocateError'],
    ] as const) {
      mocks.autoAssignSampleToBox.mockResolvedValueOnce(response);
      const view = renderPanel();
      await pickBox();
      fireEvent.click(confirmButton());
      expect(await screen.findByRole('alert')).toHaveTextContent(expected);
      expect(mocks.notifyApiToast).toHaveBeenLastCalledWith({ message: expected, type: 'error', duration: 4500 });
      expect(view.props.onCompleted).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it('shows the processing state while saving, then the allocate error when the call throws', async () => {
    const save = deferred<unknown>();
    mocks.autoAssignSampleToBox.mockReturnValue(save.promise);
    const { props } = renderPanel();
    await pickBox();
    fireEvent.click(confirmButton());
    expect(await screen.findByRole('button', { name: 'samples.storageInline.processing' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'common.cancel' })).toBeDisabled();
    save.reject(new Error('network'));
    expect(await screen.findByRole('alert')).toHaveTextContent('samples.storageInline.allocateError');
    expect(mocks.notifyApiToast).toHaveBeenCalledWith({
      message: 'samples.storageInline.allocateError',
      type: 'error',
      duration: 4500,
    });
    expect(screen.getByRole('button', { name: 'common.cancel' })).toBeEnabled();
    expect(props.onCompleted).not.toHaveBeenCalled();
  });

  it('keeps the destination fields after a refused or failed confirm, so the operator can change the box and confirm again (#1435)', async () => {
    mocks.autoAssignSampleToBox
      .mockResolvedValueOnce({ success: false, message: 'Caixa cheia' })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ success: true, data: { position: 'C3' } });
    const { props } = renderPanel();
    await pickBox('B-1');
    fireEvent.click(confirmButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Caixa cheia');
    // The refusal leaves the shelf, rack and box fields in place, still holding the pick.
    expect(screen.getByLabelText('samples.storageInline.box')).toHaveValue('B-1');
    fireEvent.change(screen.getByLabelText('samples.storageInline.box'), { target: { value: 'B-2' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(confirmButton()).toBeEnabled();
    fireEvent.click(confirmButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('samples.storageInline.allocateError');
    expect(screen.getByLabelText('samples.storageInline.box')).toHaveValue('B-2');
    // A retry on the same position is open too, without leaving the freezer.
    expect(confirmButton()).toBeEnabled();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(props.onCompleted).toHaveBeenCalledTimes(1));
    expect(mocks.autoAssignSampleToBox.mock.calls).toEqual([
      ['S-1', 'B-1'],
      ['S-1', 'B-2'],
      ['S-1', 'B-2'],
    ]);
    expect(mocks.getFreezerTree).toHaveBeenCalledTimes(1);
  });

  it('cancels through the cancel button', async () => {
    const { props } = renderPanel();
    await screen.findByLabelText('samples.storageInline.shelf');
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('ignores responses that arrive after it unmounts', async () => {
    const location = deferred<unknown>();
    const list = deferred<unknown>();
    mocks.getSampleLocation.mockReturnValue(location.promise);
    mocks.listFreezers.mockReturnValue(list.promise);
    const first = renderPanel();
    first.unmount();
    location.resolve({ success: true, data: { box: { boxId: 'B-9', position: 'A1' } } });
    list.resolve({ success: true, data: [{ _id: 'F-1' }] });
    await Promise.resolve();

    const failing = deferred<unknown>();
    mocks.listFreezers.mockReturnValue(failing.promise);
    const second = renderPanel();
    second.unmount();
    failing.reject(new Error('network'));

    mocks.listFreezers.mockResolvedValue({ success: true, data: [{ _id: 'F-1' }] });
    const tree = deferred<unknown>();
    mocks.getFreezerTree.mockReturnValue(tree.promise);
    const third = renderPanel();
    await waitFor(() => expect(mocks.getFreezerTree).toHaveBeenCalledWith('F-1'));
    third.unmount();
    tree.resolve({ success: true, data: TREE });

    const failingTree = deferred<unknown>();
    mocks.getFreezerTree.mockReturnValue(failingTree.promise);
    const fourth = renderPanel();
    await waitFor(() => expect(mocks.getFreezerTree).toHaveBeenCalledTimes(2));
    fourth.unmount();
    failingTree.reject(new Error('network'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.notifyApiToast).not.toHaveBeenCalled();
  });
});
