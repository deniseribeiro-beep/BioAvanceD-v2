import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The UI language: read once at import from a saved choice, else from the
// browser's language, and changed by the language selector. The module keeps
// the language in module state, so each case imports a fresh copy.
async function freshI18n() {
  vi.resetModules();
  return import('./index');
}

function browserLanguage(lang: string) {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(lang);
}

beforeAll(async () => {
  await import('./index');
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('language at import', () => {
  it('takes the saved language without being asked', async () => {
    localStorage.setItem('app_language', 'es-ES');
    browserLanguage('en-US');
    const { getLanguage } = await freshI18n();
    expect(getLanguage()).toBe('es-ES');
  });
});

describe('initLanguage', () => {
  it('returns and keeps a saved supported language over the browser one', async () => {
    browserLanguage('en-US');
    const i18n = await freshI18n();
    localStorage.setItem('app_language', 'es-ES');
    expect(i18n.initLanguage()).toBe('es-ES');
    expect(i18n.getLanguage()).toBe('es-ES');
  });

  it('ignores a saved language it has no translations for and reads the browser', async () => {
    browserLanguage('es-MX');
    const i18n = await freshI18n();
    localStorage.setItem('app_language', 'fr-FR');
    expect(i18n.initLanguage()).toBe('es-ES');
    expect(i18n.getLanguage()).toBe('es-ES');
  });

  it('maps any English browser language to en-US', async () => {
    browserLanguage('pt-BR');
    const i18n = await freshI18n();
    browserLanguage('en-GB');
    expect(i18n.initLanguage()).toBe('en-US');
    expect(i18n.getLanguage()).toBe('en-US');
  });

  it('maps any Spanish browser language to es-ES', async () => {
    browserLanguage('en-US');
    const i18n = await freshI18n();
    browserLanguage('es-AR');
    expect(i18n.initLanguage()).toBe('es-ES');
    expect(i18n.getLanguage()).toBe('es-ES');
  });

  it('falls back to pt-BR for a browser language it does not translate', async () => {
    browserLanguage('en-US');
    const i18n = await freshI18n();
    expect(i18n.getLanguage()).toBe('en-US');
    browserLanguage('de-DE');
    expect(i18n.initLanguage()).toBe('pt-BR');
    expect(i18n.getLanguage()).toBe('pt-BR');
  });

  it('reads a Portuguese browser language as pt-BR', async () => {
    browserLanguage('en-US');
    const i18n = await freshI18n();
    browserLanguage('pt-PT');
    expect(i18n.initLanguage()).toBe('pt-BR');
    expect(i18n.getLanguage()).toBe('pt-BR');
  });
});

describe('setLanguage', () => {
  it('switches the current language and saves it for the next load', async () => {
    browserLanguage('pt-BR');
    const i18n = await freshI18n();
    expect(i18n.getLanguage()).toBe('pt-BR');

    i18n.setLanguage('en-US');

    expect(i18n.getLanguage()).toBe('en-US');
    expect(localStorage.getItem('app_language')).toBe('en-US');
    const reloaded = await freshI18n();
    expect(reloaded.getLanguage()).toBe('en-US');
  });
});
