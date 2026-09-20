import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fs = require('fs');
const logger = require('../../src/utils/logger');
const validatorPath = require.resolve('../../src/services/fhir-validator.service');
const validator = require(validatorPath);

describe('fhir-validator.service item 8 executable residual branches', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete require.cache[validatorPath];
    validator.schemaMap.delete('GhostResource');
  });

  it('keeps the service unavailable-but-safe when the profiles directory is missing', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    delete require.cache[validatorPath];
    const freshValidator = require(validatorPath);

    expect(freshValidator.loaded).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      'Pasta de perfis FHIR não encontrada:',
      expect.any(String)
    );
  });

  it('ignores a profile file that has no schema $id instead of registering an unusable validator', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['NoId.schema.json']);
    const originalReadFileSync = fs.readFileSync.bind(fs);
    vi.spyOn(fs, 'readFileSync').mockImplementation((filePath, ...args) => {
      if (String(filePath).endsWith('NoId.schema.json')) {
        return JSON.stringify({
          type: 'object',
          properties: { resourceType: { const: 'NoId' } },
        });
      }
      return originalReadFileSync(filePath, ...args);
    });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    delete require.cache[validatorPath];
    const freshValidator = require(validatorPath);

    expect(freshValidator.loaded).toBe(true);
    expect(freshValidator.getSchemaId('NoId')).toBeNull();
    expect(warn).toHaveBeenCalledWith('Schema sem $id ignorado: NoId.schema.json');
  });

  it('returns the explicit validator-not-loaded issue when a schema id is mapped but AJV has no validator', () => {
    validator.schemaMap.set('GhostResource', 'urn:bioavanced:missing-validator');

    const result = validator.validateResource({
      resourceType: 'GhostResource',
    });

    expect(result).toEqual({
      valid: false,
      issues: [
        expect.objectContaining({
          diagnostics: 'Validador não carregado para GhostResource',
          expression: '/resourceType',
        }),
      ],
    });
  });

  it('uses the original AJV message when present and the canonical generic fallback when it is absent', () => {
    const withMessage = validator.friendlyMessageFromError('UnknownResource', {
      keyword: 'type',
      instancePath: '/arbitrary',
      message: 'must be string',
      params: {},
    });
    const withoutMessage = validator.friendlyMessageFromError('UnknownResource', {
      keyword: 'type',
      instancePath: '/arbitrary',
      params: {},
    });

    expect(withMessage).toBe('must be string');
    expect(withoutMessage).toBe('Recurso FHIR inválido');
  });
});
