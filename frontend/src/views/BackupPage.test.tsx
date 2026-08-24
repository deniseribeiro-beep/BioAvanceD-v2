import { describe, expect, it } from 'vitest';
import { validateBackupPolicyDraft } from './BackupPage';

describe('validateBackupPolicyDraft', () => {
  it('#728: accepts a policy draft that satisfies every RNF010 bound', () => {
    const errors = validateBackupPolicyDraft({
      cronExpression: '0 3 * * *',
      retentionDays: 30,
      encryptionEnabled: true,
      rpoHours: 24,
      rtoHours: 12,
    });

    expect(errors).toEqual([]);
  });

  it('rejects a cron expression with fewer than 5 fields', () => {
    const errors = validateBackupPolicyDraft({ cronExpression: '0 3 *' });
    expect(errors).toContain('cronExpression deve ser uma expressão cron de 5 campos');
  });

  it('rejects retentionDays below the RNF010 AC#4 floor of 30', () => {
    const errors = validateBackupPolicyDraft({ retentionDays: 29 });
    expect(errors).toContain('retentionDays deve ser um número >= 30 (RNF010 AC#4)');
  });

  it('rejects rpoHours outside the RNF010 AC#2 range of 1-24', () => {
    expect(validateBackupPolicyDraft({ rpoHours: 0 })).toContain(
      'rpoHours deve ser um número entre 1 e 24 (RNF010 AC#2)'
    );
    expect(validateBackupPolicyDraft({ rpoHours: 25 })).toContain(
      'rpoHours deve ser um número entre 1 e 24 (RNF010 AC#2)'
    );
  });

  it('rejects rtoHours outside the RNF010 AC#3 range of 1-12', () => {
    expect(validateBackupPolicyDraft({ rtoHours: 0 })).toContain(
      'rtoHours deve ser um número entre 1 e 12 (RNF010 AC#3)'
    );
    expect(validateBackupPolicyDraft({ rtoHours: 13 })).toContain(
      'rtoHours deve ser um número entre 1 e 12 (RNF010 AC#3)'
    );
  });

  it('ignores fields not present in the draft (matches backend partial-update semantics)', () => {
    const errors = validateBackupPolicyDraft({ encryptionEnabled: false });
    expect(errors).toEqual([]);
  });
});
