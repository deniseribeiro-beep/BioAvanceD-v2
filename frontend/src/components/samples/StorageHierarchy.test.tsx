import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import StorageHierarchy from '@/components/samples/StorageHierarchy';
import type { SampleWithId } from '@/hooks/samples/useSamplesPage';

// #1337: the storage-allocation modal as an operator uses it -- the freezer
// list and tree it loads, the shelf > rack > box > position cascade, the
// destination it shows, and the allocation call with its success and error
// outcomes.
const mocks = vi.hoisted(() => ({
  listFreezers: vi.fn(),
  getFreezerTree: vi.fn(),
  getAvailablePositions: vi.fn(),
  allocateSample: vi.fn(),
  notifyApiToast: vi.fn(),
}));

vi.mock('@/services/storageApi', () => ({
  storageApi: {
    listFreezers: (...args: unknown[]) => mocks.listFreezers(...args),
    getFreezerTree: (...args: unknown[]) => mocks.getFreezerTree(...args),
    getAvailablePositions: (...args: unknown[]) => mocks.getAvailablePositions(...args),
    allocateSample: (...args: unknown[]) => mocks.allocateSample(...args),
  },
}));

vi.mock('@/api/client', () => ({
  notifyApiToast: (...args: unknown[]) => mocks.notifyApiToast(...args),
}));

// A stable identity: `t` is a dependency of the component's load effects, so
// a new function per render would reload the freezers on every render.
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

function renderModal(overrides: Partial<Parameters<typeof StorageHierarchy>[0]> = {}) {
  const props = { isOpen: true, sample: SAMPLE, t, onClose: vi.fn(), onCompleted: vi.fn(), ...overrides };
  render(<StorageHierarchy {...props} />);
  return props;
}

async function pickBox() {
  await screen.findByLabelText('samples.storageInline.shelf');
  fireEvent.change(screen.getByLabelText('samples.storageInline.shelf'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('samples.storageInline.rack'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('samples.storageInline.box'), { target: { value: 'B-1' } });
}

describe('StorageHierarchy', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
    // The Modal restores the scroll position on unmount; jsdom has no scrollTo.
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    mocks.listFreezers.mockResolvedValue({
      success: true,
      data: [{ _id: 'F-1', freezerName: 'Freezer A' }, { _id: 'F-2', name: 'Freezer B' }, { _id: 'F-3' }],
    });
    mocks.getFreezerTree.mockResolvedValue({ success: true, data: TREE });
    mocks.getAvailablePositions.mockResolvedValue({ success: true, data: { availablePositions: ['A1', 'A2'] } });
  });

  it('renders nothing and loads nothing while closed', () => {
    const { container } = render(
      <StorageHierarchy isOpen={false} sample={SAMPLE} t={t} onClose={vi.fn()} onCompleted={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(mocks.listFreezers).not.toHaveBeenCalled();
  });

  it('loads the freezers, selects the first one and shows its tree', async () => {
    renderModal();
    expect(screen.getByText('BR-2026-001')).toBeInTheDocument();
    await waitFor(() => expect(mocks.getFreezerTree).toHaveBeenCalledWith('F-1'));
    const freezer = await screen.findByLabelText('samples.storageInline.freezer');
    expect(freezer).toHaveValue('F-1');
    expect(screen.getByRole('option', { name: 'Freezer B' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'F-3' })).toBeInTheDocument();
    // An unnamed shelf takes the numbered fallback label.
    expect(screen.getByRole('option', { name: 'samples.storageInline.shelf 2' })).toBeInTheDocument();
    expect(screen.getByLabelText('samples.storageInline.rack')).toBeDisabled();
    expect(screen.getByLabelText('samples.storageInline.box')).toBeDisabled();
    expect(screen.getByText(/samples\.storageInline\.destination: Freezer A$/)).toBeInTheDocument();
  });

  it('reloads the tree when another freezer is picked', async () => {
    renderModal();
    const freezer = await screen.findByLabelText('samples.storageInline.freezer');
    fireEvent.change(freezer, { target: { value: 'F-2' } });
    await waitFor(() => expect(mocks.getFreezerTree).toHaveBeenCalledWith('F-2'));
  });

  it('walks shelf, rack, box and position, then allocates the sample', async () => {
    const props = renderModal();
    mocks.allocateSample.mockResolvedValue({ success: true });
    await pickBox();
    expect(screen.getByRole('option', { name: 'samples.storageInline.rack 2' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'samples.storageInline.box - 0%' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Caixa 1 - 40%' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.getAvailablePositions).toHaveBeenCalledWith('B-1'));
    expect(await screen.findByText('samples.storageInline.availablePositions: 2')).toBeInTheDocument();
    expect(screen.getByText(/destination: Freezer A > Prateleira 1 > Rack 1 > Caixa 1$/)).toBeInTheDocument();

    const confirm = screen.getByRole('button', { name: 'samples.storageInline.confirm' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('samples.storageInline.position'), { target: { value: 'A2' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
    expect(mocks.allocateSample).toHaveBeenCalledWith('S-1', 'B-1', 'A2');
    expect(props.onCompleted).toHaveBeenCalledTimes(1);
    expect(mocks.notifyApiToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'samples.storageInline.success', type: 'success' }),
    );
  });

  it('shows the refusal message when the allocation is refused', async () => {
    const props = renderModal();
    mocks.allocateSample.mockResolvedValue({ success: false, message: 'Posição ocupada' });
    await pickBox();
    await waitFor(() => expect(screen.getByLabelText('samples.storageInline.position')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('samples.storageInline.position'), { target: { value: 'A1' } });
    fireEvent.click(screen.getByRole('button', { name: 'samples.storageInline.confirm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Posição ocupada');
    expect(mocks.notifyApiToast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Posição ocupada', type: 'error' }));
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onCompleted).not.toHaveBeenCalled();
  });

  it('shows the allocate error when the allocation throws, and blocks closing while saving', async () => {
    const props = renderModal();
    let reject: (e: Error) => void = () => {};
    mocks.allocateSample.mockReturnValue(new Promise((_, r) => { reject = r; }));
    await pickBox();
    await waitFor(() => expect(screen.getByLabelText('samples.storageInline.position')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('samples.storageInline.position'), { target: { value: 'A1' } });
    fireEvent.click(screen.getByRole('button', { name: 'samples.storageInline.confirm' }));
    expect(await screen.findByRole('button', { name: 'samples.storageInline.processing' })).toBeDisabled();
    fireEvent.click(document.querySelector('.modal-close') as HTMLElement);
    expect(props.onClose).not.toHaveBeenCalled();
    reject(new Error('network'));
    expect(await screen.findByRole('alert')).toHaveTextContent('samples.storageInline.allocateError');
    expect(mocks.notifyApiToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('cancels through the cancel button', async () => {
    const props = renderModal();
    await screen.findByLabelText('samples.storageInline.freezer');
    fireEvent.click(screen.getByRole('button', { name: 'samples.storageInline.cancel' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves the position select disabled when the box has no free position', async () => {
    renderModal();
    mocks.getAvailablePositions.mockResolvedValue({ success: false });
    await pickBox();
    expect(await screen.findByText('samples.storageInline.availablePositions: 0')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('samples.storageInline.position')).toBeDisabled());
  });

  it('treats a failed positions request as no free position', async () => {
    renderModal();
    mocks.getAvailablePositions.mockRejectedValue(new Error('network'));
    await pickBox();
    await waitFor(() => expect(mocks.getAvailablePositions).toHaveBeenCalled());
    expect(screen.getByText('samples.storageInline.availablePositions: 0')).toBeInTheDocument();
  });

  it('shows the API error when the freezer list is refused', async () => {
    mocks.listFreezers.mockResolvedValue({ success: false, error: 'Sem permissão' });
    renderModal({ sample: null });
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem permissão');
    expect(screen.getByText('samples.sampleFallback')).toBeInTheDocument();
    expect(mocks.getFreezerTree).not.toHaveBeenCalled();
  });

  it('falls back to the load error when the refusal names none, or the request throws', async () => {
    mocks.listFreezers.mockResolvedValueOnce({ success: false });
    const first = render(<StorageHierarchy isOpen sample={SAMPLE} t={t} onClose={vi.fn()} onCompleted={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('samples.storageInline.loadError');
    first.unmount();
    mocks.listFreezers.mockRejectedValueOnce(new Error('network'));
    renderModal();
    expect(await screen.findByRole('alert')).toHaveTextContent('samples.storageInline.loadError');
  });

  it('shows the tree error when the tree is refused or the request throws', async () => {
    mocks.getFreezerTree.mockResolvedValueOnce({ success: false, error: 'Freezer inativo' });
    const first = render(<StorageHierarchy isOpen sample={SAMPLE} t={t} onClose={vi.fn()} onCompleted={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Freezer inativo');
    first.unmount();
    mocks.getFreezerTree.mockResolvedValueOnce({ success: false });
    const second = render(<StorageHierarchy isOpen sample={SAMPLE} t={t} onClose={vi.fn()} onCompleted={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('samples.storageInline.treeLoadError');
    expect(screen.getAllByText('samples.storageInline.selectFreezer').length).toBeGreaterThan(0);
    second.unmount();
    mocks.getFreezerTree.mockRejectedValueOnce(new Error('network'));
    renderModal();
    expect(await screen.findByRole('alert')).toHaveTextContent('samples.storageInline.treeLoadError');
  });

  it('falls back to the API error, then the allocate error, when a refusal names no message', async () => {
    const confirmAt = async (position: string) => {
      await pickBox();
      await waitFor(() => expect(screen.getByLabelText('samples.storageInline.position')).toBeEnabled());
      fireEvent.change(screen.getByLabelText('samples.storageInline.position'), { target: { value: position } });
      fireEvent.click(screen.getByRole('button', { name: 'samples.storageInline.confirm' }));
    };
    mocks.allocateSample.mockResolvedValueOnce({ success: false, error: 'Caixa cheia' });
    const first = render(<StorageHierarchy isOpen sample={SAMPLE} t={t} onClose={vi.fn()} onCompleted={vi.fn()} />);
    await confirmAt('A1');
    expect(await screen.findByRole('alert')).toHaveTextContent('Caixa cheia');
    first.unmount();
    mocks.allocateSample.mockResolvedValueOnce({ success: false });
    renderModal();
    await confirmAt('A2');
    expect(await screen.findByRole('alert')).toHaveTextContent('samples.storageInline.allocateError');
  });

  it('treats a box answer without a position list as no free position', async () => {
    mocks.getAvailablePositions.mockResolvedValue({ success: true, data: {} });
    renderModal();
    await pickBox();
    await waitFor(() => expect(mocks.getAvailablePositions).toHaveBeenCalledWith('B-1'));
    expect(screen.getByText('samples.storageInline.availablePositions: 0')).toBeInTheDocument();
    expect(screen.getByLabelText('samples.storageInline.position')).toBeDisabled();
  });

  it('selects no freezer and loads no tree when the freezer list is empty', async () => {
    mocks.listFreezers.mockResolvedValue({ success: true, data: [] });
    renderModal();
    await waitFor(() => expect(mocks.listFreezers).toHaveBeenCalled());
    expect((await screen.findAllByText('samples.storageInline.selectFreezer')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mocks.getFreezerTree).not.toHaveBeenCalled();
  });
});
