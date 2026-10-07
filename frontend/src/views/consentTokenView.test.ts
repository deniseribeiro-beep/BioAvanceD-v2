import { describe, expect, it } from 'vitest';
import {
  resolveConsentTokenParams,
  normalizeConsentTemplate,
  mapConsentTokenError,
  mapConsentTokenRequestError,
  initialConsentResponses,
  missingRequiredPermissions,
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

// #821: the page now collects a granular manifestation (RF010) instead of a
// whole-term accept, so the answer set and its required-purpose gate are
// derived here.
describe('initialConsentResponses', () => {
  it('starts every purpose unanswered-as-declined, keyed by permission key', () => {
    expect(initialConsentResponses([
      { key: 'storage', label: 'Armazenamento', required: true },
      { key: 'contact', label: 'Contato', required: false },
    ])).toEqual({ storage: false, contact: false });
  });

  it('is empty for a term with no purposes', () => {
    expect(initialConsentResponses([])).toEqual({});
  });
});

describe('missingRequiredPermissions', () => {
  const permissions = [
    { key: 'storage', label: 'Armazenamento', required: true },
    { key: 'contact', label: 'Contato', required: false },
  ];

  it('names each required purpose not yet accepted', () => {
    expect(missingRequiredPermissions(permissions, { storage: false, contact: true })).toEqual(['Armazenamento']);
  });

  it('is empty once every required purpose is accepted, whatever the optional ones say', () => {
    expect(missingRequiredPermissions(permissions, { storage: true, contact: false })).toEqual([]);
  });
});

describe('mapConsentTokenError', () => {
  // #821: 422 is a good link whose answers could not be recorded as sent --
  // most often the term was republished after the page loaded. Reloading
  // fixes it; a new invitation does not.
  it('asks for a reload, not a new invitation, on a 422', () => {
    expect(mapConsentTokenError(422)).toMatch(/recarregue/i);
    expect(mapConsentTokenError(422)).toMatch(/link continua válido/i);
    expect(mapConsentTokenError(422)).not.toMatch(/novo convite/i);
  });

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

// #1152: the status-only mapper above is reached with `err.response?.status`,
// and in a REAL outage there is no response to take a status from. Measured on a
// live stack: the backend answers 503 after 30s (mongo stopped) or 60s
// (partitioned), while api.ts aborts the request at its own 10s timeout -- so
// axios throws ECONNABORTED with no `response`, the mapper got `undefined`, and
// the participant fell to the generic arm. The 503 copy #1127 shipped was
// unreachable through the UI in exactly the outage it was written for.
describe('mapConsentTokenRequestError', () => {
  // THE BUG. A client-side abort during an outage must still make the one promise
  // that matters -- the link is not spent -- because requesting a new invitation
  // would not help here any more than it would on a 503.
  it('tells the participant their link is still valid when the request times out', () => {
    const timeout = { code: 'ECONNABORTED', request: {}, message: 'timeout of 10000ms exceeded' };
    expect(mapConsentTokenRequestError(timeout)).toMatch(/link continua válido/i);
    expect(mapConsentTokenRequestError(timeout)).not.toMatch(/inválido/i);
    expect(mapConsentTokenRequestError(timeout)).not.toMatch(/novo convite/i);
  });

  // CONTROL: a real response still decides, unchanged. These two are the whole
  // reason this is a new function rather than a change to the mapper above.
  it('still sends the participant for a new invitation on a real 400', () => {
    expect(mapConsentTokenRequestError({ response: { status: 400 } })).toMatch(/novo convite/i);
  });

  it('still reports a real 503 with the 503 copy', () => {
    expect(mapConsentTokenRequestError({ response: { status: 503 } })).toMatch(/link continua válido/i);
  });

  // CONTROL, and the one that pins the DESIGN: a throw with neither a response
  // nor a request is a bug in the page, not an outage. Mapping `undefined` to the
  // 503 copy would have been the smaller diff and would have claimed the service
  // was unavailable every time this page threw for any other reason.
  it('does not claim an outage for an error that never reached the network', () => {
    const bug = new Error('Cannot read properties of undefined');
    expect(mapConsentTokenRequestError(bug)).not.toMatch(/link continua válido/i);
    expect(mapConsentTokenRequestError(bug)).toBeTruthy();
  });
});
