import { describe, it, expect } from 'vitest';
const hl7Service = require('../../src/services/hl7.service');

describe('HL7Service.formatHL7DateTime', () => {
  it('returns empty string for null', () => {
    expect(hl7Service.formatHL7DateTime(null)).toBe('');
  });

  it('returns empty string for invalid date', () => {
    expect(hl7Service.formatHL7DateTime('not-a-date')).toBe('');
  });

  it('formats Date object as YYYYMMDDHHmmss', () => {
    const d = new Date('2026-06-15T10:30:45.000Z');
    const result = hl7Service.formatHL7DateTime(d);
    expect(result).toHaveLength(14);
    expect(result).toMatch(/^\d{14}$/);
    expect(result.substring(0, 4)).toBe('2026');
  });

  it('accepts ISO string', () => {
    const result = hl7Service.formatHL7DateTime('2026-06-15T10:30:45.000Z');
    expect(result).toHaveLength(14);
    expect(result).toMatch(/^\d{14}$/);
  });
});

describe('HL7Service.formatHL7Date', () => {
  it('returns empty string for null', () => {
    expect(hl7Service.formatHL7Date(null)).toBe('');
  });

  it('returns empty string for invalid date', () => {
    expect(hl7Service.formatHL7Date('invalid')).toBe('');
  });

  it('formats Date object as YYYYMMDD (8 chars)', () => {
    const d = new Date('2026-06-15T00:00:00.000Z');
    const result = hl7Service.formatHL7Date(d);
    expect(result).toHaveLength(8);
    expect(result).toMatch(/^\d{8}$/);
    expect(result.substring(0, 4)).toBe('2026');
  });
});

describe('HL7Service.mapInterpretationToHL7', () => {
  it('returns empty string for null', () => {
    expect(hl7Service.mapInterpretationToHL7(null)).toBe('');
  });

  it('maps N to N', () => {
    expect(hl7Service.mapInterpretationToHL7('N')).toBe('N');
    expect(hl7Service.mapInterpretationToHL7('NORMAL')).toBe('N');
  });

  it('maps A to A', () => {
    expect(hl7Service.mapInterpretationToHL7('A')).toBe('A');
    expect(hl7Service.mapInterpretationToHL7('ABNORMAL')).toBe('A');
    expect(hl7Service.mapInterpretationToHL7('ANORMAL')).toBe('A');
  });

  it('maps H to H (high)', () => {
    expect(hl7Service.mapInterpretationToHL7('H')).toBe('H');
    expect(hl7Service.mapInterpretationToHL7('HIGH')).toBe('H');
    expect(hl7Service.mapInterpretationToHL7('ALTO')).toBe('H');
  });

  it('maps L to L (low)', () => {
    expect(hl7Service.mapInterpretationToHL7('L')).toBe('L');
    expect(hl7Service.mapInterpretationToHL7('LOW')).toBe('L');
    expect(hl7Service.mapInterpretationToHL7('BAIXO')).toBe('L');
  });

  it('maps HH to HH (very high)', () => {
    expect(hl7Service.mapInterpretationToHL7('HH')).toBe('HH');
    expect(hl7Service.mapInterpretationToHL7('VERY HIGH')).toBe('HH');
  });

  it('maps LL to LL (very low)', () => {
    expect(hl7Service.mapInterpretationToHL7('LL')).toBe('LL');
  });

  it('maps critical values', () => {
    expect(hl7Service.mapInterpretationToHL7('C')).toBe('C');
    expect(hl7Service.mapInterpretationToHL7('CRITICAL')).toBe('C');
  });

  it('returns empty for unknown', () => {
    expect(hl7Service.mapInterpretationToHL7('UNKNOWN')).toBe('');
  });

  it('is case-insensitive', () => {
    expect(hl7Service.mapInterpretationToHL7('normal')).toBe('N');
    expect(hl7Service.mapInterpretationToHL7('high')).toBe('H');
  });
});

describe('HL7Service.generateMessageID', () => {
  it('returns a string starting with MSG', () => {
    const id = hl7Service.generateMessageID();
    expect(id).toMatch(/^MSG\d+[A-Z0-9]+$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 10 }, () => hl7Service.generateMessageID()));
    expect(ids.size).toBeGreaterThan(1);
  });
});

describe('HL7Service.buildMSH', () => {
  it('returns string starting with MSH', () => {
    const result = hl7Service.buildMSH('MSG123', '20260615103045');
    expect(result).toMatch(/^MSH\|/);
  });

  it('includes messageID in the segment', () => {
    const result = hl7Service.buildMSH('TESTMSG', '20260615');
    expect(result).toContain('TESTMSG');
  });

  it('includes ORU^R01 message type', () => {
    const result = hl7Service.buildMSH('ID1', '20260615');
    expect(result).toContain('ORU^R01');
  });
});

describe('HL7Service.buildPID', () => {
  it('returns string starting with PID', () => {
    const result = hl7Service.buildPID('12345678');
    expect(result).toMatch(/^PID\|/);
  });

  it('includes patientID in segment', () => {
    const result = hl7Service.buildPID('12345678');
    expect(result).toContain('12345678');
  });

  it('includes BioAdvanceD facility', () => {
    const result = hl7Service.buildPID('12345678');
    expect(result).toContain('BioAdvanceD');
  });
});
