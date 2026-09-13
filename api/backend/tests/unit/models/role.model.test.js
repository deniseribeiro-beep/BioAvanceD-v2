import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const RoleModel = require('../../../src/models/Role');

describe('RoleModel', () => {
  describe('create', () => {
    it('requires roleCode', () => {
      expect(() => RoleModel.create({ permissionIds: ['p1'] })).toThrow('roleCode é obrigatório para Role');
    });

    it('requires at least one permissionId', () => {
      expect(() => RoleModel.create({ roleCode: 'technician' })).toThrow('permissionIds deve conter ao menos um item para Role');
    });

    it('rejects an invalid roleStatus', () => {
      expect(() => RoleModel.create({ roleCode: 'technician', permissionIds: ['p1'], roleStatus: 'nope' })).toThrow('roleStatus inválido: nope');
    });

    it('builds a role with a generated roleId and defaults', () => {
      const doc = RoleModel.create({ roleCode: 'technician', permissionIds: ['p1', 'p2'] });

      expect(doc.roleId).toMatch(/^[0-9a-f-]{36}$/);
      expect(doc.roleCode).toBe('technician');
      expect(doc.roleStatus).toBe('active');
      expect(doc.permissionIds).toEqual(['p1', 'p2']);
      expect(doc.createdAt).toBeInstanceOf(Date);
      expect(doc.updatedAt).toBeInstanceOf(Date);
    });

    it('honors an explicit roleId (upsert-by-key round trips)', () => {
      const doc = RoleModel.create({ roleId: 'fixed-id', roleCode: 'technician', permissionIds: ['p1'] });
      expect(doc.roleId).toBe('fixed-id');
    });
  });
});
