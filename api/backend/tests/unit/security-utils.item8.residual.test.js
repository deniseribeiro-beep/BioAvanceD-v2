// Stage 2 consolidated validation checkpoint: behavior unchanged.
import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  validateCPF,
  validateStructuredInput,
} = require('../../src/utils/security');

describe('utils/security item 8 residual branches', () => {
  it('rejects a CPF whose first verifier is valid but the second verifier is invalid', () => {
    // 52998224725 is valid; changing only the final digit reaches the
    // second-verifier branch after the first verifier already passed.
    expect(validateCPF('529.982.247-24')).toBe(false);
  });

  it('preserves allowed object values while ignoring null and unsupported values', () => {
    const marker = { id: 'object-like-id' };
    const result = validateStructuredInput({
      metadata: marker,
      nullable: null,
      unsupported: () => 'ignored',
      text: '<b>synthetic</b>',
      count: 2,
      active: false,
      tags: ['<i>A</i>', 3],
      injected: 'drop-me',
    }, [
      'metadata',
      'nullable',
      'unsupported',
      'text',
      'count',
      'active',
      'tags',
    ]);

    expect(result.isValid).toBe(true);
    expect(result.cleanData).toEqual({
      metadata: marker,
      text: 'synthetic',
      count: 2,
      active: false,
      tags: ['A', 3],
    });
    expect(result.cleanData).not.toHaveProperty('nullable');
    expect(result.cleanData).not.toHaveProperty('unsupported');
    expect(result.cleanData).not.toHaveProperty('injected');
  });
});
