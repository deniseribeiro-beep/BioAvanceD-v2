import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const PermissionModel = require('../../../src/models/Permission');

describe('PermissionModel', () => {
  describe('create', () => {
    it('requires permissionCode', () => {
      expect(() => PermissionModel.create({ resourceType: 'Sample', allowedActions: ['CREATE'] })).toThrow('permissionCode é obrigatório para Permission');
    });

    it('requires resourceType', () => {
      expect(() => PermissionModel.create({ permissionCode: 'createSample', allowedActions: ['CREATE'] })).toThrow('resourceType é obrigatório para Permission');
    });

    it('requires at least one allowedAction', () => {
      expect(() => PermissionModel.create({ permissionCode: 'createSample', resourceType: 'Sample' })).toThrow('allowedActions deve conter ao menos um item para Permission');
    });

    it('rejects an allowedAction outside dict-02 vocabulary', () => {
      expect(() => PermissionModel.create({ permissionCode: 'createSample', resourceType: 'Sample', allowedActions: ['MANAGE'] }))
        .toThrow('allowedActions contém ação inválida: MANAGE');
    });

    it('builds a permission with a generated permissionId and defaults', () => {
      const doc = PermissionModel.create({ permissionCode: 'createSample', resourceType: 'Sample', allowedActions: ['CREATE'] });

      expect(doc.permissionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(doc.permissionCode).toBe('createSample');
      expect(doc.permissionStatus).toBe('active');
      expect(doc.allowedActions).toEqual(['CREATE']);
    });
  });
});
