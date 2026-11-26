import { describe, it, expect } from 'vitest';
import { normalizeMovementList, parseComplianceError } from './sampleMovements.shared';

// The movement list and custody-report hooks both read the movements
// endpoint through these two helpers: the list normaliser accepts the
// wrapped and the bare payload, and the error parser maps the backend's
// compliance refusals to their audit codes.
describe('normalizeMovementList', () => {
  it('reads the items of a payload wrapped in data', () => {
    const list = normalizeMovementList({ data: [{ _id: 'm1', type: 'TRANSFER' }] });
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('m1');
    expect(list[0].type).toBe('TRANSFER');
  });

  it('reads a bare array payload', () => {
    const list = normalizeMovementList([{ id: 'm2' }, { id: 'm3' }]);
    expect(list.map((item) => item.id)).toEqual(['m2', 'm3']);
  });

  it.each([
    ['null', null],
    ['an object without data', {}],
    ['a non-array data field', { data: 'nope' }],
    ['a string', 'payload'],
  ])('returns an empty list for %s', (_label, payload) => {
    expect(normalizeMovementList(payload)).toEqual([]);
  });

  it('takes each field from its first non-empty source', () => {
    const [item] = normalizeMovementList([
      {
        _id: 'primary',
        id: 'secondary',
        timestamp: '2026-01-01T00:00:00Z',
        createdAt: '2025-01-01T00:00:00Z',
        type: 'CHECKOUT',
        responsibleName: 'Ana',
        responsible: 'Bruno',
        details: 'Saída para análise',
        description: 'ignored',
        metadata: { freezer: 'F2' },
      },
    ]);
    expect(item).toEqual({
      id: 'primary',
      timestamp: '2026-01-01T00:00:00Z',
      type: 'CHECKOUT',
      responsible: 'Ana',
      details: 'Saída para análise',
      metadata: { freezer: 'F2' },
    });
  });

  it('stringifies a numeric id', () => {
    const [item] = normalizeMovementList([{ id: 42 }]);
    expect(item.id).toBe('42');
  });

  it.each([
    ['responsible', { responsible: 'R' }, 'R'],
    ['operatorName', { operatorName: 'O' }, 'O'],
    ['userAnonId', { userAnonId: 'anon-1' }, 'anon-1'],
    ['user', { user: 'U' }, 'U'],
  ])('falls back to %s for the responsible', (_label, raw, expected) => {
    expect(normalizeMovementList([raw])[0].responsible).toBe(expected);
  });

  it('keeps operatorName ahead of userAnonId and user for the responsible', () => {
    const [item] = normalizeMovementList([{ operatorName: 'O', userAnonId: 'A', user: 'U' }]);
    expect(item.responsible).toBe('O');
  });

  it.each([
    ['description', { description: 'D' }, 'D'],
    ['observations', { observations: 'O' }, 'O'],
    ['note', { note: 'N' }, 'N'],
  ])('falls back to %s for the details', (_label, raw, expected) => {
    expect(normalizeMovementList([raw])[0].details).toBe(expected);
  });

  it('keeps description ahead of observations and note for the details', () => {
    const [item] = normalizeMovementList([{ description: 'D', observations: 'O', note: 'N' }]);
    expect(item.details).toBe('D');
  });

  it('falls back to createdAt, then date, for the timestamp', () => {
    const list = normalizeMovementList([
      { createdAt: '2026-02-02' },
      { date: '2026-03-03' },
    ]);
    expect(list[0].timestamp).toBe('2026-02-02');
    expect(list[1].timestamp).toBe('2026-03-03');
  });

  it('keeps createdAt ahead of date for the timestamp', () => {
    const [item] = normalizeMovementList([{ createdAt: 'c', date: 'd' }]);
    expect(item.timestamp).toBe('c');
  });

  it('builds an id from the timestamp, createdAt or a placeholder and the index', () => {
    const list = normalizeMovementList([
      { timestamp: 't0' },
      { createdAt: 'c1' },
      { type: 'X' },
    ]);
    expect(list.map((item) => item.id)).toEqual(['t0-0', 'c1-1', 'movement-2']);
  });

  it('fills every missing field of an empty or null item with a dash', () => {
    const list = normalizeMovementList([{}, null]);
    for (const [index, item] of list.entries()) {
      expect(item).toEqual({
        id: `movement-${index}`,
        timestamp: '—',
        type: '—',
        responsible: '—',
        details: '—',
        metadata: undefined,
      });
    }
  });
});

describe('parseComplianceError', () => {
  const forbidden = (data: { message?: string; error?: string }) => ({ response: { status: 403, data } });

  it.each([
    ['a consent message', 'Consent revoked for this sample'],
    ['a revocation message', 'Acesso revogado'],
  ])('maps a 403 with %s to CONSENT_REVOKED', (_label, message) => {
    const result = parseComplianceError(forbidden({ message }));
    expect(result.code).toBe('CONSENT_REVOKED');
    expect(result.message).toMatch(/consentimento revogado/);
  });

  it.each([
    ['ética', 'Falta autorização Ética'],
    ['etica', 'sem aprovacao etica'],
    ['ethical', 'Ethical approval missing'],
  ])('maps a 403 naming %s to ETHICS_AUTH_REQUIRED', (_label, message) => {
    const result = parseComplianceError(forbidden({ message }));
    expect(result.code).toBe('ETHICS_AUTH_REQUIRED');
    expect(result.message).toMatch(/autorização ética/);
  });

  it('reads the backend error field when there is no message', () => {
    expect(parseComplianceError(forbidden({ error: 'consent withdrawn' })).code).toBe('CONSENT_REVOKED');
  });

  it('reads the error message when the response carries none', () => {
    const result = parseComplianceError({ response: { status: 403 }, message: 'ethical review pending' });
    expect(result.code).toBe('ETHICS_AUTH_REQUIRED');
  });

  it('prefers consent over ethics when a 403 names both', () => {
    expect(parseComplianceError(forbidden({ message: 'consent and ethical gaps' })).code).toBe('CONSENT_REVOKED');
  });

  it('keeps any other 403 as HTTP_403 with the backend message', () => {
    expect(parseComplianceError(forbidden({ message: 'Role not allowed' }))).toEqual({
      code: 'HTTP_403',
      message: 'Role not allowed',
    });
  });

  it('does not map a consent message on a status other than 403', () => {
    const result = parseComplianceError({ response: { status: 500, data: { message: 'consent store down' } } });
    expect(result).toEqual({ code: 'HTTP_500', message: 'consent store down' });
  });

  it('does not map an ethics message on a status other than 403', () => {
    const result = parseComplianceError({ response: { status: 500, data: { message: 'ethical review pending' } } });
    expect(result).toEqual({ code: 'HTTP_500', message: 'ethical review pending' });
  });

  it('returns a null code and the network error message without a response', () => {
    expect(parseComplianceError(new Error('Network Error'))).toEqual({ code: null, message: 'Network Error' });
  });

  it.each([
    ['null', null],
    ['an empty object', {}],
  ])('falls back to the default message for %s', (_label, error) => {
    expect(parseComplianceError(error)).toEqual({ code: null, message: 'Erro ao carregar movimentos' });
  });
});
