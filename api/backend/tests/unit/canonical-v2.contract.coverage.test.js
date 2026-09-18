import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const contract = require('../../src/contracts/canonical/v2');

describe('canonical v2 contract helper coverage for item 8', () => {
  it('parses bounded, unbounded and malformed cardinalities', () => {
    expect(contract.cardinalityBounds('1..1')).toEqual({ min: 1, max: 1 });
    expect(contract.cardinalityBounds('0..*')).toEqual({ min: 0, max: null });
    expect(contract.cardinalityBounds('2..5')).toEqual({ min: 2, max: 5 });
    expect(contract.cardinalityBounds('bad')).toEqual({ min: 0, max: null });
    expect(contract.cardinalityBounds(null)).toEqual({ min: 0, max: null });
  });

  it('recognizes arrays from cardinality and data-type notation', () => {
    expect(contract.isArrayElement({ cardinality: '0..*', dataType: 'string' })).toBe(true);
    expect(contract.isArrayElement({ cardinality: '0..2', dataType: 'string' })).toBe(true);
    expect(contract.isArrayElement({ cardinality: '0..1', dataType: 'string[]' })).toBe(true);
    expect(contract.isArrayElement({ cardinality: '0..1', dataType: 'array<string>' })).toBe(true);
    expect(contract.isArrayElement({ cardinality: '0..1', dataType: 'string' })).toBe(false);
  });

  it('maps every primitive-schema family used by the canonical dictionary', () => {
    expect(contract.primitiveSchema('boolean')).toEqual({ type: 'boolean' });

    for (const type of ['integer', 'integer64', 'integer code', 'integer duration']) {
      expect(contract.primitiveSchema(type)).toEqual({ type: 'integer' });
    }

    expect(contract.primitiveSchema('integer >=0')).toEqual({ type: 'integer', minimum: 0 });
    expect(contract.primitiveSchema('decimal')).toEqual({ type: 'number' });
    expect(contract.primitiveSchema('string/email')).toEqual({ type: 'string', format: 'email' });
    expect(contract.primitiveSchema('uri')).toEqual({ type: 'string', format: 'uri-reference' });
    expect(contract.primitiveSchema('uuid')).toEqual({ type: 'string', format: 'uuid' });

    for (const type of [
      'string',
      'code',
      'markdown',
      'datetime',
      'date',
      'expression',
      'hash',
      'secret/hash',
      'secret/encrypted',
      'encrypted string',
      'string pseudonym',
      'string/i18n',
      'string/ip',
      'string/e.164',
      'derived code',
      'constant',
    ]) {
      expect(contract.primitiveSchema(type)).toEqual({ type: 'string' });
    }

    expect(contract.primitiveSchema('Reference(Specimen)')).toEqual({
      anyOf: [
        { type: 'string', minLength: 1 },
        { type: 'object' },
      ],
    });

    expect(contract.primitiveSchema('string/integer')).toEqual({
      anyOf: [
        { type: 'string' },
        { type: 'integer' },
      ],
    });

    for (const type of [
      'object',
      'BackboneElement',
      'CodeableConcept',
      'Coding',
      'Identifier',
      'Period',
      'Quantity',
      'ContactInformation',
      'Timing',
      'Duration',
      'Choice',
      'Disease',
      'ArtifactReference',
      'GovernanceInvariant',
    ]) {
      expect(contract.primitiveSchema(type)).toEqual({ type: 'object' });
    }

    expect(contract.primitiveSchema('string[]')).toEqual({ type: 'string' });
    expect(contract.primitiveSchema('array<decimal>')).toEqual({ type: 'number' });
    expect(contract.primitiveSchema('unmapped-custom-type')).toEqual({});
    expect(contract.primitiveSchema(null)).toEqual({});
  });

  it('covers schema lookup, entity validation, rule and relationship list filters', async () => {
    const specimenSchema = await contract.getSchema('Specimen');
    expect(specimenSchema).toBeTruthy();

    await expect(contract.getSchema('EntityThatDoesNotExist')).resolves.toBeNull();

    const validation = await contract.validateEntity('Specimen', {});
    expect(validation.schemaId).toBe('canonical.v2.Specimen');
    expect(typeof validation.valid).toBe('boolean');
    expect(Array.isArray(validation.errors)).toBe(true);

    await expect(contract.validateEntity('EntityThatDoesNotExist', {}))
      .rejects.toThrow('Canonical v2 entity not registered');

    const allRules = await contract.listConditionalRules();
    expect(Array.isArray(allRules)).toBe(true);
    if (allRules.length) {
      const selector = allRules[0]['Entity/domain'];
      const filtered = await contract.listConditionalRules(selector);
      expect(filtered.every((row) => row['Entity/domain'] === selector)).toBe(true);
    }
    await expect(contract.listConditionalRules('__missing__')).resolves.toEqual([]);

    const allRelationships = await contract.listRelationships();
    expect(Array.isArray(allRelationships)).toBe(true);
    if (allRelationships.length) {
      const selector = allRelationships[0]['Source entity'];
      const filtered = await contract.listRelationships(selector);
      expect(filtered.every((row) => row['Source entity'] === selector)).toBe(true);
    }
    await expect(contract.listRelationships('__missing__')).resolves.toEqual([]);
  });
});
