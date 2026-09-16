import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  CONTRACT_VERSION,
  getRegistry,
  cardinalityBounds,
} = require('../../src/contracts/canonical/v2');

describe('canonical v2 executable contract parity', () => {
  it('builds every approved entity and element from the complete v2 dictionary', async () => {
    const registry = await getRegistry();

    expect(CONTRACT_VERSION).toBe('2.0.0');
    expect(registry.completeness.verified).toBe(true);
    expect(registry.schemas.size).toBe(146);
    expect(registry.elements).toHaveLength(1644);
  });

  it('keeps every generated entity closed to unknown fields', async () => {
    const registry = await getRegistry();

    for (const [entity, schema] of registry.schemas) {
      expect(schema.$id).toBe(`canonical.v2.${entity}`);
      expect(schema.additionalProperties).toBe(false);
    }
  });

  it('represents every dictionary element and derives required fields from active cardinality', async () => {
    const registry = await getRegistry();

    for (const element of registry.elements) {
      const schema = registry.schemas.get(element.entity);
      const property = schema?.properties?.[element.canonicalField];
      expect(property, element.elementId).toBeDefined();

      const deprecated = /^deprecated$/i.test(String(element.changeStatus || '').trim());
      const conditional = /^conditional$/i.test(String(element.requirement || '').trim());
      const { min } = cardinalityBounds(element.cardinality);
      const shouldBeRequired = !deprecated && !conditional && min >= 1;
      expect((schema.required || []).includes(element.canonicalField), element.elementId)
        .toBe(shouldBeRequired);
      if (deprecated) {
        expect(property.readOnly, element.elementId).toBe(true);
      }
    }
  });

  it('projects every active scalar enum into its field validator', async () => {
    const registry = await getRegistry();

    for (const row of registry.enumRows.filter(
      (entry) => String(entry.Status || '').toLowerCase() === 'active',
    )) {
      const property = registry.schemas.get(row.Entity)?.properties?.[row.Field];
      expect(property, `${row.Entity}.${row.Field}`).toBeDefined();
      const scalar = property.type === 'array' ? property.items : property;
      if (Array.isArray(scalar?.enum)) {
        expect(scalar.enum).toContain(row.Value);
      }
    }
  });
});
