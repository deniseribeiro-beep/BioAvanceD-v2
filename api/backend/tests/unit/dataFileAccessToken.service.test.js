import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const {
  FILE_ACCESS_TOKEN_TTL_SECONDS,
  issueFileAccessToken,
  verifyFileAccessToken
} = require('../../src/services/dataFileAccessToken.service');

// RNF029 C5 (#1321): a DataFile download is a short-lived signed token for
// one file. These cases pin its shape, its expiry and every refusal.
const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);

function issue(overrides = {}) {
  return issueFileAccessToken({
    collection: 'datasetFiles',
    fileRecord: { _id: new ObjectId(), storageUri: 'objstore://datasets/ds-1/sha256/' + 'a'.repeat(64) },
    userId: 'u-1',
    now: NOW,
    ...overrides
  });
}

function flipLast(text) {
  const last = text.slice(-1);
  return text.slice(0, -1) + (last === 'A' ? 'B' : 'A');
}

function signWith(key, encodedPayload) {
  return crypto.createHmac('sha256', key).update(encodedPayload).digest('base64url');
}

const RIGHT_KEY = crypto.createHmac('sha256', process.env.JWT_SECRET).update('bioavanced:data-file-access-token:v1').digest();

describe('dataFileAccessToken.service', () => {
  it('issues a two-part token that verifies to its payload', () => {
    const fileId = new ObjectId();
    const storageUri = 'objstore://samples/s-1/sha256/' + 'b'.repeat(64);
    const { token, tokenId, expiresAt } = issue({ collection: 'sample_files', fileRecord: { _id: fileId, storageUri } });

    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(tokenId).toMatch(/^[0-9a-f]{32}$/);
    expect(expiresAt.getTime()).toBe(Math.floor(NOW / 1000) * 1000 + FILE_ACCESS_TOKEN_TTL_SECONDS * 1000);

    const result = verifyFileAccessToken(token, { now: NOW });
    expect(result).toEqual({
      ok: true,
      payload: { v: 1, c: 'sample_files', f: fileId.toHexString(), u: storageUri, s: 'u-1', j: tokenId, exp: Math.floor(NOW / 1000) + 60 }
    });
  });

  it('is expired at exp exactly and after it, and valid one second before', () => {
    const { token } = issue();
    const expMs = (Math.floor(NOW / 1000) + FILE_ACCESS_TOKEN_TTL_SECONDS) * 1000;

    expect(verifyFileAccessToken(token, { now: expMs - 1000 }).ok).toBe(true);
    expect(verifyFileAccessToken(token, { now: expMs })).toEqual({ ok: false, reason: 'expired' });
    expect(verifyFileAccessToken(token, { now: expMs + 3600 * 1000 })).toEqual({ ok: false, reason: 'expired' });
  });

  it('refuses one flipped character in the signature', () => {
    const { token } = issue();
    expect(verifyFileAccessToken(flipLast(token), { now: NOW })).toEqual({ ok: false, reason: 'invalid' });
  });

  it('refuses one flipped character in the payload', () => {
    const { token } = issue();
    const [payloadPart, signature] = token.split('.');
    const tampered = `${flipLast(payloadPart)}.${signature}`;
    expect(verifyFileAccessToken(tampered, { now: NOW })).toEqual({ ok: false, reason: 'invalid' });
  });

  it('refuses a payload rewritten to name another file under the original signature', () => {
    const { token } = issue();
    const [payloadPart, signature] = token.split('.');
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    const rewritten = Buffer.from(JSON.stringify({ ...payload, f: new ObjectId().toHexString() })).toString('base64url');
    expect(verifyFileAccessToken(`${rewritten}.${signature}`, { now: NOW })).toEqual({ ok: false, reason: 'invalid' });
  });

  it('refuses a payload signed with another key', () => {
    const { token } = issue();
    const [payloadPart] = token.split('.');
    const otherKey = crypto.createHmac('sha256', 'another-secret').update('bioavanced:data-file-access-token:v1').digest();
    expect(verifyFileAccessToken(`${payloadPart}.${signWith(otherKey, payloadPart)}`, { now: NOW }))
      .toEqual({ ok: false, reason: 'invalid' });
  });

  it('refuses a three-part string and a JWT signed with JWT_SECRET', () => {
    const { token } = issue();
    expect(verifyFileAccessToken(`${token}.extra`, { now: NOW })).toEqual({ ok: false, reason: 'invalid' });

    const sessionJwt = jwt.sign({ userID: 'u-1', accessType: 4 }, process.env.JWT_SECRET, { expiresIn: '1h' });
    expect(verifyFileAccessToken(sessionJwt, { now: NOW })).toEqual({ ok: false, reason: 'invalid' });
  });

  it('refuses an empty string, null, a non-string and a 3000-character string without throwing', () => {
    expect(verifyFileAccessToken('', { now: NOW })).toEqual({ ok: false, reason: 'invalid' });
    expect(verifyFileAccessToken(null, { now: NOW })).toEqual({ ok: false, reason: 'invalid' });
    expect(verifyFileAccessToken(['a.b', 'c.d'], { now: NOW })).toEqual({ ok: false, reason: 'invalid' });
    expect(verifyFileAccessToken('A'.repeat(1500) + '.' + 'B'.repeat(1499), { now: NOW })).toEqual({ ok: false, reason: 'invalid' });
  });

  it('throws on issue for a collection outside the three file collections', () => {
    expect(() => issue({ collection: 'users' })).toThrow();
    expect(() => issue({ collection: 'widgetFiles' })).toThrow();
  });

  it('refuses a payload re-signed with the right key whose collection is not a file collection', () => {
    const payload = { v: 1, c: 'users', f: new ObjectId().toHexString(), u: null, s: null, j: 'f'.repeat(32), exp: Math.floor(NOW / 1000) + 60 };
    const payloadPart = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const resigned = `${payloadPart}.${signWith(RIGHT_KEY, payloadPart)}`;

    expect(verifyFileAccessToken(resigned, { now: NOW })).toEqual({ ok: false, reason: 'invalid' });

    // CONTROL: the same payload with a file collection verifies, so the
    // refusal above is the collection's, not the signature's.
    const allowedPart = Buffer.from(JSON.stringify({ ...payload, c: 'assayFiles' })).toString('base64url');
    expect(verifyFileAccessToken(`${allowedPart}.${signWith(RIGHT_KEY, allowedPart)}`, { now: NOW }).ok).toBe(true);
  });
});
