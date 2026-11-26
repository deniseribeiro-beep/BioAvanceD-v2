const {
  isGovbrOidcEnabled,
  createStateBundle,
  parseStateBundle,
  buildAuthorizationUrl,
  exchangeCodeForIdentity,
} = require('../../src/services/govbrOidc.service');

describe('govbrOidc.service', () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
  });

  it('fails closed when CONSENT_GOVBR_OIDC_ENABLED is unset', () => {
    delete process.env.CONSENT_GOVBR_OIDC_ENABLED;
    expect(isGovbrOidcEnabled()).toBe(false);
  });

  it('round-trips state bundles', () => {
    process.env.GOVBR_OIDC_STATE_SECRET = 'test-secret';
    const { state, nonce } = createStateBundle({ participantId: 'P1', token: 'tok' });
    expect(nonce).toHaveLength(32);
    const parsed = parseStateBundle(state);
    expect(parsed.participantId).toBe('P1');
    expect(parsed.token).toBe('tok');
    expect(parsed.nonce).toBe(nonce);
  });

  it('builds authorize URL when enabled and configured', () => {
    process.env.CONSENT_GOVBR_OIDC_ENABLED = 'true';
    process.env.GOVBR_OIDC_CLIENT_ID = 'client';
    process.env.GOVBR_OIDC_REDIRECT_URI = 'https://app.example/callback';
    process.env.GOVBR_OIDC_ISSUER = 'https://sso.staging.acesso.gov.br';
    const url = buildAuthorizationUrl({ state: 'st', nonce: 'nn' });
    expect(url).toContain('client_id=client');
    expect(url).toContain('nonce=nn');
    expect(url).toContain('response_type=code');
  });

  it('returns mock identity when GOVBR_OIDC_MOCK=true', async () => {
    process.env.CONSENT_GOVBR_OIDC_ENABLED = 'true';
    process.env.GOVBR_OIDC_CLIENT_ID = 'client';
    process.env.GOVBR_OIDC_REDIRECT_URI = 'https://app.example/callback';
    process.env.GOVBR_OIDC_MOCK = 'true';
    const identity = await exchangeCodeForIdentity('abc123');
    expect(identity.provider).toBe('govbr');
    expect(identity.mock).toBe(true);
    expect(identity.sub).toContain('mock-govbr');
  });
});
