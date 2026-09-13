import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import crypto from 'crypto';

const require = createRequire(import.meta.url);

const mqttSignatureService = require('../../src/services/mqtt-signature.service');

describe('mqtt-signature.service', () => {
  const ORIGINAL_SECRET = process.env.MQTT_SIGNING_SECRET;

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) {
      delete process.env.MQTT_SIGNING_SECRET;
    } else {
      process.env.MQTT_SIGNING_SECRET = ORIGINAL_SECRET;
    }
  });

  describe('getSigningSecret', () => {
    it('returns the trimmed secret when set', () => {
      process.env.MQTT_SIGNING_SECRET = '  my-secret  ';
      expect(mqttSignatureService.getSigningSecret()).toBe('my-secret');
    });

    it('returns null when unset', () => {
      delete process.env.MQTT_SIGNING_SECRET;
      expect(mqttSignatureService.getSigningSecret()).toBeNull();
    });

    it('returns null when set to an empty/whitespace-only string', () => {
      process.env.MQTT_SIGNING_SECRET = '   ';
      expect(mqttSignatureService.getSigningSecret()).toBeNull();
    });
  });

  describe('hashPayload', () => {
    it('hashes a payload deterministically with sha256', () => {
      const expected = crypto.createHash('sha256').update('hello').digest('hex');
      expect(mqttSignatureService.hashPayload('hello')).toBe(expected);
    });

    it('treats a falsy payload as an empty string', () => {
      const emptyHash = mqttSignatureService.hashPayload('');
      expect(mqttSignatureService.hashPayload(undefined)).toBe(emptyHash);
      expect(mqttSignatureService.hashPayload(null)).toBe(emptyHash);
    });
  });

  describe('computeHmac', () => {
    it('returns null when no signing secret is configured', () => {
      delete process.env.MQTT_SIGNING_SECRET;
      expect(mqttSignatureService.computeHmac('payload')).toBeNull();
    });

    it('computes an hmac-sha256 hex digest when a secret is configured', () => {
      process.env.MQTT_SIGNING_SECRET = 'test-secret';
      const hmac = mqttSignatureService.computeHmac('payload');
      expect(hmac).toMatch(/^[0-9a-f]{64}$/);
    });

    it('treats a falsy payload as an empty string', () => {
      process.env.MQTT_SIGNING_SECRET = 'test-secret';
      expect(mqttSignatureService.computeHmac(undefined)).toBe(mqttSignatureService.computeHmac(''));
    });
  });

  describe('verifyHmac', () => {
    beforeEach(() => {
      process.env.MQTT_SIGNING_SECRET = 'test-secret';
    });

    it('returns false when no signing secret is configured', () => {
      delete process.env.MQTT_SIGNING_SECRET;
      const signature = 'aa'.repeat(32);
      expect(mqttSignatureService.verifyHmac('payload', signature)).toBe(false);
    });

    it('returns false when no signature is provided', () => {
      expect(mqttSignatureService.verifyHmac('payload', undefined)).toBe(false);
      expect(mqttSignatureService.verifyHmac('payload', '')).toBe(false);
    });

    it('returns false when the signature length does not match the expected digest', () => {
      expect(mqttSignatureService.verifyHmac('payload', 'aa')).toBe(false);
    });

    it('returns true for a matching signature', () => {
      const expected = mqttSignatureService.computeHmac('payload');
      expect(mqttSignatureService.verifyHmac('payload', expected)).toBe(true);
    });

    it('tolerates surrounding whitespace in the provided signature', () => {
      const expected = mqttSignatureService.computeHmac('payload');
      expect(mqttSignatureService.verifyHmac('payload', `  ${expected}  `)).toBe(true);
    });

    it('returns false for a same-length but incorrect signature', () => {
      const expected = mqttSignatureService.computeHmac('payload');
      const tampered = expected.slice(0, -2) + (expected.slice(-2) === '00' ? '11' : '00');
      expect(mqttSignatureService.verifyHmac('payload', tampered)).toBe(false);
    });
  });
});
