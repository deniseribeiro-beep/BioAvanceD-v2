const crypto = require('crypto');
const { canonicalize } = require('./audit-canonicalization.service');

function hashHex(prefix, buffers) {
  const hash = crypto.createHash('sha256');
  hash.update(Buffer.from([prefix]));
  for (const item of buffers) hash.update(item);
  return hash.digest('hex');
}

function leafHash(canonicalLeaf) {
  return hashHex(0x00, [Buffer.from(canonicalize(canonicalLeaf), 'utf8')]);
}

function nodeHash(leftHash, rightHash) {
  return hashHex(0x01, [Buffer.from(leftHash, 'hex'), Buffer.from(rightHash, 'hex')]);
}

function buildTree(leaves) {
  const leafHashes = leaves.map(leafHash);
  if (leafHashes.length === 0) return { rootHash: null, treeSize: 0, leafHashes: [], layers: [] };
  let layer = leafHashes.slice();
  const layers = [layer.slice()];
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) next.push(nodeHash(layer[i], layer[i + 1] || layer[i]));
    layer = next;
    layers.push(layer.slice());
  }
  return { rootHash: layer[0], treeSize: leafHashes.length, leafHashes, layers };
}

function inclusionProof(tree, leafIndex) {
  const proof = [];
  let idx = leafIndex;
  for (let level = 0; level < tree.layers.length - 1; level += 1) {
    const layer = tree.layers[level];
    const isRight = idx % 2 === 1;
    const sibling = isRight ? layer[idx - 1] : (layer[idx + 1] || layer[idx]);
    proof.push({ position: isRight ? 'left' : 'right', hash: sibling });
    idx = Math.floor(idx / 2);
  }
  return proof;
}

function verifyInclusion(leaf, proof, rootHash) {
  if (!rootHash || !Array.isArray(proof)) return false;
  let current = leafHash(leaf);
  for (const step of proof) {
    if (!step || !step.hash || (step.position !== 'left' && step.position !== 'right')) return false;
    current = step.position === 'left' ? nodeHash(step.hash, current) : nodeHash(current, step.hash);
  }
  return current === rootHash;
}

function consistencyProof(oldTreeSize, newLeaves) {
  return {
    oldTreeSize,
    newTreeSize: newLeaves.length,
    oldRootHash: buildTree(newLeaves.slice(0, oldTreeSize)).rootHash,
    newRootHash: buildTree(newLeaves).rootHash,
  };
}

function verifyConsistency(oldTreeSize, oldRootHash, newLeaves) {
  if (oldTreeSize === 0) return true;
  const oldTree = buildTree(newLeaves.slice(0, oldTreeSize));
  return oldTree.rootHash === oldRootHash;
}

module.exports = {
  leafHash,
  nodeHash,
  buildTree,
  inclusionProof,
  verifyInclusion,
  consistencyProof,
  verifyConsistency,
};
