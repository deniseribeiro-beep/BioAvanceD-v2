import { describe, it, expect } from 'vitest';
const sessionService = require('../../src/services/session.service');

describe('SessionService.getTokenHash', () => {
  it('returns 64-char hex string', () => {
    const hash = sessionService.getTokenHash('test-token');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic for same input', () => {
    expect(sessionService.getTokenHash('abc')).toBe(sessionService.getTokenHash('abc'));
  });

  it('differs for different tokens', () => {
    expect(sessionService.getTokenHash('token-a')).not.toBe(sessionService.getTokenHash('token-b'));
  });

  it('handles null gracefully', () => {
    expect(() => sessionService.getTokenHash(null)).not.toThrow();
    expect(sessionService.getTokenHash(null)).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('SessionService.extractBrowser', () => {
  it('returns Desconhecido for null', () => {
    expect(sessionService.extractBrowser(null)).toBe('Desconhecido');
  });

  it('detects Chrome', () => {
    expect(sessionService.extractBrowser('Mozilla/5.0 Chrome/110.0.0.0')).toBe('Chrome');
  });

  it('detects Edge (prioritized over Chrome)', () => {
    expect(sessionService.extractBrowser('Mozilla/5.0 Chrome/110 Edg/110.0')).toBe('Edge');
  });

  it('detects Firefox', () => {
    expect(sessionService.extractBrowser('Mozilla/5.0 Firefox/109.0')).toBe('Firefox');
  });

  it('detects Safari (no Chrome)', () => {
    expect(sessionService.extractBrowser('Mozilla/5.0 Safari/605.1.15')).toBe('Safari');
  });

  it('returns Desconhecido for unknown UA', () => {
    expect(sessionService.extractBrowser('SomeOtherBrowser/1.0')).toBe('Desconhecido');
  });
});

describe('SessionService.extractOS', () => {
  it('returns Desconhecido for null', () => {
    expect(sessionService.extractOS(null)).toBe('Desconhecido');
  });

  it('detects Windows', () => {
    expect(sessionService.extractOS('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows');
  });

  it('detects macOS', () => {
    expect(sessionService.extractOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('macOS');
  });

  it('detects iOS for iPhone', () => {
    expect(sessionService.extractOS('Mozilla/5.0 (iPhone; CPU iPhone OS 14_0)')).toBe('iOS');
  });

  it('detects iOS for iPad', () => {
    expect(sessionService.extractOS('Mozilla/5.0 (iPad; CPU OS 14_0)')).toBe('iOS');
  });

  it('detects Linux', () => {
    expect(sessionService.extractOS('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Linux');
  });
});

describe('SessionService.extractDeviceName', () => {
  it('returns Dispositivo Desconhecido for null', () => {
    expect(sessionService.extractDeviceName(null)).toBe('Dispositivo Desconhecido');
  });

  it('returns Dispositivo Móvel for mobile UA', () => {
    expect(sessionService.extractDeviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 14)')).toBe('Dispositivo Móvel');
  });

  it('returns Dispositivo Móvel for Android', () => {
    expect(sessionService.extractDeviceName('Mozilla/5.0 (Linux; Android 11)')).toBe('Dispositivo Móvel');
  });

  it('returns Desktop for non-mobile UA', () => {
    expect(sessionService.extractDeviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Desktop');
  });
});

describe('SessionService.extractClientInfo', () => {
  it('returns N/A ip and Desconhecido defaults for null req', () => {
    const result = sessionService.extractClientInfo(null);
    expect(result.ipAddress).toBe('N/A');
    expect(result.userAgent).toBeNull();
    expect(result.deviceInfo.browser).toBe('Desconhecido');
    expect(result.deviceInfo.os).toBe('Desconhecido');
  });

  it('extracts ip from x-forwarded-for header', () => {
    const req = {
      headers: { 'x-forwarded-for': '192.168.1.1, 10.0.0.1', 'user-agent': 'Chrome/110' },
      ip: null,
    };
    const result = sessionService.extractClientInfo(req);
    expect(result.ipAddress).toBe('192.168.1.1');
  });

  it('extracts user-agent info', () => {
    const req = {
      headers: { 'user-agent': 'Mozilla/5.0 Chrome/110.0.0.0' },
      ip: '127.0.0.1',
    };
    const result = sessionService.extractClientInfo(req);
    expect(result.userAgent).toContain('Chrome');
    expect(result.deviceInfo.browser).toBe('Chrome');
  });
});
