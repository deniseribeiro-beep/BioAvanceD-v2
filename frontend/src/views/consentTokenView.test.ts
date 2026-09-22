import { describe, expect, it } from 'vitest';
import {
  resolveConsentTokenParams,
  normalizeConsentTemplate,
  mapConsentTokenError,
} from './consentTokenView';

describe('resolveConsentTokenParams', () => {
  it('accepts a well-formed participant id and token', () => {
    expect(resolveConsentTokenParams('00000042', 'a'.repeat(64))).toEqual({
      ok: true,
      participantId: '00000042',
      token: 'a'.repeat(64),
    });
  });

  it('trims surrounding whitespace on both values', () => {
    expect(resolveConsentTokenParams('  00000042 ', ' tok ')).toEqual({
      ok: true,
      participantId: '00000042',
      token: 'tok',
    });
  });

  it('rejects a missing token -- the token is the credential for this page', () => {
    const result = resolveConsentTokenParams('00000042', null);
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty('message');
  });

  it('rejects a missing participant id', () => {
    expect(resolveConsentTokenParams(undefined, 'tok').ok).toBe(false);
  });

  // #805 emailed `/patients/undefined/consent` for as long as buildConsentLink
  // read a field none of its callers carried. Links already in participants'
  // inboxes still have that shape, and 'undefined' is a syntactically valid
  // path segment -- without this guard the page would send the literal string
  // to the backend and surface its generic 'Paciente não encontrado'.
  it('rejects the literal string "undefined" as a participant id (#805 links)', () => {
    const result = resolveConsentTokenParams('undefined', 'tok');
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty('message');
  });

  it('rejects the literal string "null" as a participant id', () => {
    expect(resolveConsentTokenParams('null', 'tok').ok).toBe(false);
  });

  it('rejects the literal string "undefined" as a token', () => {
    expect(resolveConsentTokenParams('00000042', 'undefined').ok).toBe(false);
  });
});

describe('normalizeConsentTemplate', () => {
  it('returns null when the backend reports no active template', () => {
    expect(normalizeConsentTemplate(null)).toBeNull();
    expect(normalizeConsentTemplate(undefined)).toBeNull();
  });

  it('keeps title, content, version and well-formed permissions', () => {
    expect(
      normalizeConsentTemplate({
        id: 'tpl-1',
        title: 'TCLE v2',
        content: 'Termo completo.',
        version: '2.0',
        permissions: [{ key: 'research', label: 'Uso em pesquisa', required: true }],
      })
    ).toEqual({
      id: 'tpl-1',
      title: 'TCLE v2',
      content: 'Termo completo.',
      version: '2.0',
      permissions: [{ key: 'research', label: 'Uso em pesquisa', required: true }],
    });
  });

  it('drops permission entries missing a key or label rather than rendering blanks', () => {
    const template = normalizeConsentTemplate({
      id: 'tpl-1',
      title: 'TCLE v2',
      content: 'Termo.',
      permissions: [
        { key: 'research', label: 'Uso em pesquisa' },
        { key: '', label: 'sem chave' },
        { key: 'sem-label' },
        'nonsense',
      ],
    });
    expect(template?.permissions).toEqual([
      { key: 'research', label: 'Uso em pesquisa', required: false },
    ]);
  });

  it('treats a template with no content as absent -- there is nothing to consent to', () => {
    expect(normalizeConsentTemplate({ id: 'tpl-1', title: 'TCLE', content: '   ' })).toBeNull();
  });

  it('defaults version to null and permissions to an empty list', () => {
    expect(normalizeConsentTemplate({ id: 'tpl-1', title: 'TCLE', content: 'Termo.' })).toEqual({
      id: 'tpl-1',
      title: 'TCLE',
      content: 'Termo.',
      version: null,
      permissions: [],
    });
  });
});

describe('mapConsentTokenError', () => {
  it('reports an invalid or expired link for 400', () => {
    expect(mapConsentTokenError(400)).toMatch(/inválido|expirado/i);
  });

  // A 503 means the failure was ours, not the link's: the term could not be
  // loaded, the token check could not run, or the acceptance could not be
  // written (#1127). Telling the participant their link is bad would send them
  // to request a new one, which would not help in any of the three.
  it('distinguishes a 503 from an invalid link', () => {
    expect(mapConsentTokenError(503)).not.toMatch(/inválido/i);
    expect(mapConsentTokenError(503)).toMatch(/indisponível|tente/i);
  });

  // #1127: the 503 arm's whole job is to stop the participant discarding a
  // working link, so it has to SAY the link still works. The pattern above
  // cannot see that -- it matched the old term-specific wording too, which
  // left the copy free to drift back to describing only the template lookup
  // while three different failures now route here.
  it('tells the participant their link is still valid on a 503', () => {
    expect(mapConsentTokenError(503)).toMatch(/link continua válido/i);
  });

  // The 400 arm keeps the opposite instruction: there the link really is spent.
  it('still sends the participant for a new invitation on a 400', () => {
    expect(mapConsentTokenError(400)).toMatch(/novo convite/i);
  });

  it('falls back to a generic message for an unknown status', () => {
    expect(mapConsentTokenError(undefined)).toBeTruthy();
    expect(mapConsentTokenError(500)).toBeTruthy();
  });
});
