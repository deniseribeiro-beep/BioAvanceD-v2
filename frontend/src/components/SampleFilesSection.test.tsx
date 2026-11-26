import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// RF007: the analysis-files section of the sample details page. The hook it
// reads (useSampleFiles) is mocked, so each case sets exactly what the hook
// returns and reads what the section renders and which hook calls it makes.
const h = vi.hoisted(() => ({
  useSampleFiles: vi.fn(),
  user: null as null | { roleName?: string; accessType?: number },
  t: (k: string): string => k,
}));

vi.mock('@/hooks/useSampleFiles', () => ({
  useSampleFiles: (sampleID: string) => h.useSampleFiles(sampleID),
}));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k: string) => h.t(k), language: 'pt-BR' }),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: h.user }) }));

import SampleFilesSection from '@/components/SampleFilesSection';

type Hook = {
  files: unknown[];
  loading: boolean;
  error: string | null;
  loadFiles: ReturnType<typeof vi.fn>;
  uploadFile: ReturnType<typeof vi.fn>;
  downloadFile: ReturnType<typeof vi.fn>;
  deleteFile: ReturnType<typeof vi.fn>;
};

let hook: Hook;
function serve(over: Partial<Hook> = {}) {
  hook = {
    files: [],
    loading: false,
    error: null,
    loadFiles: vi.fn(),
    uploadFile: vi.fn().mockResolvedValue({}),
    downloadFile: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
  h.useSampleFiles.mockImplementation(() => hook);
}

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const csv = {
  _id: 'f1',
  sampleID: 'S1',
  fileName: 'run-01.csv',
  fileType: 'CSV',
  fileSize: 2048,
  uploaderAnonId: 'anon-7',
  // No zone suffix: parsed as local time, so the rendered text does not depend on TZ.
  uploadDate: '2026-03-04T05:06:00',
};

function fileOf(name: string, size: number) {
  const f = new File(['x'], name);
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

const admin = { roleName: 'Administrador' };

beforeEach(() => {
  h.useSampleFiles.mockReset();
  h.user = admin;
  h.t = (k) => k;
  serve();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SampleFilesSection loading', () => {
  it('loads once per sampleID and passes the id to the hook', () => {
    const { rerender } = render(<SampleFilesSection sampleID="S1" />);
    expect(h.useSampleFiles).toHaveBeenLastCalledWith('S1');
    expect(hook.loadFiles).toHaveBeenCalledTimes(1);
    const first = hook.loadFiles;
    rerender(<SampleFilesSection sampleID="S1" />);
    expect(first).toHaveBeenCalledTimes(1);
    serve();
    rerender(<SampleFilesSection sampleID="S2" />);
    expect(h.useSampleFiles).toHaveBeenLastCalledWith('S2');
    expect(first).toHaveBeenCalledTimes(1);
    expect(hook.loadFiles).toHaveBeenCalledTimes(1);
  });

  it('does not load for an empty sampleID', () => {
    render(<SampleFilesSection sampleID="" />);
    expect(hook.loadFiles).not.toHaveBeenCalled();
  });

  it('shows the loading text and no table while loading', () => {
    serve({ loading: true, files: [csv] });
    render(<SampleFilesSection sampleID="S1" />);
    expect(screen.getByText('common.loading')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows the hook error and the empty state', () => {
    serve({ error: 'listing failed' });
    render(<SampleFilesSection sampleID="S1" />);
    expect(screen.getByText('listing failed')).toBeInTheDocument();
    expect(screen.getByText('sampleFiles.noFiles')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('SampleFilesSection permissions', () => {
  it.each([
    ['Administrador', { roleName: 'Administrador' }],
    ['Coordenador', { roleName: 'Coordenador' }],
    ['accessType 4', { roleName: 'Outro', accessType: 4 }],
    ['accessType 3', { roleName: 'Outro', accessType: 3 }],
  ])('%s may upload and delete', (_n, user) => {
    h.user = user;
    serve({ files: [csv] });
    render(<SampleFilesSection sampleID="S1" />);
    expect(screen.getByTestId('sample-files-open-upload-button')).toHaveTextContent('sampleFiles.uploadFile');
    expect(screen.getByTestId('sample-file-delete-button-f1')).toBeInTheDocument();
    expect(screen.queryByText('sampleFiles.viewOnly')).toBeNull();
  });

  it.each([
    ['accessType 2', { roleName: 'Pesquisador', accessType: 2 }],
    ['no user', null],
  ])('%s only views and downloads', (_n, user) => {
    h.user = user;
    serve({ files: [csv] });
    render(<SampleFilesSection sampleID="S1" />);
    expect(screen.getByText('sampleFiles.viewOnly')).toBeInTheDocument();
    expect(screen.queryByTestId('sample-files-open-upload-button')).toBeNull();
    expect(screen.queryByTestId('sample-file-delete-button-f1')).toBeNull();
    expect(screen.getByTestId('sample-file-download-button-f1')).toBeInTheDocument();
  });
});

describe('SampleFilesSection table', () => {
  it('renders each row with its type label, size, date and uploader', () => {
    serve({
      files: [
        csv,
        { ...csv, _id: 'f2', fileName: 'tiny.txt', fileType: 'TXT', fileSize: 512, uploaderAnonId: undefined },
        { ...csv, _id: 'f3', fileName: 'big.zip', fileType: 'ZIP', fileSize: 5 * 1024 * 1024 },
        { ...csv, _id: 'f4', fileName: 'huge.raw', fileType: 'RAW', fileSize: 3 * 1024 * 1024 * 1024 },
        { ...csv, _id: 'f5', fileName: 'odd.dat', fileType: 'DAT', fileSize: 0 },
      ],
    });
    render(<SampleFilesSection sampleID="S1" />);
    const cells = (id: string) =>
      within(screen.getByTestId(`sample-file-row-${id}`)).getAllByRole('cell').map((c) => c.textContent);
    expect(cells('f1')).toEqual(['run-01.csv', 'sampleFiles.fileTypes.CSV', '2.00 KB', '04/03/2026, 05:06', 'anon-7', '']);
    expect(cells('f2')).toEqual(['tiny.txt', 'sampleFiles.fileTypes.TXT', '512 bytes', '04/03/2026, 05:06', 'N/A', '']);
    expect(cells('f3').slice(1, 3)).toEqual(['sampleFiles.fileTypes.ZIP', '5.00 MB']);
    expect(cells('f4').slice(1, 3)).toEqual(['sampleFiles.fileTypes.RAW', '3.00 GB']);
    expect(cells('f5').slice(1, 3)).toEqual(['DAT', '0 bytes']);
  });
});

describe('SampleFilesSection download and delete', () => {
  it('downloads by id and name, and alerts a failure', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    serve({ files: [csv] });
    render(<SampleFilesSection sampleID="S1" />);
    fireEvent.click(screen.getByTestId('sample-file-download-button-f1'));
    expect(hook.downloadFile).toHaveBeenCalledWith('f1', 'run-01.csv');
    await act(async () => {});
    expect(alert).not.toHaveBeenCalled();

    hook.downloadFile.mockRejectedValueOnce(new Error('gone'));
    fireEvent.click(screen.getByTestId('sample-file-download-button-f1'));
    await waitFor(() => expect(alert).toHaveBeenCalledWith('gone'));

    hook.downloadFile.mockRejectedValueOnce(new Error(''));
    fireEvent.click(screen.getByTestId('sample-file-download-button-f1'));
    await waitFor(() => expect(alert).toHaveBeenLastCalledWith('sampleFiles.downloadError'));
  });

  it('a row with no _id neither downloads nor deletes', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    // Both rows' React key is undefined here; that warning is not under test.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    serve({ files: [{ ...csv, _id: undefined }] });
    render(<SampleFilesSection sampleID="S1" />);
    fireEvent.click(screen.getByTestId('sample-file-download-button-undefined'));
    fireEvent.click(screen.getByTestId('sample-file-delete-button-undefined'));
    expect(hook.downloadFile).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(hook.deleteFile).not.toHaveBeenCalled();
  });

  it('deletes only after confirm, disabling the button while it runs', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    serve({ files: [csv] });
    render(<SampleFilesSection sampleID="S1" />);
    const del = screen.getByTestId('sample-file-delete-button-f1');

    fireEvent.click(del);
    expect(confirm).toHaveBeenCalledWith('sampleFiles.deleteConfirm');
    expect(hook.deleteFile).not.toHaveBeenCalled();

    const d = deferred();
    hook.deleteFile.mockReturnValueOnce(d.promise);
    fireEvent.click(del);
    expect(hook.deleteFile).toHaveBeenCalledWith('f1');
    await waitFor(() => expect(del).toBeDisabled());
    await act(async () => d.resolve());
    expect(del).toBeEnabled();
  });

  it('alerts a failed delete and re-enables the button', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    serve({ files: [csv] });
    render(<SampleFilesSection sampleID="S1" />);
    hook.deleteFile.mockRejectedValueOnce(new Error('locked'));
    fireEvent.click(screen.getByTestId('sample-file-delete-button-f1'));
    await waitFor(() => expect(alert).toHaveBeenCalledWith('locked'));
    expect(screen.getByTestId('sample-file-delete-button-f1')).toBeEnabled();

    hook.deleteFile.mockRejectedValueOnce(new Error(''));
    fireEvent.click(screen.getByTestId('sample-file-delete-button-f1'));
    await waitFor(() => expect(alert).toHaveBeenLastCalledWith('sampleFiles.deleteError'));
  });
});

describe('SampleFilesSection upload', () => {
  const open = () => fireEvent.click(screen.getByTestId('sample-files-open-upload-button'));
  const input = () => screen.getByTestId('file-upload-input') as HTMLInputElement;
  const submit = () => screen.getByTestId('sample-files-upload-submit');
  const pick = (f: File) => fireEvent.change(input(), { target: { files: [f] } });

  it('opens the modal with the submit disabled and ignores an empty pick', () => {
    render(<SampleFilesSection sampleID="S1" />);
    expect(screen.queryByText('sampleFiles.uploadTitle')).toBeNull();
    open();
    expect(screen.getByText('sampleFiles.uploadTitle')).toBeInTheDocument();
    expect(submit()).toBeDisabled();
    fireEvent.change(input(), { target: { files: [] } });
    expect(submit()).toBeDisabled();
  });

  it('refuses a disallowed extension and an oversized file', () => {
    render(<SampleFilesSection sampleID="S1" />);
    open();
    pick(fileOf('tool.exe', 10));
    expect(screen.getByText('sampleFiles.invalidFileType')).toBeInTheDocument();
    expect(submit()).toBeDisabled();

    // The static hint paragraph also reads sampleFiles.maxSize, so the error is the second copy.
    expect(screen.getAllByText('sampleFiles.maxSize')).toHaveLength(1);
    pick(fileOf('scan.raw', 100 * 1024 * 1024 + 1));
    expect(screen.getAllByText('sampleFiles.maxSize')).toHaveLength(2);
    expect(screen.queryByText('sampleFiles.invalidFileType')).toBeNull();
    expect(submit()).toBeDisabled();

    pick(fileOf('scan.RAW', 100 * 1024 * 1024));
    expect(screen.getAllByText('sampleFiles.maxSize')).toHaveLength(1);
    expect(screen.getByText('scan.RAW')).toBeInTheDocument();
    expect(screen.getByText('100.00 MB')).toBeInTheDocument();
    expect(submit()).toBeEnabled();
  });

  it('uploads the picked file, shows progress, then closes and resets', async () => {
    const d = deferred<unknown>();
    hook.uploadFile.mockReturnValueOnce(d.promise);
    render(<SampleFilesSection sampleID="S1" />);
    open();
    const f = fileOf('data.csv', 2048);
    pick(f);
    expect(screen.getByText('data.csv')).toBeInTheDocument();
    expect(screen.getByText('2.00 KB')).toBeInTheDocument();

    fireEvent.click(submit());
    expect(hook.uploadFile).toHaveBeenCalledWith(f);
    await waitFor(() => expect(submit()).toHaveTextContent('common.loading'));
    expect(submit()).toBeDisabled();
    expect(screen.getByText('common.cancel').closest('button')).toBeDisabled();

    await act(async () => d.resolve({}));
    await waitFor(() => expect(screen.queryByText('sampleFiles.uploadTitle')).toBeNull());
    open();
    expect(screen.queryByText('data.csv')).toBeNull();
    expect(submit()).toBeDisabled();
    expect(submit()).toHaveTextContent('sampleFiles.uploadFile');
  });

  it('keeps the modal open with the error on a failed upload', async () => {
    render(<SampleFilesSection sampleID="S1" />);
    open();
    pick(fileOf('data.csv', 10));
    hook.uploadFile.mockRejectedValueOnce(new Error('quota exceeded'));
    fireEvent.click(submit());
    expect(await screen.findByText('quota exceeded')).toBeInTheDocument();
    expect(screen.getByText('sampleFiles.uploadTitle')).toBeInTheDocument();
    expect(submit()).toBeEnabled();

    hook.uploadFile.mockRejectedValueOnce(new Error(''));
    fireEvent.click(submit());
    expect(await screen.findByText('sampleFiles.uploadError')).toBeInTheDocument();
    expect(screen.queryByText('quota exceeded')).toBeNull();
  });

  it.each([
    ['Cancel', () => fireEvent.click(screen.getByText('common.cancel'))],
    ['Escape', () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })],
  ])('%s closes the modal and clears the pick and the error', async (_n, close) => {
    render(<SampleFilesSection sampleID="S1" />);
    open();
    pick(fileOf('data.csv', 10));
    pick(fileOf('tool.exe', 10));
    expect(screen.getByText('sampleFiles.invalidFileType')).toBeInTheDocument();
    close();
    await waitFor(() => expect(screen.queryByText('sampleFiles.uploadTitle')).toBeNull());
    open();
    expect(screen.queryByText('data.csv')).toBeNull();
    expect(screen.queryByText('sampleFiles.invalidFileType')).toBeNull();
    expect(submit()).toBeDisabled();
  });
});

describe('SampleFilesSection fallbacks', () => {
  it('reads the Portuguese fallback when a key has no translation', async () => {
    h.t = () => '';
    h.user = { roleName: 'Pesquisador' };
    render(<SampleFilesSection sampleID="S1" />);
    expect(screen.getByText('Arquivos de Análise')).toBeInTheDocument();
    expect(screen.getByText('Você pode visualizar e fazer download dos arquivos')).toBeInTheDocument();
    expect(screen.getByText('Nenhum arquivo associado a esta amostra')).toBeInTheDocument();
  });

  it('labels the table, types, actions and upload errors with the fallbacks', async () => {
    h.t = () => '';
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const types = ['RAW', 'ZIP', 'CSV', 'XLS', 'XLSX', 'PDF', 'TXT'];
    serve({ files: types.map((fileType, i) => ({ ...csv, _id: `t${i}`, fileType })) });
    render(<SampleFilesSection sampleID="S1" />);
    expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).toEqual([
      'Nome do Arquivo', 'Tipo', 'Tamanho', 'Data de Upload', 'Enviado por', 'Ações',
    ]);
    expect(types.map((_t, i) => within(screen.getByTestId(`sample-file-row-t${i}`)).getAllByRole('cell')[1].textContent))
      .toEqual(types);
    expect(screen.getByTestId('sample-file-download-button-t0')).toHaveAttribute('title', 'Download');
    expect(screen.getByTestId('sample-file-delete-button-t0')).toHaveAttribute('title', 'Excluir');

    hook.downloadFile.mockRejectedValueOnce(new Error(''));
    fireEvent.click(screen.getByTestId('sample-file-download-button-t0'));
    await waitFor(() => expect(alert).toHaveBeenLastCalledWith('Erro ao fazer download'));
    hook.deleteFile.mockRejectedValueOnce(new Error(''));
    fireEvent.click(screen.getByTestId('sample-file-delete-button-t0'));
    expect(confirm).toHaveBeenCalledWith('Tem certeza que deseja excluir este arquivo?');
    await waitFor(() => expect(alert).toHaveBeenLastCalledWith('Erro ao excluir arquivo'));

    fireEvent.click(screen.getByTestId('sample-files-open-upload-button'));
    expect(screen.getByText('Upload de Arquivo de Análise')).toBeInTheDocument();
    const input = screen.getByLabelText('Selecionar Arquivo') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [fileOf('tool.exe', 1)] } });
    expect(screen.getByText('Tipo de arquivo inválido')).toBeInTheDocument();
    fireEvent.change(input, { target: { files: [fileOf('a.csv', 100 * 1024 * 1024 + 1)] } });
    expect(screen.getByText('Arquivo muito grande. Tamanho máximo: 100MB')).toBeInTheDocument();
    fireEvent.change(input, { target: { files: [fileOf('a.csv', 1)] } });
    hook.uploadFile.mockRejectedValueOnce(new Error(''));
    fireEvent.click(screen.getByTestId('sample-files-upload-submit'));
    expect(await screen.findByText('Erro ao fazer upload')).toBeInTheDocument();
    expect(screen.getByTestId('sample-files-upload-submit')).toHaveTextContent('Enviar Arquivo');
    expect(screen.getByText('Cancelar')).toBeInTheDocument();
  });
});
