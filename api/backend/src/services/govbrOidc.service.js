/**
 * gov.br Login Único (OIDC) helpers for remote TCLE identity (ADR 2026-11-26).
 * Fails closed when CONSENT_GOVBR_OIDC_ENABLED is not true.
 */
const crypto = require('crypto');

function isGovbrOidcEnabled() {
  return String(process.env.CONSENT_GOVBR_OIDC_ENABLED || '').toLowerCase() === 'true';
}

function getConfig() {
  return {
    enabled: isGovbrOidcEnabled(),
    clientId: process.env.GOVBR_OIDC_CLIENT_ID || '',
    clientSecret: process.env.GOVBR_OIDC_CLIENT_SECRET || '',
    issuer: (process.env.GOVBR_OIDC_ISSUER || 'https://sso.staging.acesso.gov.br').replace(/\/$/, ''),
    redirectUri: process.env.GOVBR_OIDC_REDIRECT_URI || '',
  };
}

function assertConfigured() {
  const cfg = getConfig();
  if (!cfg.enabled) {
    const err = new Error('gov.br OIDC desabilitado');
    err.statusCode = 503;
    throw err;
  }
  if (!cfg.clientId || !cfg.redirectUri) {
    const err = new Error('gov.br OIDC sem client_id/redirect_uri');
    err.statusCode = 503;
    throw err;
  }
  return cfg;
}

function buildAuthorizationUrl({ state, nonce }) {
  const cfg = assertConfigured();
  const url = new URL(`${cfg.issuer}/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', cfg.redirectUri);
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  return url.toString();
}

function createStateBundle(payload) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const body = Buffer.from(JSON.stringify({ ...payload, nonce, ts: Date.now() }), 'utf8').toString('base64url');
  const secret = process.env.GOVBR_OIDC_STATE_SECRET || process.env.JWT_SECRET || 'govbr-dev-state';
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return { state: `${body}.${sig}`, nonce };
}

function parseStateBundle(state) {
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig) return null;
  const secret = process.env.GOVBR_OIDC_STATE_SECRET || process.env.JWT_SECRET || 'govbr-dev-state';
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Exchange authorization code for tokens. In production this hits gov.br token endpoint.
 * When GOVBR_OIDC_MOCK=true (homolog/dev), returns a deterministic mock identity.
 */
async function exchangeCodeForIdentity(code, fetchImpl = fetch) {
  const cfg = assertConfigured();
  if (String(process.env.GOVBR_OIDC_MOCK || '').toLowerCase() === 'true') {
    return {
      sub: `mock-govbr-${String(code || 'x').slice(0, 12)}`,
      email: 'participante@mock.gov.br',
      name: 'Participante Mock gov.br',
      provider: 'govbr',
      mock: true,
    };
  }
  const tokenUrl = `${cfg.issuer}/token`;
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: String(code || ''),
    redirect_uri: cfg.redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  const resp = await fetchImpl(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!resp.ok) {
    const err = new Error(`gov.br token exchange failed (${resp.status})`);
    err.statusCode = 502;
    throw err;
  }
  const tokens = await resp.json();
  const userinfoUrl = `${cfg.issuer}/userinfo`;
  const ui = await fetchImpl(userinfoUrl, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!ui.ok) {
    const err = new Error(`gov.br userinfo failed (${ui.status})`);
    err.statusCode = 502;
    throw err;
  }
  const profile = await ui.json();
  return {
    sub: String(profile.sub || ''),
    email: profile.email || null,
    name: profile.name || profile.preferred_username || null,
    provider: 'govbr',
    mock: false,
  };
}

module.exports = {
  isGovbrOidcEnabled,
  getConfig,
  buildAuthorizationUrl,
  createStateBundle,
  parseStateBundle,
  exchangeCodeForIdentity,
};
