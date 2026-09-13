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

  // #681: fileRole and fileFormat are dict-02 1..1 (ELM-0317/0319) and, since
  // #679, real fields on SampleFile — yet they stay OPTIONAL here, and this
  // case is the pin for that. 1..1 on the stored entity is not the same as
  // required on input: ELM-0317 documents a default of `raw` and
  // SampleFileModel.create supplies it, deriving fileFormat from fileType.
  // Requiring them would oblige a caller to send what the model already
  // provides — a stricter contract than the dictionary asks for.
  it('accepts a minimal payload without fileRole/fileFormat, which the model defaults and derives', () => {
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
