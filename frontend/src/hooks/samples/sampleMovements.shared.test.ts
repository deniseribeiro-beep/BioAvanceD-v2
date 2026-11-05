import { describe, expect, it } from 'vitest';
import { normalizeMovementList, parseComplianceError } from './sampleMovements.shared';

describe('sample movement records', () => {
  it('reads a list from data or from the payload itself', () => {
    expect(normalizeMovementList(null)).toEqual([]);
    const rows = normalizeMovementList({
      data: [{ _id: '1', createdAt: '2026-11-05', operatorName: 'Ana', description: 'Saída' }],
    });
    expect(rows[0]).toMatchObject({ id: '1', timestamp: '2026-11-05', responsible: 'Ana', details: 'Saída' });

    const bare = normalizeMovementList([{ date: 'hoje', user: 'Bob', note: 'Nota', metadata: { box: 'A' } }]);
    expect(bare[0]).toMatchObject({ timestamp: 'hoje', responsible: 'Bob', details: 'Nota', metadata: { box: 'A' } });
    expect(normalizeMovementList([{}])[0].id).toContain('movement-0');
  });

  it('names a revoked consent, a missing ethics clearance and any other failure', () => {
    expect(parseComplianceError({ response: { status: 403, data: { message: 'Consent revoked' } } }).code).toBe('CONSENT_REVOKED');
    expect(parseComplianceError({ response: { status: 403, data: { error: 'autorização ética' } } }).code).toBe('ETHICS_AUTH_REQUIRED');
    expect(parseComplianceError({ response: { status: 500, data: { message: 'falha' } } })).toMatchObject({
      code: 'HTTP_500',
      message: 'falha',
    });
    expect(parseComplianceError(new Error('rede')).code).toBeNull();
    expect(parseComplianceError({}).message).toBe('Erro ao carregar movimentos');
  });
});
