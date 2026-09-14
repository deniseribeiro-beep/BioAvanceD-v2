const { test } = require('node:test');
const assert = require('node:assert/strict');

const canonicalDictionary = require('../../src/reference-data/canonical-dictionary');
const canonicalV2 = require('../../src/contracts/canonical/v2');

test('approved v2 dictionary is complete before executable contracts are accepted', async () => {
  const completeness = await canonicalDictionary.checkCompleteness();
  assert.equal(completeness.dictionaryVersion, '2.0.0');
  assert.equal(completeness.loadedTotal, 1644);
  assert.equal(completeness.uniqueTotal, 1644);
  assert.equal(completeness.historicalTotal, 929);
  assert.equal(completeness.newTotal, 715);
  assert.equal(completeness.entityTotal, 146);
  assert.deepEqual(completeness.duplicateIds, []);
  assert.deepEqual(completeness.missingRequiredFieldIds, []);
  assert.deepEqual(completeness.nonPhaseOneIds, []);
  assert.equal(completeness.verified, true);
});

test('all 146 approved entities/artifacts have an executable canonical v2 contract', async () => {
  const registry = await canonicalV2.getRegistry();
  assert.equal(registry.schemas.size, 146);

  const dictionaryEntities = [...new Set(registry.elements.map((element) => element.entity))].sort();
  const schemaEntities = [...registry.schemas.keys()].sort();
  assert.deepEqual(schemaEntities, dictionaryEntities);
});

test('every one of the 1,644 canonical elements is represented in its entity contract', async () => {
  const registry = await canonicalV2.getRegistry();
  const missing = [];

  for (const element of registry.elements) {
    const schema = registry.schemas.get(element.entity);
    if (!schema || !Object.prototype.hasOwnProperty.call(schema.properties || {}, element.canonicalField)) {
      missing.push(element.elementId);
    }
  }

  assert.deepEqual(missing, []);
});

test('active governed enum values are present in the generated contract when the field is scalar code/string', async () => {
  const registry = await canonicalV2.getRegistry();
  const missing = [];

  for (const row of registry.enumRows.filter((entry) => String(entry.Status || '').toLowerCase() === 'active')) {
    const schema = registry.schemas.get(row.Entity);
    const property = schema?.properties?.[row.Field];
    if (!property) {
      missing.push(`${row.Entity}.${row.Field}:${row.Value}:field`);
      continue;
    }
    const scalar = property.type === 'array' ? property.items : property;
    if (Array.isArray(scalar?.enum) && !scalar.enum.includes(row.Value)) {
      missing.push(`${row.Entity}.${row.Field}:${row.Value}:enum`);
    }
  }

  assert.deepEqual(missing, []);
});

test('all documented relationship source fields resolve to a canonical v2 source contract', async () => {
  const registry = await canonicalV2.getRegistry();
  const unresolved = [];

  for (const relationship of registry.relationships) {
    const sourceEntity = relationship['Source entity'];
    const sourceField = relationship['Source field'];
    const schema = registry.schemas.get(sourceEntity);
    if (!schema || !Object.prototype.hasOwnProperty.call(schema.properties || {}, sourceField)) {
      unresolved.push(`${relationship['Relationship ID']}:${sourceEntity}.${sourceField}`);
    }
  }

  assert.deepEqual(unresolved, []);
});

test('normalized physical custody chain is represented and StorageAssignment is not an active relationship source', async () => {
  const registry = await canonicalV2.getRegistry();
  for (const entity of ['SpecimenContainerAssignment', 'ContainerPositionAssignment', 'RackLocationAssignment']) {
    assert.ok(registry.schemas.has(entity), `missing ${entity}`);
  }

  const activeStorageAssignmentRelationships = registry.relationships
    .filter((relationship) => relationship['Source entity'] === 'StorageAssignment' || relationship['Target entity'] === 'StorageAssignment');
  assert.deepEqual(activeStorageAssignmentRelationships, []);
});
