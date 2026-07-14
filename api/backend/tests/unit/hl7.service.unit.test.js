import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
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

describe('HL7Service.buildSPM', () => {
  it('uses sample._id when present, over specimenId', () => {
    const result = hl7Service.buildSPM({}, { _id: 'objid123', specimenId: 'SMP-1', sampleType: 'PLASMA' });
    expect(result).toMatch(/^SPM\|1\|objid123\|\|PLASMA\|/);
  });

  it('falls back to specimenId when _id is absent', () => {
    const result = hl7Service.buildSPM({}, { specimenId: 'SMP-1', sampleType: 'SERUM' });
    expect(result).toContain('SPM|1|SMP-1||SERUM|');
  });

  it('uses sampleFile.collectionDateTime over sample.registeredAt when both present', () => {
    const collectionDate = new Date('2026-01-01T10:00:00.000Z');
    const registeredAt = new Date('2025-01-01T10:00:00.000Z');
    const result = hl7Service.buildSPM(
      { collectionDateTime: collectionDate },
      { specimenId: 'SMP-1', sampleType: 'URINE', registeredAt }
    );
    expect(result).toContain(hl7Service.formatHL7DateTime(collectionDate));
    expect(result).not.toContain(hl7Service.formatHL7DateTime(registeredAt));
  });

  it('falls back to sample.registeredAt when sampleFile has no collectionDateTime', () => {
    const registeredAt = new Date('2025-01-01T10:00:00.000Z');
    const result = hl7Service.buildSPM({}, { specimenId: 'SMP-1', sampleType: 'URINE', registeredAt });
    expect(result).toContain(hl7Service.formatHL7DateTime(registeredAt));
  });

  it('uses empty strings when specimen id, type and dates are all absent', () => {
    const result = hl7Service.buildSPM({}, {});
    expect(result).toBe('SPM|1|||||||||||||');
  });
});

describe('HL7Service.buildOBR', () => {
  it('starts with OBR and includes order/accession numbers', () => {
    const result = hl7Service.buildOBR(
      { orderNumber: 'ORD-1', accessionNumber: 'ACC-1', fileType: 'PDF' },
      {}
    );
    expect(result).toMatch(/^OBR\|1\|ORD-1\|ACC-1\|\|/);
  });

  it('falls back to sampleFile._id when accessionNumber is absent', () => {
    const result = hl7Service.buildOBR({ fileType: 'PDF', _id: 'FILEID1' }, {});
    expect(result).toContain('OBR|1||FILEID1||');
  });

  it('uses loincCode with fileType and LN system when loincCode present', () => {
    const result = hl7Service.buildOBR({ loincCode: '12345-6', fileType: 'CSV' }, {});
    expect(result).toContain('12345-6^CSV^LN');
  });

  it('uses bare ^fileType when loincCode is absent', () => {
    const result = hl7Service.buildOBR({ fileType: 'CSV' }, {});
    expect(result).toContain('|^CSV|');
  });

  it('uses analysisDateTime for observation date/time when present', () => {
    const analysisDateTime = new Date('2026-03-01T00:00:00.000Z');
    const result = hl7Service.buildOBR({ fileType: 'PDF', analysisDateTime }, {});
    expect(result).toContain(hl7Service.formatHL7DateTime(analysisDateTime));
  });

  it('falls back to processingDateTime when analysisDateTime is absent', () => {
    const processingDateTime = new Date('2026-02-01T00:00:00.000Z');
    const result = hl7Service.buildOBR({ fileType: 'PDF', processingDateTime }, {});
    const formatted = hl7Service.formatHL7DateTime(processingDateTime);
    expect(result).toContain(formatted);
    // processingDateTime is also used for specimenReceivedDateTime, so it should appear twice
    expect(result.split(formatted).length - 1).toBe(2);
  });

  it('defaults resultStatus to F when absent', () => {
    const result = hl7Service.buildOBR({ fileType: 'PDF' }, {});
    expect(result.endsWith('|F')).toBe(true);
  });

  it('uses provided resultStatus when present', () => {
    const result = hl7Service.buildOBR({ fileType: 'PDF', resultStatus: 'P' }, {});
    expect(result.endsWith('|P')).toBe(true);
  });
});

describe('HL7Service.buildOBX', () => {
  it('uses ED value type for RAW file type', () => {
    const result = hl7Service.buildOBX({ fileType: 'RAW', fileName: 'raw.bin' }, {});
    expect(result).toMatch(/^OBX\|1\|ED\|/);
  });

  it('uses TX value type for non-RAW file types', () => {
    const result = hl7Service.buildOBX({ fileType: 'PDF', fileName: 'report.pdf' }, {});
    expect(result).toMatch(/^OBX\|1\|TX\|/);
  });

  it('uses loincCode as observationID when present, else FILE^fileType', () => {
    const withLoinc = hl7Service.buildOBX({ fileType: 'PDF', fileName: 'a.pdf', loincCode: '99999-9' }, {});
    expect(withLoinc).toContain('|99999-9|');

    const withoutLoinc = hl7Service.buildOBX({ fileType: 'PDF', fileName: 'a.pdf' }, {});
    expect(withoutLoinc).toContain('|FILE^PDF|');
  });

  it('uses resultValue with unit when resultValue is present', () => {
    const result = hl7Service.buildOBX(
      { fileType: 'PDF', fileName: 'a.pdf', resultValue: 42, unitOfMeasure: 'mg/dL' },
      {}
    );
    expect(result).toContain('||42^mg/dL|');
  });

  it('uses resultValue without unit when unitOfMeasure absent', () => {
    const result = hl7Service.buildOBX({ fileType: 'PDF', fileName: 'a.pdf', resultValue: 7 }, {});
    expect(result).toContain('||7|');
  });

  it('falls back to fileName as observation value when resultValue is null/undefined', () => {
    const result = hl7Service.buildOBX({ fileType: 'PDF', fileName: 'a.pdf' }, {});
    expect(result).toContain('||a.pdf|');
  });

  it('treats resultValue of 0 as a real value (not falling back to fileName)', () => {
    const result = hl7Service.buildOBX({ fileType: 'PDF', fileName: 'a.pdf', resultValue: 0 }, {});
    expect(result).toContain('||0|');
  });

  it('maps interpretation to abnormal flag using mapInterpretationToHL7', () => {
    const result = hl7Service.buildOBX({ fileType: 'PDF', fileName: 'a.pdf', interpretation: 'HIGH' }, {});
    expect(result).toContain('|H|');
  });

  it('defaults resultStatus to F when absent', () => {
    const result = hl7Service.buildOBX({ fileType: 'PDF', fileName: 'a.pdf' }, {});
    expect(result).toContain('|F|');
  });
});

describe('HL7Service.mapStatusToFHIR', () => {
  it('defaults to final for null/undefined/empty status', () => {
    expect(hl7Service.mapStatusToFHIR(null)).toBe('final');
    expect(hl7Service.mapStatusToFHIR(undefined)).toBe('final');
    expect(hl7Service.mapStatusToFHIR('')).toBe('final');
  });

  it('maps F/FINAL to final', () => {
    expect(hl7Service.mapStatusToFHIR('F')).toBe('final');
    expect(hl7Service.mapStatusToFHIR('final')).toBe('final');
  });

  it('maps P/PRELIMINARY/PRELIMINAR to preliminary', () => {
    expect(hl7Service.mapStatusToFHIR('P')).toBe('preliminary');
    expect(hl7Service.mapStatusToFHIR('PRELIMINARY')).toBe('preliminary');
    expect(hl7Service.mapStatusToFHIR('preliminar')).toBe('preliminary');
  });

  it('maps C/CANCELED/CANCELADO to cancelled', () => {
    expect(hl7Service.mapStatusToFHIR('C')).toBe('cancelled');
    expect(hl7Service.mapStatusToFHIR('CANCELED')).toBe('cancelled');
    expect(hl7Service.mapStatusToFHIR('cancelado')).toBe('cancelled');
  });

  it('falls back to final for unrecognized status codes', () => {
    expect(hl7Service.mapStatusToFHIR('BOGUS')).toBe('final');
  });
});

describe('HL7Service.mapInterpretationToFHIR', () => {
  it('defaults to N for null/undefined/empty interpretation', () => {
    expect(hl7Service.mapInterpretationToFHIR(null)).toBe('N');
    expect(hl7Service.mapInterpretationToFHIR(undefined)).toBe('N');
    expect(hl7Service.mapInterpretationToFHIR('')).toBe('N');
  });

  it('maps normal/high/low the same as HL7 mapping', () => {
    expect(hl7Service.mapInterpretationToFHIR('NORMAL')).toBe('N');
    expect(hl7Service.mapInterpretationToFHIR('HIGH')).toBe('H');
    expect(hl7Service.mapInterpretationToFHIR('LOW')).toBe('L');
  });

  it('maps critical interpretation to CRIT (not C, unlike the HL7 v2 mapping)', () => {
    expect(hl7Service.mapInterpretationToFHIR('C')).toBe('CRIT');
    expect(hl7Service.mapInterpretationToFHIR('CRITICAL')).toBe('CRIT');
  });

  it('falls back to N for unrecognized interpretation codes', () => {
    expect(hl7Service.mapInterpretationToFHIR('NONSENSE')).toBe('N');
  });
});

describe('HL7Service.mapSampleTypeToSNOMED', () => {
  it('defaults to 119297000 (serum code) for null/undefined/empty sampleType', () => {
    expect(hl7Service.mapSampleTypeToSNOMED(null)).toBe('119297000');
    expect(hl7Service.mapSampleTypeToSNOMED(undefined)).toBe('119297000');
    expect(hl7Service.mapSampleTypeToSNOMED('')).toBe('119297000');
  });

  it('maps PLASMA to 119361006', () => {
    expect(hl7Service.mapSampleTypeToSNOMED('PLASMA')).toBe('119361006');
  });

  it('maps SERUM to 119297000', () => {
    expect(hl7Service.mapSampleTypeToSNOMED('SERUM')).toBe('119297000');
  });

  it('maps URINE to 122575003', () => {
    expect(hl7Service.mapSampleTypeToSNOMED('URINE')).toBe('122575003');
  });

  it('maps SALIVA to 258467004', () => {
    expect(hl7Service.mapSampleTypeToSNOMED('SALIVA')).toBe('258467004');
  });

  it('maps CSF to 430864002', () => {
    expect(hl7Service.mapSampleTypeToSNOMED('CSF')).toBe('430864002');
  });

  it('falls back to 119297000 for unrecognized sample types', () => {
    expect(hl7Service.mapSampleTypeToSNOMED('BOGUS')).toBe('119297000');
  });
});

describe('HL7Service.getSampleTypeDisplay', () => {
  it('returns the localized label for a known specimen type id', () => {
    expect(hl7Service.getSampleTypeDisplay('PLASMA')).toBe('Plasma');
    expect(hl7Service.getSampleTypeDisplay('URINE')).toBe('Urina');
  });

  it('returns the raw sampleType unchanged when it is not a known specimen type', () => {
    expect(hl7Service.getSampleTypeDisplay('MYSTERY')).toBe('MYSTERY');
  });

  it('returns a safe fallback string when sampleType is undefined', () => {
    expect(hl7Service.getSampleTypeDisplay(undefined)).toBe('Desconhecido');
  });
});

describe('HL7Service.getMimeType', () => {
  it('maps known file types to their MIME types', () => {
    expect(hl7Service.getMimeType('PDF')).toBe('application/pdf');
    expect(hl7Service.getMimeType('CSV')).toBe('text/csv');
    expect(hl7Service.getMimeType('ZIP')).toBe('application/zip');
    expect(hl7Service.getMimeType('XLSX')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  it('falls back to application/octet-stream for unrecognized file types', () => {
    expect(hl7Service.getMimeType('UNKNOWN')).toBe('application/octet-stream');
    expect(hl7Service.getMimeType(undefined)).toBe('application/octet-stream');
  });
});

describe('HL7Service.escapeXML', () => {
  it('returns empty string for falsy input', () => {
    expect(hl7Service.escapeXML(null)).toBe('');
    expect(hl7Service.escapeXML(undefined)).toBe('');
    expect(hl7Service.escapeXML('')).toBe('');
  });

  it('escapes ampersand before other entities so entities are not double-escaped', () => {
    expect(hl7Service.escapeXML('Tom & Jerry <report>')).toBe('Tom &amp; Jerry &lt;report&gt;');
  });

  it('escapes angle brackets', () => {
    expect(hl7Service.escapeXML('<tag>')).toBe('&lt;tag&gt;');
  });

  it('escapes double and single quotes', () => {
    expect(hl7Service.escapeXML(`He said "hi" it's fine`)).toBe('He said &quot;hi&quot; it&apos;s fine');
  });

  it('coerces non-string input to string before escaping', () => {
    expect(hl7Service.escapeXML(123)).toBe('123');
  });
});

describe('HL7Service.formatFileSize', () => {
  it('returns "0 bytes" for zero, null, or undefined', () => {
    expect(hl7Service.formatFileSize(0)).toBe('0 bytes');
    expect(hl7Service.formatFileSize(null)).toBe('0 bytes');
    expect(hl7Service.formatFileSize(undefined)).toBe('0 bytes');
  });

  it('formats sub-1024 sizes in bytes', () => {
    expect(hl7Service.formatFileSize(500)).toBe('500 bytes');
  });

  it('formats sizes in KB', () => {
    expect(hl7Service.formatFileSize(2048)).toBe('2 KB');
  });

  it('formats sizes in MB', () => {
    expect(hl7Service.formatFileSize(5 * 1024 * 1024)).toBe('5 MB');
  });

  it('formats sizes in GB', () => {
    expect(hl7Service.formatFileSize(3 * 1024 * 1024 * 1024)).toBe('3 GB');
  });

  it('rounds to two decimal places for non-exact sizes', () => {
    expect(hl7Service.formatFileSize(1500)).toBe('1.46 KB');
  });
});
