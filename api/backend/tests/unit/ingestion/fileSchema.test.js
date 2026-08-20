import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { validate } = require('../../../src/contracts/canonical/v1');

describe('canonical.v1.file (RF029 slice 4/6, #672)', () => {
  it('accepts a fully populated payload', () => {
    const { valid, errors } = validate('canonical.v1.file', {
      fileId: 'F-1',
      specimenId: 'S-1',
      fileRole: 'raw',
      fileUri: 'objstore://samples/S-1/files/report.pdf',
      fileFormat: 'PDF',
      fileSizeBytes: 102400,
      checksum: 'sha256:abc123',
    });
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  it('accepts a minimal payload with just the required fields', () => {
    const { valid, errors } = validate('canonical.v1.file', {
      fileId: 'F-1',
      fileUri: 'objstore://samples/S-1/files/report.pdf',
      fileSizeBytes: 102400,
      checksum: 'sha256:abc123',
    });
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  it('rejects a payload missing a required field (checksum)', () => {
    const { valid, errors } = validate('canonical.v1.file', {
      fileId: 'F-1',
      fileUri: 'objstore://samples/S-1/files/report.pdf',
      fileSizeBytes: 102400,
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.keyword === 'required')).toBe(true);
  });

  // SampleFile.js's real field is `storageUri`, not the canonical `fileUri`
  // -- additionalProperties: false means that legacy shape is rejected
  // outright, not silently accepted, same discipline the telemetry schema
  // applies to its own `temperature`/`value` pair.
  it('rejects the legacy `storageUri` field name -- not part of the canonical shape', () => {
    const { valid, errors } = validate('canonical.v1.file', {
      fileId: 'F-1',
      storageUri: 'objstore://samples/S-1/files/report.pdf',
      checksum: 'sha256:abc123',
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.keyword === 'additionalProperties')).toBe(true);
  });

  it('rejects an unknown top-level field (additionalProperties: false)', () => {
    const { valid, errors } = validate('canonical.v1.file', {
      fileId: 'F-1',
      fileUri: 'objstore://samples/S-1/files/report.pdf',
      fileSizeBytes: 102400,
      checksum: 'sha256:abc123',
      unknownField: 'x',
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.keyword === 'additionalProperties')).toBe(true);
  });
});
