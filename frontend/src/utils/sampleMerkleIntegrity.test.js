import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  deepSort,
  stableSerialize,
  generateSampleHash,
  buildSampleMerkleRoot,
  verifySampleIntegrity,
} from './sampleMerkleIntegrity';

// Mirrors api/backend/tests/unit/merkle-service.pharmacology.test.js so the
// two algorithms are exercised the same way (#519: frontend now computes the
// same single flat SHA-256 as MerkleService.generateSampleHash instead of a
// structurally different 3-leaf tree).

function nodeSha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

describe('sampleMerkleIntegrity', () => {
  const validSample = {
    sampleID: 'S-1001',
    participant_identity: {
      participantId: '12345678',
      participantName: 'Paciente Teste',
    },
    sprec: {
      specimen_type: 'PLASMA',
      collection_date: '2024-01-15',
    },
    clinicalData: {
      orphaCode: 'ORPHA:324',
      cid: 'E75.2',
      biomarkers_values: {
        'Lyso-Gb3': '4.2',
      },
    },
    pharmacologyData: {
      treatmentStatus: 'ON_TREATMENT',
      medicationName: 'Migalastat',
      atcCode: 'A16AX27',
      atcClass: 'A',
    },
  };

  it('generates a stable 64-char hex SHA-256 hash for the same sample', async () => {
    const hash1 = await generateSampleHash(validSample);
    const hash2 = await generateSampleHash(validSample);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('matches a Node crypto SHA-256 of the same canonical payload (WebCrypto/Node parity)', async () => {
    const expected = nodeSha256Hex(stableSerialize({
      participant_identity: { participantId: '12345678', participantName: 'Paciente Teste' },
      clinicalData: validSample.clinicalData,
      sprec: validSample.sprec,
      pharmacologyData: {
        ...validSample.pharmacologyData,
        treatmentStatus: 'ON_TREATMENT',
        medicationName: 'Migalastat',
        atcCode: 'A16AX27',
        atcClass: 'A',
        lastDoseDate: null,
        washoutStartDate: null,
        washoutEndDate: null,
      },
      rcsScore: null,
      finalGrade: null,
      calculationTrace: null,
      axisPenalties: null,
    }));

    const actual = await generateSampleHash(validSample);
    expect(actual).toBe(expected);
  });

  it('is sensitive to every pharmacologyData field', async () => {
    const hash1 = await generateSampleHash(validSample);

    const tamperedSamples = [
      { ...validSample, pharmacologyData: { ...validSample.pharmacologyData, treatmentStatus: 'NAIVE' } },
      { ...validSample, pharmacologyData: { ...validSample.pharmacologyData, medicationName: 'Ataluren' } },
      { ...validSample, pharmacologyData: { ...validSample.pharmacologyData, atcCode: 'C01BD01' } },
      { ...validSample, pharmacologyData: { ...validSample.pharmacologyData, atcClass: 'C' } },
    ];

    for (const tampered of tamperedSamples) {
      const hash = await generateSampleHash(tampered);
      expect(hash).not.toBe(hash1);
    }
  });

  it('normalizes ATC codes, stripping the "ATC:" prefix', async () => {
    const sample1 = { ...validSample, pharmacologyData: { ...validSample.pharmacologyData, atcCode: 'A16AX27' } };
    const sample2 = { ...validSample, pharmacologyData: { ...validSample.pharmacologyData, atcCode: 'ATC:A16AX27' } };

    expect(await generateSampleHash(sample1)).toBe(await generateSampleHash(sample2));
  });

  it('detects tampering in clinicalData, sprec, and participant identity', async () => {
    const hash1 = await generateSampleHash(validSample);

    const clinicalTampered = { ...validSample, clinicalData: { ...validSample.clinicalData, cid: 'E75.9' } };
    const sprecTampered = { ...validSample, sprec: { ...validSample.sprec, specimen_type: 'SERUM' } };
    const identityTampered = {
      ...validSample,
      participant_identity: { participantId: '99999999', participantName: 'Outro Paciente' },
    };

    expect(await generateSampleHash(clinicalTampered)).not.toBe(hash1);
    expect(await generateSampleHash(sprecTampered)).not.toBe(hash1);
    expect(await generateSampleHash(identityTampered)).not.toBe(hash1);
  });

  it('serializes deterministically regardless of key order', async () => {
    const sample1 = {
      sampleID: 'S-1',
      participant_identity: { participantId: '12345678', participantName: 'X' },
      pharmacologyData: {
        atcCode: 'A16AX27', medicationName: 'Migalastat', treatmentStatus: 'ON_TREATMENT', atcClass: 'A',
      },
    };
    const sample2 = {
      participant_identity: { participantName: 'X', participantId: '12345678' },
      pharmacologyData: {
        medicationName: 'Migalastat', atcClass: 'A', atcCode: 'A16AX27', treatmentStatus: 'ON_TREATMENT',
      },
      sampleID: 'S-1',
    };

    expect(await generateSampleHash(sample1)).toBe(await generateSampleHash(sample2));
  });

  it('treats null and undefined pharmacologyData as equivalent', async () => {
    const hash1 = await generateSampleHash({ ...validSample, pharmacologyData: null });
    const hash2 = await generateSampleHash({ ...validSample, pharmacologyData: undefined });
    const hash3 = await generateSampleHash({ ...validSample, pharmacologyData: {} });

    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    expect(hash3).toMatch(/^[a-f0-9]{64}$/);
    expect(hash1).toBe(hash2);
  });

  it('handles an empty sample', async () => {
    const hash = await generateSampleHash({});
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('deepSort sorts object keys recursively, including nested arrays of objects', () => {
    const sorted = deepSort({ b: 1, a: { d: 2, c: 3 }, e: [{ z: 1, y: 2 }] });
    expect(Object.keys(sorted)).toEqual(['a', 'b', 'e']);
    expect(Object.keys(sorted.a)).toEqual(['c', 'd']);
    expect(Object.keys(sorted.e[0])).toEqual(['y', 'z']);
  });

  describe('buildSampleMerkleRoot / verifySampleIntegrity', () => {
    it('buildSampleMerkleRoot returns the same value as generateSampleHash under rootHash', async () => {
      const { rootHash } = await buildSampleMerkleRoot(validSample);
      expect(rootHash).toBe(await generateSampleHash(validSample));
    });

    it('verifySampleIntegrity confirms an untampered sample and rejects a tampered one', async () => {
      const { rootHash } = await buildSampleMerkleRoot(validSample);
      const tampered = { ...validSample, pharmacologyData: { ...validSample.pharmacologyData, atcCode: 'C01AA01' } };

      expect(await verifySampleIntegrity(validSample, rootHash)).toBe(true);
      expect(await verifySampleIntegrity(tampered, rootHash)).toBe(false);
    });

    it('verifySampleIntegrity returns false when no rootHash is given', async () => {
      expect(await verifySampleIntegrity(validSample, '')).toBe(false);
      expect(await verifySampleIntegrity(validSample, null)).toBe(false);
    });
  });
});
