import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { useSampleFiles } from './useSampleFiles';
import { sampleService } from '../services/api';
import { vi } from 'vitest';

// #901: SampleFilesSection.tsx (the consumer) keys a useEffect on sampleID
// and calls loadFiles() whenever it changes (SampleFilesSection.tsx:33-37).
// If sampleID flips quickly (A -> B) and B's response resolves before A's
// late one arrives, the unguarded hook has no way to tell the two calls
// apart -- whichever resolves LAST wins, even if it was requested first.
// This reproduces that race with two independently controllable promises.
vi.mock('../services/api', () => ({
  sampleService: {
    listFiles: vi.fn(),
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function SampleFilesHarness({ sampleID }: { sampleID: string }) {
  const { files, loading, loadFiles } = useSampleFiles(sampleID);

  // Mirrors SampleFilesSection.tsx: the load-on-change effect lives in the
  // consumer, not inside the hook.
  useEffect(() => {
    if (sampleID) {
      loadFiles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sampleID]);

  return (
    <div>
      <div data-testid="files">{JSON.stringify(files.map((f: any) => f.fileName))}</div>
      <div data-testid="loading">{String(loading)}</div>
    </div>
  );
}

describe('useSampleFiles stale-response race (#901)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('discards sampleID A\'s late response once sampleID B has been requested and resolves first', async () => {
    const deferredA = deferred<any>();
    const deferredB = deferred<any>();

    vi.mocked(sampleService.listFiles).mockImplementation(((id: string) => {
      if (id === 'sample-a') return deferredA.promise;
      if (id === 'sample-b') return deferredB.promise;
      return Promise.reject(new Error('unexpected sampleID'));
    }) as any);

    const { rerender } = render(<SampleFilesHarness sampleID="sample-a" />);
    await waitFor(() => expect(sampleService.listFiles).toHaveBeenCalledWith('sample-a'));

    rerender(<SampleFilesHarness sampleID="sample-b" />);
    await waitFor(() => expect(sampleService.listFiles).toHaveBeenCalledWith('sample-b'));

    // B (the newer request) resolves first...
    deferredB.resolve({ data: { success: true, data: [{ fileName: 'b-file.pdf' }] } });
    await waitFor(() => {
      expect(screen.getByTestId('files')).toHaveTextContent('b-file.pdf');
    });

    // ...then A's stale response arrives late. It must be discarded.
    deferredA.resolve({ data: { success: true, data: [{ fileName: 'a-file.pdf' }] } });
    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    expect(screen.getByTestId('files')).toHaveTextContent('b-file.pdf');
    expect(screen.getByTestId('files')).not.toHaveTextContent('a-file.pdf');
  });
});
