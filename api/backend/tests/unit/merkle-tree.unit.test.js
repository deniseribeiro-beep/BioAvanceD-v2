import { describe, it, expect } from 'vitest';
const { sha256Hex, buildMerkleTree, getProofForIndex, getProofForHash, verifyProof, buildTree, getProof } = require('../../src/utils/merkleTree');

describe('sha256Hex', () => {
  it('returns a 64-char hex string', () => {
    const result = sha256Hex('hello');
    expect(result).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(result)).toBe(true);
  });

  it('is deterministic', () => {
    expect(sha256Hex('same')).toBe(sha256Hex('same'));
  });

  it('differs for different inputs', () => {
    expect(sha256Hex('a')).not.toBe(sha256Hex('b'));
  });

  it('coerces non-string input', () => {
    expect(() => sha256Hex(123)).not.toThrow();
    expect(sha256Hex(123)).toHaveLength(64);
  });
});

describe('buildMerkleTree', () => {
  it('returns null root for empty leaves', () => {
    const { root, layers } = buildMerkleTree([]);
    expect(root).toBeNull();
    expect(layers).toHaveLength(1);
  });

  it('returns the single leaf as root for one leaf', () => {
    const { root } = buildMerkleTree(['abc']);
    expect(root).toBe('abc');
  });

  it('produces a hash root for two leaves', () => {
    const { root } = buildMerkleTree(['leaf1', 'leaf2']);
    expect(root).toHaveLength(64);
  });

  it('produces a consistent root for same inputs', () => {
    const { root: r1 } = buildMerkleTree(['a', 'b', 'c']);
    const { root: r2 } = buildMerkleTree(['a', 'b', 'c']);
    expect(r1).toBe(r2);
  });

  it('changes root when leaves change', () => {
    const { root: r1 } = buildMerkleTree(['a', 'b']);
    const { root: r2 } = buildMerkleTree(['a', 'X']);
    expect(r1).not.toBe(r2);
  });

  it('builds tree for odd number of leaves (duplicates last)', () => {
    expect(() => buildMerkleTree(['a', 'b', 'c'])).not.toThrow();
    const { root } = buildMerkleTree(['a', 'b', 'c']);
    expect(root).toHaveLength(64);
  });

  it('returns layers array with log2(n)+1 levels for power-of-2 leaves', () => {
    const { layers } = buildMerkleTree(['a', 'b', 'c', 'd']);
    expect(layers.length).toBe(3); // leaves + 2 hash levels
  });
});

describe('getProofForIndex', () => {
  it('returns empty proof for single-leaf tree', () => {
    const { layers } = buildMerkleTree(['only']);
    const proof = getProofForIndex(layers, 0);
    expect(proof).toHaveLength(0);
  });

  it('returns proof array for a leaf in a 4-leaf tree', () => {
    const { layers } = buildMerkleTree(['a', 'b', 'c', 'd']);
    const proof = getProofForIndex(layers, 0);
    expect(Array.isArray(proof)).toBe(true);
    expect(proof.length).toBeGreaterThan(0);
    proof.forEach((step) => {
      expect(['left', 'right']).toContain(step.position);
      expect(typeof step.hash).toBe('string');
    });
  });
});

describe('getProofForHash', () => {
  it('returns null when hash not in leaves', () => {
    const leaves = ['a', 'b', 'c'];
    const { layers } = buildMerkleTree(leaves);
    const proof = getProofForHash(leaves, layers, 'NOT_FOUND');
    expect(proof).toBeNull();
  });

  it('returns proof when hash exists in leaves', () => {
    const leaves = ['x', 'y', 'z'];
    const { layers } = buildMerkleTree(leaves);
    const proof = getProofForHash(leaves, layers, 'x');
    expect(Array.isArray(proof)).toBe(true);
  });
});

describe('verifyProof', () => {
  it('returns false for null hash', () => {
    expect(verifyProof(null, [], 'root')).toBe(false);
  });

  it('returns false for null root', () => {
    expect(verifyProof('hash', [], null)).toBe(false);
  });

  it('returns false for non-array proof', () => {
    expect(verifyProof('hash', null, 'root')).toBe(false);
  });

  it('verifies proof for a leaf in a real tree', () => {
    const leaves = ['leaf0', 'leaf1', 'leaf2', 'leaf3'];
    const { root, layers } = buildMerkleTree(leaves);
    const proof = getProofForIndex(layers, 0);
    expect(verifyProof(leaves[0], proof, root)).toBe(true);
  });

  it('rejects tampered leaf', () => {
    const leaves = ['leaf0', 'leaf1', 'leaf2', 'leaf3'];
    const { root, layers } = buildMerkleTree(leaves);
    const proof = getProofForIndex(layers, 0);
    expect(verifyProof('TAMPERED', proof, root)).toBe(false);
  });

  it('returns false for step with no hash', () => {
    expect(verifyProof('hash', [{ position: 'right', hash: null }], 'root')).toBe(false);
  });

  it('returns false for step with unknown position', () => {
    expect(verifyProof('hash', [{ position: 'center', hash: 'abc' }], 'root')).toBe(false);
  });
});

describe('buildTree (alias)', () => {
  it('is equivalent to buildMerkleTree', () => {
    const leaves = ['p', 'q', 'r'];
    const { root: r1 } = buildMerkleTree(leaves);
    const { root: r2 } = buildTree(leaves);
    expect(r1).toBe(r2);
  });
});

describe('getProof', () => {
  it('returns null for out-of-bounds index', () => {
    expect(getProof(['a', 'b'], 5)).toBeNull();
  });

  it('returns null for negative index', () => {
    expect(getProof(['a', 'b'], -1)).toBeNull();
  });

  it('returns null for non-array leaves', () => {
    expect(getProof(null, 0)).toBeNull();
  });

  it('returns proof array for valid index', () => {
    const proof = getProof(['a', 'b', 'c', 'd'], 1);
    expect(Array.isArray(proof)).toBe(true);
  });
});
