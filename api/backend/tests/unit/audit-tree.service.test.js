const {
  leafHash,
  nodeHash,
  buildTree,
  inclusionProof,
  verifyInclusion,
  consistencyProof,
  verifyConsistency,
} = require('../../src/services/audit-tree.service');

describe('audit-tree.service', () => {
  describe('leafHash / nodeHash', () => {
    it('produces a deterministic 64-char hex digest for a leaf', () => {
      const hash = leafHash({ a: 1 });
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(leafHash({ a: 1 })).toBe(hash);
    });

    it('produces different hashes for different leaves', () => {
      expect(leafHash({ a: 1 })).not.toBe(leafHash({ a: 2 }));
    });

    it('combines two hashes into a node hash distinct from either input', () => {
      const left = leafHash({ a: 1 });
      const right = leafHash({ a: 2 });
      const combined = nodeHash(left, right);
      expect(combined).toMatch(/^[0-9a-f]{64}$/);
      expect(combined).not.toBe(left);
      expect(combined).not.toBe(right);
    });

    it('is order-sensitive (left/right swap changes the result)', () => {
      const left = leafHash({ a: 1 });
      const right = leafHash({ a: 2 });
      expect(nodeHash(left, right)).not.toBe(nodeHash(right, left));
    });
  });

  describe('buildTree', () => {
    it('returns a null root and empty structures for zero leaves', () => {
      const tree = buildTree([]);
      expect(tree).toEqual({ rootHash: null, treeSize: 0, leafHashes: [], layers: [] });
    });

    it('returns the single leaf hash as root for one leaf', () => {
      const tree = buildTree([{ a: 1 }]);
      expect(tree.treeSize).toBe(1);
      expect(tree.layers).toHaveLength(1);
      expect(tree.rootHash).toBe(tree.leafHashes[0]);
    });

    it('builds a balanced tree for an even number of leaves', () => {
      const leaves = [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }];
      const tree = buildTree(leaves);
      expect(tree.treeSize).toBe(4);
      expect(tree.layers).toHaveLength(3);
      expect(tree.layers[0]).toHaveLength(4);
      expect(tree.layers[1]).toHaveLength(2);
      expect(tree.layers[2]).toHaveLength(1);
      expect(tree.rootHash).toBe(tree.layers[2][0]);
    });

    it('duplicates the dangling last hash when a layer is odd-length', () => {
      const leaves = [{ a: 1 }, { a: 2 }, { a: 3 }];
      const tree = buildTree(leaves);
      expect(tree.treeSize).toBe(3);
      expect(tree.layers[0]).toHaveLength(3);
      expect(tree.layers[1]).toHaveLength(2);
      const expectedLast = nodeHash(tree.layers[0][2], tree.layers[0][2]);
      expect(tree.layers[1][1]).toBe(expectedLast);
    });

    it('is deterministic across calls for the same leaves', () => {
      const leaves = [{ a: 1 }, { a: 2 }, { a: 3 }];
      expect(buildTree(leaves).rootHash).toBe(buildTree(leaves).rootHash);
    });
  });

  describe('inclusionProof / verifyInclusion', () => {
    it('produces a valid proof for a leaf in a balanced tree (right position)', () => {
      const leaves = [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }];
      const tree = buildTree(leaves);
      const proof = inclusionProof(tree, 1);
      expect(verifyInclusion(leaves[1], proof, tree.rootHash)).toBe(true);
    });

    it('produces a valid proof for a leaf at an odd/left position', () => {
      const leaves = [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }];
      const tree = buildTree(leaves);
      const proof = inclusionProof(tree, 0);
      expect(verifyInclusion(leaves[0], proof, tree.rootHash)).toBe(true);
    });

    it('produces a valid proof against a dangling-duplicate sibling', () => {
      const leaves = [{ a: 1 }, { a: 2 }, { a: 3 }];
      const tree = buildTree(leaves);
      const proof = inclusionProof(tree, 2);
      expect(verifyInclusion(leaves[2], proof, tree.rootHash)).toBe(true);
    });

    it('returns an empty proof for a single-leaf tree and verifies trivially', () => {
      const leaves = [{ a: 1 }];
      const tree = buildTree(leaves);
      const proof = inclusionProof(tree, 0);
      expect(proof).toEqual([]);
      expect(verifyInclusion(leaves[0], proof, tree.rootHash)).toBe(true);
    });

    it('rejects when the root hash is missing', () => {
      expect(verifyInclusion({ a: 1 }, [], null)).toBe(false);
    });

    it('rejects when the proof is not an array', () => {
      expect(verifyInclusion({ a: 1 }, undefined, 'deadbeef')).toBe(false);
    });

    it('rejects a proof step missing a hash', () => {
      expect(verifyInclusion({ a: 1 }, [{ position: 'left' }], 'deadbeef')).toBe(false);
    });

    it('rejects a proof step with an invalid position', () => {
      expect(verifyInclusion({ a: 1 }, [{ position: 'up', hash: 'deadbeef' }], 'deadbeef')).toBe(false);
    });

    it('rejects a proof whose recomputed root does not match', () => {
      const leaves = [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }];
      const tree = buildTree(leaves);
      const proof = inclusionProof(tree, 1);
      expect(verifyInclusion({ a: 999 }, proof, tree.rootHash)).toBe(false);
    });
  });

  describe('consistencyProof', () => {
    it('reports old and new roots for a grown tree', () => {
      const oldLeaves = [{ a: 1 }, { a: 2 }];
      const newLeaves = [{ a: 1 }, { a: 2 }, { a: 3 }];
      const result = consistencyProof(oldLeaves.length, newLeaves);
      expect(result.oldTreeSize).toBe(2);
      expect(result.newTreeSize).toBe(3);
      expect(result.oldRootHash).toBe(buildTree(oldLeaves).rootHash);
      expect(result.newRootHash).toBe(buildTree(newLeaves).rootHash);
    });

    it('handles oldTreeSize of zero (empty prior tree)', () => {
      const newLeaves = [{ a: 1 }];
      const result = consistencyProof(0, newLeaves);
      expect(result.oldRootHash).toBeNull();
      expect(result.newRootHash).toBe(buildTree(newLeaves).rootHash);
    });
  });

  describe('verifyConsistency', () => {
    it('returns true trivially when oldTreeSize is zero', () => {
      expect(verifyConsistency(0, 'anything', [{ a: 1 }])).toBe(true);
    });

    it('returns true when the prefix of newLeaves reproduces the old root', () => {
      const oldLeaves = [{ a: 1 }, { a: 2 }];
      const oldRoot = buildTree(oldLeaves).rootHash;
      const newLeaves = [{ a: 1 }, { a: 2 }, { a: 3 }];
      expect(verifyConsistency(2, oldRoot, newLeaves)).toBe(true);
    });

    it('returns false when the recomputed prefix root diverges from the claimed old root', () => {
      const newLeaves = [{ a: 1 }, { a: 2 }, { a: 3 }];
      expect(verifyConsistency(2, 'not-the-real-root', newLeaves)).toBe(false);
    });
  });
});
