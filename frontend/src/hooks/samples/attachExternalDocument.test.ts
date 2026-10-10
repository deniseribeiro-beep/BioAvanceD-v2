import { describe, it, expect, vi } from 'vitest';
import { attachExternalDocument } from './attachExternalDocument';

// RF019 AC5 (#1315): a quarantined sample is released through the evidenced
// route; any other sample is moved by the update.
function fakeApi() {
  return { update: vi.fn().mockResolvedValue({}), releaseQuarantine: vi.fn().mockResolvedValue({}) };
}

describe('attachExternalDocument', () => {
  const now = new Date('2026-10-10T12:00:00.000Z');

  it('records the document and releases a quarantined sample with evidence and the reason', async () => {
    const api = fakeApi();
    await attachExternalDocument(api, { id: 'SPC-1', specimenStatus: 'quarantined' }, { actor: 'coord-1', reason: 'TCLE em papel', now });

    expect(api.update).toHaveBeenCalledWith('SPC-1', { consentStatus: 'EXTERNAL_ATTACHED', importedBy: 'coord-1' });
    expect(api.releaseQuarantine).toHaveBeenCalledWith('SPC-1', {
      evidenceIds: ['external-document:SPC-1:2026-10-10T12:00:00.000Z'],
      reason: 'TCLE em papel',
    });
  });

  it('moves a sample that is not quarantined by the update alone', async () => {
    const api = fakeApi();
    await attachExternalDocument(api, { id: 'SPC-2', specimenStatus: 'unavailable' }, { actor: 'coord-1', reason: 'x', now });

    expect(api.update).toHaveBeenCalledWith('SPC-2', {
      consentStatus: 'EXTERNAL_ATTACHED', specimenStatus: 'available', quarantineReason: null, importedBy: 'coord-1',
    });
    expect(api.releaseQuarantine).not.toHaveBeenCalled();
  });

  it('does not release when recording the document fails', async () => {
    const api = fakeApi();
    api.update.mockRejectedValue(new Error('boom'));
    await expect(attachExternalDocument(api, { id: 'SPC-1', specimenStatus: 'quarantined' }, { actor: null, reason: 'x', now }))
      .rejects.toThrow('boom');
    expect(api.releaseQuarantine).not.toHaveBeenCalled();
  });
});
