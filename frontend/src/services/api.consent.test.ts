import { afterEach, describe, expect, it, vi } from 'vitest';
import api, { consentService } from './api';

// #1375 (RF010 AC6): the revoke call carries the operator's scope and reason,
// and the history is read by the consent's _id.
describe('consentService revocation and history', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts the scope and reason to the consent\'s revoke route', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: {} } as any);
    await consentService.revokeConsent('abc', { scope: ['contact'], reason: 'r' });
    expect(post).toHaveBeenCalledWith('/e-consent/consents/abc/revoke', { scope: ['contact'], reason: 'r' });
  });

  it('posts an empty body when no scope is given, which the backend reads as the whole consent', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: {} } as any);
    await consentService.revokeConsent('abc');
    expect(post).toHaveBeenCalledWith('/e-consent/consents/abc/revoke', {});
  });

  it('reads the history from the consent\'s history route', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: {} } as any);
    await consentService.getConsentHistory('abc');
    expect(get).toHaveBeenCalledWith('/e-consent/consents/abc/history');
  });
});
