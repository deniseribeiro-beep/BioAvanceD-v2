import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from './api';
import { storageApi } from './storageApi';

vi.mock('./api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const del = vi.mocked(api.delete);

type Verb = 'get' | 'post' | 'delete';

interface Row {
  name: string;
  verb: Verb;
  call: () => Promise<any>;
  url: string;
  body?: unknown;
  fallback: string;
  // validatePosition, allocateSample, autoAssignSampleToBox, moveSample and
  // releaseSample also carry a message; the other six return error only.
  withMessage: boolean;
  // searchSamples alone adds data: []; validatePosition alone adds available: false.
  extra?: Record<string, unknown>;
}

const rows: Row[] = [
  {
    name: 'searchSamples',
    verb: 'get',
    call: () => storageApi.searchSamples('BC 01&x=1'),
    url: '/storage/samples/search?q=BC%2001%26x%3D1',
    fallback: 'SEARCH_ERROR',
    withMessage: false,
    extra: { data: [] },
  },
  {
    name: 'listFreezers',
    verb: 'get',
    call: () => storageApi.listFreezers(),
    url: '/storage/freezers',
    fallback: 'LIST_ERROR',
    withMessage: false,
  },
  {
    name: 'validatePosition',
    verb: 'get',
    call: () => storageApi.validatePosition('box-7', 'B3'),
    url: '/storage/validate/box-7/B3',
    fallback: 'VALIDATION_ERROR',
    withMessage: true,
    extra: { available: false },
  },
  {
    name: 'allocateSample',
    verb: 'post',
    call: () => storageApi.allocateSample('s-1', 'box-7', 'B3'),
    url: '/storage/allocate',
    body: { sampleId: 's-1', boxId: 'box-7', position: 'B3' },
    fallback: 'ALLOCATION_ERROR',
    withMessage: true,
  },
  {
    name: 'autoAssignSampleToBox',
    verb: 'post',
    call: () => storageApi.autoAssignSampleToBox('s-1', 'box-7'),
    url: '/storage/allocate/auto',
    body: { sampleId: 's-1', boxId: 'box-7' },
    fallback: 'AUTO_ALLOCATION_ERROR',
    withMessage: true,
  },
  {
    name: 'moveSample',
    verb: 'post',
    call: () => storageApi.moveSample('s-1', 'box-9', 'C4', 'reorg', 'shelf 2'),
    url: '/storage/move',
    body: { sampleId: 's-1', targetBoxId: 'box-9', targetPosition: 'C4', reason: 'reorg', notes: 'shelf 2' },
    fallback: 'MOVE_SAMPLE_ERROR',
    withMessage: true,
  },
  {
    name: 'releaseSample',
    verb: 'delete',
    call: () => storageApi.releaseSample('s-1'),
    url: '/storage/release/s-1',
    fallback: 'RELEASE_ERROR',
    withMessage: true,
  },
  {
    name: 'getSampleLocation',
    verb: 'get',
    call: () => storageApi.getSampleLocation('s-1'),
    url: '/storage/sample/s-1',
    fallback: 'LOCATION_ERROR',
    withMessage: false,
  },
  {
    name: 'getAvailablePositions',
    verb: 'get',
    call: () => storageApi.getAvailablePositions('box-7'),
    url: '/storage/box/box-7/available',
    fallback: 'AVAILABLE_ERROR',
    withMessage: false,
  },
  {
    name: 'getFreezerTree',
    verb: 'get',
    call: () => storageApi.getFreezerTree('fz-2'),
    url: '/storage/freezer/fz-2/tree',
    fallback: 'TREE_ERROR',
    withMessage: false,
  },
  {
    name: 'getFreezerStats',
    verb: 'get',
    call: () => storageApi.getFreezerStats('fz-2'),
    url: '/storage/freezer/fz-2/stats',
    fallback: 'STATS_ERROR',
    withMessage: false,
  },
];

const verbs = { get, post, delete: del };

describe('storageApi', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  for (const row of rows) {
  describe(row.name, () => {
    const mock = verbs[row.verb];

    it(`${row.name}: calls the endpoint once and returns response.data as it came`, async () => {
      const payload = { success: true, data: { marker: row.name } };
      mock.mockResolvedValueOnce({ data: payload } as any);

      const result = await row.call();

      expect(result).toBe(payload);
      expect(mock).toHaveBeenCalledTimes(1);
      if (row.body === undefined) {
        expect(mock).toHaveBeenCalledWith(row.url);
      } else {
        expect(mock).toHaveBeenCalledWith(row.url, row.body);
      }
      for (const other of Object.keys(verbs) as Verb[]) {
        if (other !== row.verb) expect(verbs[other]).not.toHaveBeenCalled();
      }
    });

    it(`${row.name}: passes the server's error (and message) through when the request fails with a response`, async () => {
      mock.mockRejectedValueOnce(
        Object.assign(new Error('Request failed with status code 409'), {
          response: { data: { error: 'SERVER_CODE', message: 'server says no' } },
        }),
      );

      const result = await row.call();

      expect(result).toEqual({
        success: false,
        error: 'SERVER_CODE',
        ...(row.withMessage ? { message: 'server says no' } : {}),
        ...row.extra,
      });
    });

    it(`${row.name}: falls back to ${row.fallback} when the request fails with no response`, async () => {
      mock.mockRejectedValueOnce(new Error('Network Error'));

      const result = await row.call();

      expect(result).toEqual({
        success: false,
        error: row.fallback,
        ...(row.withMessage ? { message: 'Network Error' } : {}),
        ...row.extra,
      });
    });
  });
  }
});
