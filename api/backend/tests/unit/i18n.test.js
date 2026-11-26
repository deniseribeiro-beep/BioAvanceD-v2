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

    // #1422: Brazilian browsers typically list English as a lower-q fallback.
    // The previous includes('en')-before-includes('pt') check picked English.
    it('prefers pt over en when Accept-Language lists both with pt first/higher q', () => {
      const req = { headers: { 'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8' } };
      expect(i18n.detectLanguage(req)).toBe('pt-BR');
    });

    it('prefers the higher-q language when Accept-Language reorders tags', () => {
      const req = { headers: { 'accept-language': 'en;q=0.5,pt-BR;q=0.9' } };
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

    // #1110: these three exercise nested-key resolution and the
    // cross-language fallback; they used assistant.title only as a
    // convenient real key, and that key is gone with the rest of the
    // assistant scaffolding. auth.confirmPassword is the replacement --
    // present in all three locales with a genuinely different value in
    // each, which is what these assertions need.
    it('resolves a real nested key in pt-BR', () => {
      expect(i18n.translate('auth.confirmPassword', 'pt-BR')).toBe('Confirmar Senha');
    });

    it('resolves a real nested key in en-US', () => {
      expect(i18n.translate('auth.confirmPassword', 'en-US')).toBe('Confirm Password');
    });

    it('resolves via the pt-BR fallback when an unloaded lang is requested', () => {
      // 'fr-FR' was never loaded, so the first lookup falls straight into
      // the cross-language fallback, which finds the key under pt-BR.
      expect(i18n.translate('auth.confirmPassword', 'fr-FR')).toBe('Confirmar Senha');
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
    }, 20_000);
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
      expect(i18n.translate('auth.confirmPassword', 'pt-BR', 'F')).toBe('F');
      expect(errorSpy).toHaveBeenCalled();

      readSpy.mockRestore();
      errorSpy.mockRestore();
      // Restore real translations for any tests that run after this one.
      i18n.loadTranslations();
    });
  });

  // #878: es-ES.json was missing `assistant.title`, which pt-BR and en-US
  // both carried. #872, on the same file, was every one of its 150 values
  // being verbatim Portuguese. This suite passed 26/26 through both.
  //
  // #1110 postscript: `assistant.title` is gone from all three locales. It
  // was scaffolding for a feature deleted in 5e571099 and excluded from the
  // current scope by section 10 of the v2.0.0 requirements (its scope
  // exclusion) -- so #878 was maintenance spent on dead
  // code, which is the argument #1110 makes, with #190 as its other
  // instance. The parity checks below are unaffected and are what would now
  // catch the same class of drift.
  //
  // It could, because nothing here compared the locale files to each other
  // -- every test drove translate() against whatever happened to be loaded.
  // These two do the comparison. The first is exact; the second is a
  // heuristic and says so.
  describe('locale parity (#872, #878)', () => {
    const LOCALES = ['pt-BR', 'en-US', 'es-ES'];

    const flatten = (obj, prefix = '') =>
      Object.entries(obj).flatMap(([key, value]) =>
        value && typeof value === 'object'
          ? flatten(value, `${prefix}${key}.`)
          : [[`${prefix}${key}`, value]]
      );

    const load = (locale) =>
      new Map(flatten(require(`../../i18n/${locale}.json`)));

    it('every locale declares exactly the same keys', () => {
      const [reference, ...others] = LOCALES;
      const referenceKeys = [...load(reference).keys()].sort();

      for (const locale of others) {
        expect(
          [...load(locale).keys()].sort(),
          `${locale}.json's key set differs from ${reference}.json's`
        ).toEqual(referenceKeys);
      }
    });

    it('es-ES is not a verbatim copy of pt-BR', () => {
      // Deliberately a threshold, not zero: some words are spelled
      // identically in both languages (Cancelar, Confirmar, Editar,
      // Administrador, Tecnico...), so a strict "no value may match" rule
      // would be wrong. What this catches is the failure that actually
      // happened -- a whole file copied across and never translated, which
      // showed up as 150 of 150 identical.
      const ptBR = load('pt-BR');
      const esES = load('es-ES');

      const identical = [...esES].filter(([key, value]) => ptBR.get(key) === value);
      const ratio = identical.length / esES.size;

      expect(
        ratio,
        `${identical.length}/${esES.size} es-ES values are byte-identical to pt-BR. `
          + 'A handful is expected; a majority means the file was copied, not translated.'
      ).toBeLessThan(0.25);
    });
  });
});
