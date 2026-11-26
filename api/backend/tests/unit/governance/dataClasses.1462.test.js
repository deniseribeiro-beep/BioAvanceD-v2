import { describe, it, expect } from 'vitest';

const { listDataClasses, sensitivityOf } = require('../../../src/governance/dataClasses');
const { ENTITY_TYPE_FAMILIES } = require('../../../src/services/retentionPolicy.service');
const { LEGACY_ROLES_SEED } = require('../../../src/services/rbac-catalog-seed.service');

/**
 * #1462 (RNF022 AC1): "Cada classe possui finalidade, sensibilidade,
 * política, prazo e responsável." A data class is a retention family; the
 * registry gives each its purpose and owner role, and reads its sensitivity
 * off the catalog.
 */
describe('data-class registry (RNF022 AC1, #1462)', () => {
  const classOf = (code) => listDataClasses().find((dataClass) => dataClass.code === code);

  it('lists one record per retention family, in the family table\'s order', () => {
    expect(listDataClasses().map((dataClass) => dataClass.code)).toEqual(Object.keys(ENTITY_TYPE_FAMILIES));
    expect(Object.keys(ENTITY_TYPE_FAMILIES)).toEqual(['auditTrail', 'specimen', 'dataFile']);
  });

  it('gives each class a purpose and an owner role the RBAC seed defines', () => {
    const roleNames = LEGACY_ROLES_SEED.roles.map((role) => role.roleName);
    for (const dataClass of listDataClasses()) {
      expect(typeof dataClass.purpose).toBe('string');
      expect(dataClass.purpose.trim()).not.toBe('');
      expect(roleNames).toContain(dataClass.ownerRole);
    }
  });

  it('reads each class\'s sensitivity off the catalog', () => {
    expect(classOf('auditTrail').sensitivity).toBe('Alta');
    expect(classOf('specimen').sensitivity).toBe('Crítica');
    expect(classOf('dataFile').sensitivity).toBe('Crítica');
  });

  it('drops a note after the sensitivity value and refuses an unknown one', () => {
    expect(sensitivityOf(['X'], [{ entity: 'X', sensitivity: 'Low/metadata; PII prohibited' }])).toBe('Low/metadata');
    expect(() => sensitivityOf(['X'], [{ entity: 'X', sensitivity: 'Bogus' }])).toThrow();
    expect(sensitivityOf(['NoSuch'])).toBeNull();
  });
});
