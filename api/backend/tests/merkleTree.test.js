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
    participantId: 'P1',
    participantName: 'John',
    clinicalData: { foo: 'bar' },
    sprec: { sprec_field: 1 },
    pharmacologyData: { medicationName: 'aspirin', atcCode: 'ATC:A01' },
    rcsScore: 0.95,
    finalGrade: 'A',
    calculationTrace: [{ step: 'x' }],
    axisPenalties: { axis1: 0 }
  };

  it('changes when pharmacologyData changes', () => {
    const h1 = generateSampleHash(baseSample);
    const s2 = { ...baseSample, pharmacologyData: { medicationName: 'ibuprofen', atcCode: 'ATC:B01' } };
    const h2 = generateSampleHash(s2);
    expect(h1).not.toBe(h2);
  });

  it('changes when rcs-related fields change (rcsScore, finalGrade, calculationTrace, axisPenalties)', () => {
    const baseHash = generateSampleHash(baseSample);
    const sRcs = { ...baseSample, rcsScore: 0.5 };
    const sGrade = { ...baseSample, finalGrade: 'B' };
    const sTrace = { ...baseSample, calculationTrace: [{ step: 'y' }] };
    const sAxis = { ...baseSample, axisPenalties: { axis1: 1 } };

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
    modified.clinicalData.new_field = 'x';
    expect(generateSampleHash(modified)).not.toBe(baseHash);
  });
});