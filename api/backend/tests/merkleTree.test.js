const { buildTree, getProof, verifyProof, _sha256 } = require('../src/utils/merkleTree');
const { generateSampleHash, stableSerialize } = require('../src/services/MerkleService');

describe('merkleTree utils', () => {
  it('builds tree and verifies proofs', () => {
    const leaves = ['a', 'b', 'c', 'd'];
    const { root, layers } = buildTree(leaves);

    expect(typeof root).toBe('string');
    expect(root.length).toBe(64);
    expect(Array.isArray(layers)).toBe(true);

    const index = 2;
    const proof = getProof(leaves, index);
    expect(Array.isArray(proof)).toBe(true);
    expect(verifyProof('c', proof, root)).toBe(true);

    const tampered = JSON.parse(JSON.stringify(proof));
    if (tampered.length > 0) tampered[0].hash = '0'.repeat(64);
    expect(verifyProof('c', tampered, root)).toBe(false);
  });

  it('handles single leaf and edge cases', () => {
    const leaf = ['only'];
    const { root } = buildTree(leaf);
    const proof = getProof(leaf, 0);
    expect(proof).toEqual([]);
    expect(verifyProof('only', proof, root)).toBe(true);

    expect(getProof(['a'], 5)).toBeNull();
    const h = _sha256('test-123');
    expect(typeof h).toBe('string');
    expect(h.length).toBe(64);
  });
});

describe('MerkleService.generateSampleHash', () => {
  const baseSample = {
    patient_identity: { patient_id: 'P1', patient_name: 'John' },
    clinical_data: { foo: 'bar' },
    sprec: { sprec_field: 1 },
    pharmacology_data: { drug_name: 'aspirin', atc_code: 'ATC:A01' },
    rcs_score: 0.95,
    final_grade: 'A',
    calculation_trace: [{ step: 'x' }],
    axis_penalties: { axis1: 0 }
  };

  it('changes when pharmacology_data changes', () => {
    const h1 = generateSampleHash(baseSample);
    const s2 = { ...baseSample, pharmacology_data: { drug_name: 'ibuprofen', atc_code: 'ATC:B01' } };
    const h2 = generateSampleHash(s2);
    expect(h1).not.toBe(h2);
  });

  it('changes when rcs-related fields change (rcs_score, final_grade, calculation_trace, axis_penalties)', () => {
    const baseHash = generateSampleHash(baseSample);
    const sRcs = { ...baseSample, rcs_score: 0.5 };
    const sGrade = { ...baseSample, final_grade: 'B' };
    const sTrace = { ...baseSample, calculation_trace: [{ step: 'y' }] };
    const sAxis = { ...baseSample, axis_penalties: { axis1: 1 } };

    expect(generateSampleHash(sRcs)).not.toBe(baseHash);
    expect(generateSampleHash(sGrade)).not.toBe(baseHash);
    expect(generateSampleHash(sTrace)).not.toBe(baseHash);
    expect(generateSampleHash(sAxis)).not.toBe(baseHash);
  });

  it('is stable to key order due to deterministic serialization', () => {
    const ordered = { a: 1, b: 2 };
    const reordered = { b: 2, a: 1 };
    expect(stableSerialize(ordered)).toBe(stableSerialize(reordered));
  });

  it('detects relevant payload changes', () => {
    const baseHash = generateSampleHash(baseSample);
    const modified = JSON.parse(JSON.stringify(baseSample));
    modified.clinical_data.new_field = 'x';
    expect(generateSampleHash(modified)).not.toBe(baseHash);
  });
});