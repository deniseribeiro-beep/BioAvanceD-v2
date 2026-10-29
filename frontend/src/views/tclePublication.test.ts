import { describe, expect, it } from 'vitest';
import { describeConsentPublication } from './tclePublication';

// #824: publishing a TCLE through the builder now runs the invitation sweep,
// and its count comes back as `consentNotifications`. #810 made a partial
// sweep visible only to an API caller and the server log; this is the
// operator-facing half.
describe('describeConsentPublication', () => {
  it('reports how many pending participants were invited on a revision', () => {
    const result = describeConsentPublication(true, { total: 3, notified: 3, failed: 0 });
    expect(result.level).toBe('success');
    expect(result.message).toMatch(/Nova versão criada/);
    expect(result.message).toMatch(/3 de 3/);
  });

  it('warns, and says how many failed, when the sweep was partial', () => {
    const result = describeConsentPublication(true, { total: 3, notified: 1, failed: 2 });
    expect(result.level).toBe('warning');
    expect(result.message).toMatch(/1 de 3/);
    expect(result.message).toMatch(/2 falha/);
  });

  it('says nothing about invitations when nobody was pending', () => {
    const result = describeConsentPublication(false, { total: 0, notified: 0, failed: 0 });
    expect(result.level).toBe('success');
    expect(result.message).toBe('TCLE criado com sucesso.');
  });

  it('tolerates a response without the count (an older backend)', () => {
    expect(describeConsentPublication(true, undefined)).toEqual({
      level: 'success',
      message: 'Nova versão criada e a anterior foi desativada.',
    });
  });
});
