import { describe, it, expect } from 'vitest';

const { buildTree, getProof, verifyProof, _sha256 } = require('../../src/utils/merkleTree');

describe('Merkle integrity', () => {
  it('invalida a raiz quando 1 bit do dado é alterado', () => {
    const payload = JSON.stringify({ sampleID: 'S-1', patientID: '12345678', value: 'ABCD' });
    const binaryChar = payload.charCodeAt(0);
    const flipped = String.fromCharCode(binaryChar ^ 0b00000001) + payload.slice(1);

    const originalLeaf = _sha256(payload);
    const tamperedLeaf = _sha256(flipped);

    const originalTree = buildTree([originalLeaf, _sha256('anchor')]);
    const tamperedTree = buildTree([tamperedLeaf, _sha256('anchor')]);

    expect(originalTree.root).not.toBe(tamperedTree.root);

    const proof = getProof([originalLeaf, _sha256('anchor')], 0);
    expect(verifyProof(originalLeaf, proof, originalTree.root)).toBe(true);
    expect(verifyProof(tamperedLeaf, proof, originalTree.root)).toBe(false);
  });
});
