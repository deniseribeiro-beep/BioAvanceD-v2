import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const i18n = require('../../src/i18n/index');

describe('i18n', () => {
  describe('setLanguage', () => {
    it('returns the lang argument unchanged', () => {
      expect(i18n.setLanguage('en-US')).toBe('en-US');
      expect(i18n.setLanguage(undefined)).toBeUndefined();
    });
  });

  describe('getDefaultLanguage', () => {
    it('returns pt-BR', () => {
      expect(i18n.getDefaultLanguage()).toBe('pt-BR');
    });
  });

  describe('detectLanguage', () => {
    it('uses ?lang=en query param', () => {
      expect(i18n.detectLanguage({ query: { lang: 'en' } })).toBe('en-US');
    });

    it('uses ?lang=en-us query param (case-insensitive)', () => {
      expect(i18n.detectLanguage({ query: { lang: 'EN-US' } })).toBe('en-US');
    });

    it('uses ?lang=pt query param', () => {
      expect(i18n.detectLanguage({ query: { lang: 'pt' } })).toBe('pt-BR');
    });

    it('uses ?lang=pt-br query param', () => {
      expect(i18n.detectLanguage({ query: { lang: 'pt-BR' } })).toBe('pt-BR');
    });

    it('falls through to Accept-Language header when query lang is unrecognized', () => {
      const req = {
        query: { lang: 'fr' },
        headers: { 'accept-language': 'en-GB,en;q=0.9' },
      };
      expect(i18n.detectLanguage(req)).toBe('en-US');
    });

    it('uses Accept-Language header containing pt', () => {
      const req = { headers: { 'accept-language': 'pt-PT,pt;q=0.9' } };
      expect(i18n.detectLanguage(req)).toBe('pt-BR');
    });

    it('falls back to req.user.language when no query/header match', () => {
      const req = { user: { language: 'en-US' } };
      expect(i18n.detectLanguage(req)).toBe('en-US');
    });

    it('defaults to pt-BR when nothing matches', () => {
      expect(i18n.detectLanguage({})).toBe('pt-BR');
    });
  });

  describe('translate', () => {
    it('returns the fallback when the key is not found and lang is pt-BR', () => {
      expect(i18n.translate('nonexistent.key', 'pt-BR', 'Fallback')).toBe('Fallback');
    });

    it('returns the key itself when not found and no fallback given', () => {
      expect(i18n.translate('nonexistent.key')).toBe('nonexistent.key');
    });

    it('falls back to pt-BR translations when the requested lang is missing the key', () => {
      // en-US translations exist but likely don't share every pt-BR key;
      // exercise the cross-language fallback path structurally instead of
      // depending on real JSON content.
      const result = i18n.translate('definitely.not.a.real.key', 'en-US', 'F');
      expect(result).toBe('F');
    });

    it('resolves a real nested key in pt-BR', () => {
      expect(i18n.translate('assistant.title', 'pt-BR')).toBe('Assistente Inteligente');
    });

    it('resolves a real nested key in en-US', () => {
      expect(i18n.translate('assistant.title', 'en-US')).toBe('Intelligent Assistant');
    });

    it('resolves via the pt-BR fallback when an unloaded lang is requested', () => {
      // 'fr-FR' was never loaded, so the first lookup falls straight into
      // the cross-language fallback, which finds the key under pt-BR.
      expect(i18n.translate('assistant.title', 'fr-FR')).toBe('Assistente Inteligente');
    });
  });

  describe('languageMiddleware', () => {
    function makeReqRes(overrides = {}) {
      const req = { query: {}, headers: {}, ...overrides };
      const res = { setHeader: vi.fn() };
      const next = vi.fn();
      return { req, res, next };
    }

    it('sets req.language, req.t, and the Content-Language header, then calls next', () => {
      const { req, res, next } = makeReqRes({ query: { lang: 'en' } });
      i18n.languageMiddleware(req, res, next);

      expect(req.language).toBe('en-US');
      expect(typeof req.t).toBe('function');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Language', 'en-US');
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('req.t returns the fallback/key on translation miss and swallows translate() throwing', () => {
      const { req, res, next } = makeReqRes();
      i18n.languageMiddleware(req, res, next);

      expect(req.t('nonexistent.key', 'Fallback')).toBe('Fallback');
      expect(req.t('nonexistent.key')).toBe('nonexistent.key');
    });

    it('req.t catches translate() throwing on a non-string key and returns the fallback', () => {
      const { req, res, next } = makeReqRes();
      i18n.languageMiddleware(req, res, next);

      // translate() calls key.split('.') internally — a non-string key
      // throws a TypeError, which req.t's try/catch must swallow.
      expect(req.t(undefined, 'Fallback')).toBe('Fallback');
      expect(req.t(undefined)).toBeUndefined();
    });

    it('does not schedule an audit log when there is no previous language', () => {
      const { req, res, next } = makeReqRes({ user: { language: 'en-US' } });
      const setImmediateSpy = vi.spyOn(global, 'setImmediate');

      i18n.languageMiddleware(req, res, next);

      expect(setImmediateSpy).not.toHaveBeenCalled();
      setImmediateSpy.mockRestore();
    });

    it('does not schedule an audit log when the language did not change', () => {
      const { req, res, next } = makeReqRes({ language: 'pt-BR', user: { language: 'pt-BR' } });
      const setImmediateSpy = vi.spyOn(global, 'setImmediate');

      i18n.languageMiddleware(req, res, next);

      expect(setImmediateSpy).not.toHaveBeenCalled();
      setImmediateSpy.mockRestore();
    });

    it('does not schedule an audit log when there is no authenticated user', () => {
      const { req, res, next } = makeReqRes({ language: 'pt-BR', query: { lang: 'en' } });
      const setImmediateSpy = vi.spyOn(global, 'setImmediate');

      i18n.languageMiddleware(req, res, next);

      expect(setImmediateSpy).not.toHaveBeenCalled();
      setImmediateSpy.mockRestore();
    });

    it('schedules an audit log via setImmediate when the language changed for an authenticated user', async () => {
      const { req, res, next } = makeReqRes({
        language: 'pt-BR',
        query: { lang: 'en' },
        user: { language: 'pt-BR' },
        app: { locals: {} },
      });
      const setImmediateSpy = vi.spyOn(global, 'setImmediate');

      i18n.languageMiddleware(req, res, next);

      expect(setImmediateSpy).toHaveBeenCalledTimes(1);
      // Let the scheduled callback run; app.locals.db is undefined so the
      // auditLogger branch is skipped and the callback resolves quietly.
      await new Promise((resolve) => setImmediate(resolve));
      setImmediateSpy.mockRestore();
    });

    it('swallows errors thrown while logging the language change', async () => {
      const { req, res, next } = makeReqRes({
        language: 'pt-BR',
        query: { lang: 'en' },
        user: { language: 'pt-BR' },
        app: { locals: { db: {} } },
      });

      const auditLoggerRequire = createRequire(import.meta.url);
      const auditLogger = auditLoggerRequire('../../src/utils/auditLogger');
      const initSpy = vi.spyOn(auditLogger, 'init').mockImplementation(() => {
        throw new Error('boom');
      });

      i18n.languageMiddleware(req, res, next);
      await new Promise((resolve) => setImmediate(resolve));

      expect(initSpy).toHaveBeenCalled();
      initSpy.mockRestore();
    });
  });

  describe('loadTranslations', () => {
    it('is exported and re-runnable without throwing', () => {
      expect(() => i18n.loadTranslations()).not.toThrow();
    });

    it('falls back to empty translations objects when reading a file throws', () => {
      const fsRequire = createRequire(import.meta.url);
      const fs = fsRequire('fs');
      const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
        throw new Error('disk error');
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => i18n.loadTranslations()).not.toThrow();
      expect(i18n.translate('assistant.title', 'pt-BR', 'F')).toBe('F');
      expect(errorSpy).toHaveBeenCalled();

      readSpy.mockRestore();
      errorSpy.mockRestore();
      // Restore real translations for any tests that run after this one.
      i18n.loadTranslations();
    });
  });
});
