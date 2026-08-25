import { describe, expect, it } from 'vitest';
import { validateBackupPolicyDraft, formatChecksum, resolveBackupStatusKey } from './BackupPage';

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

// #740 (RF013 AC#1 "Exibir estado, data e resultado das execucoes" / AC#3
// "Registrar checksum e evidencia de conclusao"): GET /api/backup/list has
// carried `status` and `checksum` per entry since ddd9154c, but the table
// rendered neither. These are the two pure helpers the new columns use --
// unit-tested directly, per this repo's frontend-test convention.
describe('#740: resolveBackupStatusKey', () => {
  it('maps each persisted run status onto its own i18n key', () => {
    expect(resolveBackupStatusKey('success')).toBe('backup.statusSuccess');
    expect(resolveBackupStatusKey('error')).toBe('backup.statusError');
    expect(resolveBackupStatusKey('skipped')).toBe('backup.statusSkipped');
  });

  it('falls back to the unknown key when no run history exists for the directory', () => {
    // GET /api/backup/list sets status to null for a backup directory with
    // no matching backupHistory row -- a real case, not a defensive one:
    // the listing is filesystem-rooted and history is merged in per path.
    expect(resolveBackupStatusKey(null)).toBe('backup.statusUnknown');
    expect(resolveBackupStatusKey(undefined)).toBe('backup.statusUnknown');
  });

  it('does not invent a key for a status the backend never emits', () => {
    expect(resolveBackupStatusKey('banana')).toBe('backup.statusUnknown');
  });
});

describe('#740: formatChecksum', () => {
  it('truncates a sha256 digest to a readable prefix', () => {
    const digest = 'a'.repeat(64);
    expect(formatChecksum(digest)).toBe(`${'a'.repeat(12)}…`);
  });

  it('leaves a value shorter than the truncation point intact', () => {
    expect(formatChecksum('abc123')).toBe('abc123');
  });

  it('renders an em dash when the run recorded no checksum', () => {
    expect(formatChecksum(null)).toBe('—');
    expect(formatChecksum(undefined)).toBe('—');
    expect(formatChecksum('')).toBe('—');
  });
});
