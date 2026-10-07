import { describe, it, expect } from 'vitest';

// log.service exports a singleton
const logService = require('../../src/services/log.service');

describe('LogService.sanitizeLogData', () => {
  it('returns a copy — does not mutate input', () => {
    const input = { entity: 'Sample', entityID: '12345678', message: 'test' };
    const result = logService.sanitizeLogData(input);
    expect(result).not.toBe(input);
  });

  it('preserves non-Patient entities unchanged', () => {
    const input = { entity: 'Sample', entityID: 'S-001', message: 'Sample created', action: 'CREATE' };
    const result = logService.sanitizeLogData(input);
    expect(result.entityID).toBe('S-001');
    expect(result.message).toBe('Sample created');
  });

  it('strips patient name from message for Patient entity', () => {
    const input = { entity: 'Patient', entityID: '12345678', message: 'Paciente João Silva atualizado' };
    const result = logService.sanitizeLogData(input);
    expect(result.message).not.toContain('João Silva');
  });

  it('keeps message intact when entity is Patient but message has no patient name prefix', () => {
    const input = { entity: 'Patient', entityID: '12345678', message: 'Record 12345678 updated' };
    const result = logService.sanitizeLogData(input);
    expect(result.message).toBe('Record 12345678 updated');
  });

  it('keeps valid 8-digit patientID for Patient entity', () => {
    const input = { entity: 'Patient', entityID: '12345678', message: 'test' };
    const result = logService.sanitizeLogData(input);
    expect(result.entityID).toBe('12345678');
  });

  it('extracts 8-digit ID from compound entityID for Patient entity', () => {
    const input = { entity: 'Patient', entityID: 'PAT-12345678-extra', message: 'test' };
    const result = logService.sanitizeLogData(input);
    expect(result.entityID).toBe('12345678');
  });

  it('sets entityID to N/A when no 8-digit ID extractable for Patient', () => {
    const input = { entity: 'Patient', entityID: 'no-digits-here', message: 'test' };
    const result = logService.sanitizeLogData(input);
    expect(result.entityID).toBe('N/A');
  });

  it('preserves metadata.tracking when present', () => {
    const tracking = { ip: '127.0.0.1', userAgent: 'Jest' };
    const input = { entity: 'Sample', entityID: 'S-001', metadata: { tracking } };
    const result = logService.sanitizeLogData(input);
    expect(result.metadata.tracking).toEqual(tracking);
    expect(result.metadata.tracking).not.toBe(tracking); // shallow copy
  });

  it('handles null message gracefully', () => {
    const input = { entity: 'Patient', entityID: '12345678', message: null };
    expect(() => logService.sanitizeLogData(input)).not.toThrow();
  });

  it('handles undefined entityID for Patient entity', () => {
    const input = { entity: 'Patient', entityID: undefined, message: 'test' };
    expect(() => logService.sanitizeLogData(input)).not.toThrow();
  });

  it('handles missing metadata.tracking without throwing', () => {
    const input = { entity: 'Sample', entityID: 'S-001', metadata: { other: true } };
    expect(() => logService.sanitizeLogData(input)).not.toThrow();
  });

  it('handles completely empty input', () => {
    expect(() => logService.sanitizeLogData({})).not.toThrow();
  });
});

// #1271: the trail a read is served from.
describe('LogService source (#1271)', () => {
  it('maps none or live to logs, archive to logs_archive', () => {
    expect(logService.logSourceCollection(undefined)).toBe('logs');
    expect(logService.logSourceCollection('')).toBe('logs');
    expect(logService.logSourceCollection('live')).toBe('logs');
    expect(logService.logSourceCollection('archive')).toBe('logs_archive');
  });

  it('refuses any other source with a 422 rather than reading the live trail', () => {
    for (const source of ['archived', 'toString', 'constructor']) {
      expect(() => logService.logSourceCollection(source)).toThrow(expect.objectContaining({ statusCode: 422 }));
    }
  });

  it('getLogs reads the collection the source names', async () => {
    const names = [];
    const db = { collection: (name) => { names.push(name); throw new Error('stop'); } };
    await expect(logService.getLogs(db, { source: 'archive' })).rejects.toThrow('stop');
    await expect(logService.getLogs(db, {})).rejects.toThrow('stop');
    expect(names).toEqual(['logs_archive', 'logs']);
  });
});
