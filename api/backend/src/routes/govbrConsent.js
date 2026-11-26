const express = require('express');
const router = express.Router();
const govbr = require('../services/govbrOidc.service');

/**
 * Public TCLE channel helpers for gov.br OIDC (ADR 2026-11-26).
 * GET  /api/e-consent/govbr/status
 * POST /api/e-consent/govbr/start   { participantId, token }
 * GET  /api/e-consent/govbr/callback?code&state
 */

router.get('/status', (_req, res) => {
  const cfg = govbr.getConfig();
  return res.json({
    enabled: cfg.enabled,
    issuer: cfg.enabled ? cfg.issuer : null,
    mock: String(process.env.GOVBR_OIDC_MOCK || '').toLowerCase() === 'true',
  });
});

router.post('/start', (req, res) => {
  try {
    const participantId = String(req.body?.participantId || req.body?.patientId || '').trim();
    const token = String(req.body?.token || '').trim();
    if (!participantId || !token) {
      return res.status(400).json({ error: 'participantId and token required' });
    }
    const { state, nonce } = govbr.createStateBundle({ participantId, token });
    const authorizationUrl = govbr.buildAuthorizationUrl({ state, nonce });
    return res.json({ authorizationUrl, state });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.get('/callback', async (req, res) => {
  try {
    const code = String(req.query?.code || '');
    const state = String(req.query?.state || '');
    const parsed = govbr.parseStateBundle(state);
    if (!parsed?.participantId || !parsed?.token) {
      return res.status(400).json({ error: 'invalid state' });
    }
    const identity = await govbr.exchangeCodeForIdentity(code);
    // Return JSON for SPA consumption; production may redirect to the consent page with a one-time code.
    return res.json({
      success: true,
      participantId: parsed.participantId,
      identityProof: {
        provider: 'govbr',
        sub: identity.sub,
        email: identity.email,
        name: identity.name,
        mock: Boolean(identity.mock),
        verifiedAt: new Date().toISOString(),
      },
      // Client must still call consent-tokens/accept with this proof + location.
      resumeTokenHint: parsed.token ? 'use_original_token' : null,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
});

module.exports = router;
