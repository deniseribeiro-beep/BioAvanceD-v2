import { describe, expect, it } from 'vitest';
import {
  buildConsentUpdatePayload,
  buildRevokeAllAnswers,
  mapEConsentError,
  mapEConsentRequestError,
  mapEConsentSubmitError,
  mapEConsentSubmitRequestError,
  normalizeEConsentResponses,
  normalizeEConsentSnapshot,
  normalizeEConsentTemplate,
} from './eConsentView';

// #822: helpers behind EConsentPage / EConsentImportPage, extracted so the
// parsing rules are testable without rendering (this repo's frontend
// convention). Same split as consentTokenView.test.ts (#809).

const PERMISSIONS = [
  { key: 'research', label: 'Uso em pesquisa', required: true },
  { key: 'sharing', label: 'Compartilhamento internacional' },
];

describe('normalizeEConsentTemplate', () => {
  it('keeps well-formed permissions and defaults `required` to false', () => {
    const template = normalizeEConsentTemplate({ id: 'abc', title: 'TCLE v3', permissions: PERMISSIONS });

    expect(template).toEqual({
      id: 'abc',
      title: 'TCLE v3',
      permissions: [
        { key: 'research', label: 'Uso em pesquisa', required: true },
        { key: 'sharing', label: 'Compartilhamento internacional', required: false },
      ],
    });
  });

  it('drops permissions missing a key or a label rather than rendering a blank checkbox', () => {
    const template = normalizeEConsentTemplate({
      id: 'abc',
      permissions: [...PERMISSIONS, { key: '', label: 'sem chave' }, { key: 'sem-label', label: '   ' }],
    });

    expect(template?.permissions.map((p) => p.key)).toEqual(['research', 'sharing']);
  });

  it('falls back to a generic title when none is given', () => {
    expect(normalizeEConsentTemplate({ id: 'abc', permissions: PERMISSIONS })?.title).toBe(
      'Termo de Consentimento'
    );
  });

  it('returns null when no permission survives -- there is nothing to manifest about', () => {
    expect(normalizeEConsentTemplate({ id: 'abc', permissions: [] })).toBeNull();
    expect(normalizeEConsentTemplate({ id: 'abc', permissions: [{ key: '', label: '' }] })).toBeNull();
  });

  it('returns null for a non-object, including the HTML string #822 used to produce', () => {
    expect(normalizeEConsentTemplate(null)).toBeNull();
    expect(normalizeEConsentTemplate(undefined)).toBeNull();
    expect(normalizeEConsentTemplate('<!DOCTYPE html><html lang="pt-BR">')).toBeNull();
  });
});

describe('normalizeEConsentResponses', () => {
  it('keeps booleans', () => {
    expect(normalizeEConsentResponses({ research: true, sharing: false })).toEqual({
      research: true,
      sharing: false,
    });
  });

  it('drops non-booleans so a truthy stale value cannot pre-tick a box', () => {
    expect(normalizeEConsentResponses({ research: 'ACCEPTED', sharing: 1, futureContact: true })).toEqual(
      { futureContact: true }
    );
  });

  it('returns {} for absent or non-object input', () => {
    expect(normalizeEConsentResponses(undefined)).toEqual({});
    expect(normalizeEConsentResponses(null)).toEqual({});
    expect(normalizeEConsentResponses(['research'])).toEqual({});
  });
});

describe('normalizeEConsentSnapshot', () => {
  it('reads the participant name, template and prior answers together', () => {
    const snapshot = normalizeEConsentSnapshot({
      patient: { patientName: '  Maria Silva  ' },
      template: { id: 'abc', title: 'TCLE v3', permissions: PERMISSIONS },
      responses: { research: true },
    });

    expect(snapshot.patientName).toBe('Maria Silva');
    expect(snapshot.template?.id).toBe('abc');
    expect(snapshot.responses).toEqual({ research: true });
  });

  it('falls back to "Paciente" when identity resolution returned nothing', () => {
    // RF005/RNF007: patientName comes from ParticipantIdentity, which the
    // route resolves separately and may not find (routes/eConsent.js:50-61).
    expect(normalizeEConsentSnapshot({ patient: {}, template: null }).patientName).toBe('Paciente');
    expect(normalizeEConsentSnapshot({ template: null }).patientName).toBe('Paciente');
  });

  it('survives the index.html body the relative-URL bug used to return', () => {
    const snapshot = normalizeEConsentSnapshot('<!DOCTYPE html><html lang="pt-BR"><head>');

    expect(snapshot).toEqual({ patientName: 'Paciente', template: null, responses: {} });
  });
});

describe('buildConsentUpdatePayload', () => {
  it('sends one entry per declared permission, unticked ones as explicit REVOKED', () => {
    const template = normalizeEConsentTemplate({ id: 'abc', permissions: PERMISSIONS });

    expect(buildConsentUpdatePayload(template, { research: true })).toEqual([
      { key: 'research', status: 'ACCEPTED' },
      { key: 'sharing', status: 'REVOKED' },
    ]);
  });

  it('is driven by the template, so an answer for an unknown key is not sent', () => {
    const template = normalizeEConsentTemplate({ id: 'abc', permissions: PERMISSIONS });

    const payload = buildConsentUpdatePayload(template, { research: true, ghost: true });

    expect(payload.map((entry) => entry.key)).toEqual(['research', 'sharing']);
  });

  it('returns [] with no template rather than posting an empty manifestation', () => {
    expect(buildConsentUpdatePayload(null, { research: true })).toEqual([]);
  });
});

describe('buildRevokeAllAnswers', () => {
  it('sets every declared permission to false', () => {
    const template = normalizeEConsentTemplate({ id: 'abc', permissions: PERMISSIONS });

    expect(buildRevokeAllAnswers(template)).toEqual({ research: false, sharing: false });
  });

  it('returns {} with no template', () => {
    expect(buildRevokeAllAnswers(null)).toEqual({});
  });
});

describe('error mapping', () => {
  it('treats 401/400 as an invalid link on both load and submit', () => {
    expect(mapEConsentError(401)).toMatch(/Link inválido ou expirado/);
    expect(mapEConsentError(400)).toMatch(/Link inválido ou expirado/);
    expect(mapEConsentSubmitError(401)).toMatch(/Link inválido ou expirado/);
  });

  it('distinguishes a missing participant record from a bad token', () => {
    expect(mapEConsentError(404)).toMatch(/Não encontramos seu cadastro/);
  });

  it('does not blame the participant for #820s 422 on submit', () => {
    expect(mapEConsentSubmitError(422)).toMatch(/equipe do biobanco foi notificada/);
  });

  it('falls back to a retry message when there is no status at all', () => {
    expect(mapEConsentError(undefined)).toMatch(/Tente novamente/);
    expect(mapEConsentSubmitError(undefined)).toBe('Erro ao atualizar consentimento.');
  });
});

// #1158: EConsentPage and EConsentImportPage passed `err.response?.status` to
// the mappers above, and in a real outage there is no response: api.ts aborts at
// its own 10s timeout while the backend answers 503 only after 30s. So the
// mapper got `undefined`, and on SUBMIT the participant saw a bare "Erro ao
// atualizar consentimento." -- no retry advice, and no word on whether their
// link still works. Same defect #1152 fixed on ConsentTokenPage.
describe('request error mapping', () => {
  const timeout = { code: 'ECONNABORTED', request: {}, message: 'timeout of 10000ms exceeded' };

  // THE BUG, submit side. Retrying is safe on both routes: /update's JWT is not
  // single-use, and acceptImportConsentToken returns early on an already-signed
  // record. The copy must not claim the consent was NOT recorded, because a slow
  // success can land after the client gave up.
  it('tells the participant their link still works when a submit times out', () => {
    const message = mapEConsentSubmitRequestError(timeout);
    expect(message).toMatch(/link continua válido/i);
    expect(message).toMatch(/tente novamente/i);
    expect(message).not.toMatch(/inválido ou expirado/i);
  });

  it('tells the participant their link still works when loading times out', () => {
    expect(mapEConsentRequestError(timeout)).toMatch(/link continua válido/i);
    expect(mapEConsentRequestError(timeout)).not.toMatch(/inválido ou expirado/i);
  });

  // CONTROL: a real response still decides, unchanged.
  it('still reports a real 401 as an invalid link on load and submit', () => {
    expect(mapEConsentRequestError({ response: { status: 401 } })).toMatch(/Link inválido ou expirado/);
    expect(mapEConsentSubmitRequestError({ response: { status: 401 } })).toMatch(/Link inválido ou expirado/);
  });

  it('still maps a real 422 on submit to the team-notified copy', () => {
    expect(mapEConsentSubmitRequestError({ response: { status: 422 } })).toMatch(/equipe do biobanco foi notificada/);
  });

  // CONTROL: a throw that never reached the network is a fault in the page, not
  // an outage, so it keeps the existing fallback rather than promising anything.
  it('does not promise a working link for an error that never reached the network', () => {
    const bug = new Error('Cannot read properties of undefined');
    expect(mapEConsentRequestError(bug)).not.toMatch(/link continua válido/i);
    expect(mapEConsentSubmitRequestError(bug)).toBe('Erro ao atualizar consentimento.');
  });
});
