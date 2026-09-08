import { describe, it, expect } from 'vitest';
const LogModel = require('../../src/models/Log');

describe('LogModel.validateResult', () => {
  it('returns true for success', () => {
    expect(LogModel.validateResult('success')).toBe(true);
  });

  it('returns true for failure', () => {
    expect(LogModel.validateResult('failure')).toBe(true);
  });

  it('returns false for unknown result', () => {
    expect(LogModel.validateResult('error')).toBe(false);
    expect(LogModel.validateResult(null)).toBe(false);
  });
});

describe('LogModel.validateSeverity', () => {
  it('returns true for valid severities', () => {
    ['info', 'warning', 'error', 'critical'].forEach(s => {
      expect(LogModel.validateSeverity(s)).toBe(true);
    });
  });

  it('returns false for unknown severity', () => {
    expect(LogModel.validateSeverity('debug')).toBe(false);
    expect(LogModel.validateSeverity(null)).toBe(false);
  });
});

describe('LogModel.validate', () => {
  const validData = {
    userID: 'user-123',
    action: 'CREATE',
    entity: 'Sample',
  };

  it('returns no errors for valid data', () => {
    const result = LogModel.validate(validData);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('requires userID', () => {
    const result = LogModel.validate({ action: 'CREATE', entity: 'Sample' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('userID'))).toBe(true);
  });

  it('requires action', () => {
    const result = LogModel.validate({ userID: 'user-1', entity: 'Sample' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('action'))).toBe(true);
  });

  it('requires entity/resourceType', () => {
    const result = LogModel.validate({ userID: 'user-1', action: 'CREATE' });
    expect(result.isValid).toBe(false);
  });

  it('rejects ObjectId as entity', () => {
    const result = LogModel.validate({ userID: 'user-1', action: 'CREATE', entity: '507f1f77bcf86cd799439011' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('entity'))).toBe(true);
  });

  it('rejects long numeric ID as entity', () => {
    const result = LogModel.validate({ userID: 'user-1', action: 'CREATE', entity: '12345678' });
    expect(result.isValid).toBe(false);
  });

  it('rejects invalid severity', () => {
    const result = LogModel.validate({ ...validData, severity: 'verbose' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('severity'))).toBe(true);
  });

  it('accepts userId as alias for userID', () => {
    const result = LogModel.validate({ userId: 'user-1', action: 'CREATE', entity: 'Sample' });
    expect(result.isValid).toBe(true);
  });

});
