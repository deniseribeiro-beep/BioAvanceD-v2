const crypto = require('crypto');
const env = require('../config/env');
const { currentRequestId, requestIdHeaders } = require('../utils/requestContext');

const TIMESTAMP_STATES = Object.freeze({
  PENDING: 'PENDING',
  ANCHORED: 'ANCHORED',
  VERIFIED: 'VERIFIED',
  RETRYING: 'RETRYING',
  FAILED: 'FAILED',
});

function normalizeMode(mode) {
  const value = String(mode || env.AUDIT_RFC3161_MODE || 'disabled').trim().toLowerCase();
  if (['disabled', 'mock', 'remote'].includes(value)) return value;
  return 'disabled';
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function nowIso() {
  return new Date().toISOString();
}

class Rfc3161AdapterService {
  mode() {
    return normalizeMode();
  }

  async anchorEnvelopeDigest({ envelopeDigestSha256, envelopeDigestBase64 }) {
    const mode = this.mode();
    if (mode === 'disabled') {
      return {
        mode,
        status: TIMESTAMP_STATES.VERIFIED,
        token: null,
        tsa: null,
        messageImprint: envelopeDigestSha256,
        anchoredAt: null,
        verifiedAt: nowIso(),
      };
    }

    if (mode === 'mock') {
      const tokenPayload = `${envelopeDigestSha256}:${nowIso()}`;
      return {
        mode,
        status: TIMESTAMP_STATES.ANCHORED,
        token: Buffer.from(`mock-tsa:${tokenPayload}`, 'utf8').toString('base64'),
        tsa: 'mock://tsa',
        messageImprint: envelopeDigestSha256,
        anchoredAt: nowIso(),
        verifiedAt: null,
      };
    }

    const tsaUrl = String(env.AUDIT_RFC3161_TSA_URL || '').trim();
    if (!tsaUrl) {
      return {
        mode,
        status: TIMESTAMP_STATES.FAILED,
        token: null,
        tsa: null,
        messageImprint: envelopeDigestSha256,
        anchoredAt: null,
        verifiedAt: null,
        error: 'missing_tsa_url',
      };
    }

    try {
      const response = await fetch(tsaUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(env.AUDIT_RFC3161_TSA_AUTH_TOKEN ? { authorization: `Bearer ${env.AUDIT_RFC3161_TSA_AUTH_TOKEN}` } : {}),
          // #1468 (RNF015 C3): the caller's request or job id, so the call can be tied to it.
          ...(requestIdHeaders(currentRequestId()) || {}),
        },
        body: JSON.stringify({
          messageImprint: envelopeDigestBase64,
          hashAlgorithm: 'SHA-256',
        }),
      });

      if (!response.ok) {
        return {
          mode,
          status: TIMESTAMP_STATES.FAILED,
          token: null,
          tsa: tsaUrl,
          messageImprint: envelopeDigestSha256,
          anchoredAt: null,
          verifiedAt: null,
          error: `tsa_http_${response.status}`,
        };
      }

      const body = await response.json();
      const token = String(body.token || '').trim();
      const messageImprint = String(body.messageImprint || '').trim();
      if (!token || !messageImprint) {
        return {
          mode,
          status: TIMESTAMP_STATES.FAILED,
          token: null,
          tsa: tsaUrl,
          messageImprint: envelopeDigestSha256,
          anchoredAt: null,
          verifiedAt: null,
          error: 'invalid_tsa_response',
        };
      }

      return {
        mode,
        status: TIMESTAMP_STATES.ANCHORED,
        token,
        tsa: String(body.tsa || tsaUrl),
        messageImprint: sha256Hex(messageImprint),
        anchoredAt: String(body.anchoredAt || nowIso()),
        verifiedAt: null,
      };
    } catch (error) {
      return {
        mode,
        status: TIMESTAMP_STATES.FAILED,
        token: null,
        tsa: tsaUrl,
        messageImprint: envelopeDigestSha256,
        anchoredAt: null,
        verifiedAt: null,
        error: 'tsa_unavailable',
      };
    }
  }

  verifyTimestamp({ envelopeDigestSha256, timestamp, replayDetected = false }) {
    const mode = this.mode();
    if (mode === 'disabled') {
      return { ok: true, status: TIMESTAMP_STATES.VERIFIED, reason: null };
    }

    if (!timestamp) {
      return { ok: false, status: TIMESTAMP_STATES.FAILED, reason: 'missing_timestamp' };
    }

    if (replayDetected) {
      return { ok: false, status: TIMESTAMP_STATES.FAILED, reason: 'token_replay_detected' };
    }

    if (!timestamp.token || !timestamp.messageImprint) {
      return { ok: false, status: TIMESTAMP_STATES.FAILED, reason: 'invalid_timestamp_material' };
    }

    if (mode === 'mock') {
      const decoded = Buffer.from(String(timestamp.token), 'base64').toString('utf8');
      if (!decoded.startsWith('mock-tsa:')) {
        return { ok: false, status: TIMESTAMP_STATES.FAILED, reason: 'invalid_mock_token' };
      }
      if (timestamp.messageImprint !== envelopeDigestSha256) {
        return { ok: false, status: TIMESTAMP_STATES.FAILED, reason: 'message_imprint_mismatch' };
      }
      return { ok: true, status: TIMESTAMP_STATES.VERIFIED, reason: null, verifiedAt: nowIso() };
    }

    if (timestamp.messageImprint !== envelopeDigestSha256) {
      return { ok: false, status: TIMESTAMP_STATES.FAILED, reason: 'message_imprint_mismatch' };
    }

    return { ok: true, status: TIMESTAMP_STATES.VERIFIED, reason: null, verifiedAt: nowIso() };
  }
}

module.exports = new Rfc3161AdapterService();
module.exports.TIMESTAMP_STATES = TIMESTAMP_STATES;
