import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const sessionService = require('../../src/services/session.service');
const { hashToken } = require('../../src/utils/tokenHash');
const ACTOR_ID = '550e8400-e29b-41d4-a716-446655440001';

afterEach(() => {
  vi.restoreAllMocks();
  sessionService.sessions.clear();
});

describe('session.service item 8 residual branches', () => {
  it('detects Android from the user-agent OS extractor', () => {
    expect(sessionService.extractOS(
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36'
    )).toBe('Android');
  });

  it('keeps the excepted in-memory session during policy-change revocation by token equality', async () => {
    const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const findOne = vi.fn(async ({ actorId }) => (actorId === ACTOR_ID ? { actorId } : null));
    const db = {
      collection: vi.fn((name) => {
        if (name === 'sessions') return { updateMany };
        if (name === 'actors') return { findOne };
        return { findOne, updateMany };
      }),
    };
    const keptToken = 'keep-access-token';
    const dropToken = 'drop-access-token';

    sessionService.sessions.set('keep-sid', {
      token: keptToken,
      tokenHash: 'stale-hash-not-matching',
      userAccountId: 'admin-1',
    });
    sessionService.sessions.set('drop-sid', {
      token: dropToken,
      tokenHash: hashToken(dropToken),
      userAccountId: 'user-2',
    });

    const modified = await sessionService.revokeAllSessionsForPolicyChange(
      db,
      keptToken,
      ACTOR_ID
    );

    expect(modified).toBe(1);
    expect(sessionService.sessions.has('keep-sid')).toBe(true);
    expect(sessionService.sessions.has('drop-sid')).toBe(false);
  });
});
