import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const UserRoleAssignmentModel = require('../../../src/models/UserRoleAssignment');

describe('UserRoleAssignmentModel', () => {
  describe('create', () => {
    it('requires userAccountId', () => {
      expect(() => UserRoleAssignmentModel.create({ roleId: 'r1', grantedBy: 'admin-1' })).toThrow('userAccountId é obrigatório para UserRoleAssignment');
    });

    it('requires roleId', () => {
      expect(() => UserRoleAssignmentModel.create({ userAccountId: 'u1', grantedBy: 'admin-1' })).toThrow('roleId é obrigatório para UserRoleAssignment');
    });

    it('requires grantedBy', () => {
      expect(() => UserRoleAssignmentModel.create({ userAccountId: 'u1', roleId: 'r1' })).toThrow('grantedBy é obrigatório para UserRoleAssignment');
    });

    it('rejects an invalid scopeType', () => {
      expect(() => UserRoleAssignmentModel.create({ userAccountId: 'u1', roleId: 'r1', grantedBy: 'admin-1', scopeType: 'planet' }))
        .toThrow('scopeType inválido: planet');
    });

    it('builds an assignment with a generated assignmentId and active defaults', () => {
      const doc = UserRoleAssignmentModel.create({ userAccountId: 'u1', roleId: 'r1', grantedBy: 'admin-1' });

      expect(doc.assignmentId).toMatch(/^[0-9a-f-]{36}$/);
      expect(doc.assignmentStatus).toBe('active');
      expect(doc.validFrom).toBeInstanceOf(Date);
      expect(doc.grantedAt).toBeInstanceOf(Date);
      expect(doc.revokedAt).toBeNull();
    });
  });
});
