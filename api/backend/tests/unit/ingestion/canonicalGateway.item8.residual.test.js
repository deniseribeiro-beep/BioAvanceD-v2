import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const contractsPath = require.resolve('../../../src/contracts/canonical/v2');
const gatewayPath = require.resolve('../../../src/ingestion/canonicalGateway');

afterEach(() => {
  vi.restoreAllMocks();
  delete require.cache[gatewayPath];
  delete require.cache[contractsPath];
});

function loadGatewayWithContractErrors(errors) {
  const original = require.cache[contractsPath];
  require.cache[contractsPath] = {
    id: contractsPath,
    filename: contractsPath,
    loaded: true,
    exports: {
      ...(original?.exports || {}),
      validateEntity: vi.fn(async () => ({ valid: false, errors })),
    },
  };
  delete require.cache[gatewayPath];
  return require('../../../src/ingestion/canonicalGateway');
}

describe('canonicalGateway item 8 residual contract-field branches', () => {
  it('maps empty instancePath through missingProperty then additionalProperty fallbacks', async () => {
    const { validateIngestionPayload } = loadGatewayWithContractErrors([
      {
        instancePath: '',
        params: { missingProperty: 'participantId' },
        message: 'required',
        keyword: 'required',
      },
      {
        instancePath: undefined,
        params: { additionalProperty: 'legacyAlias' },
        keyword: 'additionalProperties',
      },
      {
        instancePath: '',
        params: {},
        message: '',
      },
    ]);

    const result = await validateIngestionPayload({
      entityType: 'Participant',
      payload: { participantId: 'x' },
    });

    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      expect.objectContaining({
        field: 'participantId',
        message: 'required',
        ajvKeyword: 'required',
      }),
      expect.objectContaining({
        field: 'legacyAlias',
        message: 'Violação de contrato canônico v2.0.0',
        ajvKeyword: 'additionalProperties',
      }),
      expect.objectContaining({
        field: null,
        message: 'Violação de contrato canônico v2.0.0',
        ajvKeyword: null,
      }),
    ]);
  });

  it('tolerates a falsy errors array by emitting no CONTRACT_VIOLATION rows', async () => {
    const { validateIngestionPayload } = loadGatewayWithContractErrors(null);

    const result = await validateIngestionPayload({
      entityType: 'Participant',
      payload: { participantId: 'x' },
    });

    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });
});
