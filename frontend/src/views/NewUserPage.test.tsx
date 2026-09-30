import { describe, expect, it } from 'vitest';
import { buildUserSubmissionPayload } from './NewUserPage';
import type { User } from '../types/models';

describe('buildUserSubmissionPayload', () => {
  it('#349: sends organizationId (not the retired free-text institution field) so the backend actually persists the selected organization', () => {
    const formData: Partial<User> = {
      name: 'Ana Silva',
      email: 'ana@example.com',
      username: 'ana',
      password: 'Str0ng!Pass1',
      organizationId: 'org-123',
      roleName: 'Técnico',
      accessType: 2,
      status: 'Ativo',
    };

    const payload = buildUserSubmissionPayload(formData, null);

    expect(payload.organizationId).toBe('org-123');
    expect(payload.institution).toBeUndefined();
  });

  it('#349: normalizes an empty organizationId (no organization selected) to null, not an empty string', () => {
    const formData: Partial<User> = { organizationId: '' as any };
    const payload = buildUserSubmissionPayload(formData, null);
    expect(payload.organizationId).toBeNull();
  });

  it('strips fields that must never be resubmitted to the backend', () => {
    const editingUser = { id: 1, _id: 'abc', name: 'Ana', email: 'a@b.com', username: 'ana' } as User;
    const formData: Partial<User> = {
      ...editingUser,
      createdAt: '2026-01-01',
      accessType: 2,
      roleName: 'Técnico',
    };

    const payload = buildUserSubmissionPayload(formData, editingUser);

    expect(payload._id).toBeUndefined();
    expect(payload.id).toBeUndefined();
    expect(payload.createdAt).toBeUndefined();
    expect(payload.mfaEnabled).toBeUndefined();
  });

  it('drops an empty password so an edit does not overwrite the existing one', () => {
    const editingUser = { id: 1, name: 'Ana', email: 'a@b.com', username: 'ana', password: '' } as User;
    const payload = buildUserSubmissionPayload({ ...editingUser, password: '' }, editingUser);
    expect(payload.password).toBeUndefined();
  });

  // #1240: auditorRole is granted through PUT /api/users/:id only, so a
  // create never carries it, while an edit sends it either way.
  it('#1240: a new user never sends auditorRole', () => {
    const payload = buildUserSubmissionPayload({ name: 'Ana', username: 'ana', auditorRole: true }, null);
    expect(payload).not.toHaveProperty('auditorRole');
  });

  it('#1240: an edit sends auditorRole, false included', () => {
    const editingUser = { id: 1, _id: 'abc', name: 'Ana', email: 'a@b.com', username: 'ana', auditorRole: true } as User;
    expect(buildUserSubmissionPayload({ ...editingUser }, editingUser).auditorRole).toBe(true);
    expect(buildUserSubmissionPayload({ ...editingUser, auditorRole: false }, editingUser).auditorRole).toBe(false);
  });
});
