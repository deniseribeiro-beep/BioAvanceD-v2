const crypto = require('crypto');

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function buildMerkleTree(leaves) {
  const leafHashes = (leaves || []).map((leaf) => String(leaf));
  if (leafHashes.length === 0) {
    return { root: null, layers: [leafHashes] };
  }

  const layers = [leafHashes];
  let currentLayer = leafHashes;

  while (currentLayer.length > 1) {
    const nextLayer = [];
    for (let i = 0; i < currentLayer.length; i += 2) {
      const left = currentLayer[i];
      const right = currentLayer[i + 1] || currentLayer[i];
      nextLayer.push(sha256Hex(left + right));
    }
    layers.push(nextLayer);
    currentLayer = nextLayer;
  }

  return { root: currentLayer[0], layers };
}

function getProofForIndex(layers, index) {
  const proof = [];
  let idx = index;

  for (let level = 0; level < layers.length - 1; level += 1) {
    const layer = layers[level];
    const isRightNode = idx % 2 === 1;
    const pairIndex = isRightNode ? idx - 1 : idx + 1;
    const pairHash = layer[pairIndex] || layer[idx];

    proof.push({
      position: isRightNode ? 'left' : 'right',
      hash: pairHash
    });

    idx = Math.floor(idx / 2);
  }

  return proof;
}

function getProofForHash(leaves, layers, hash) {
  const index = leaves.findIndex((leaf) => leaf === hash);
  if (index === -1) return null;
  return getProofForIndex(layers, index);
}

function verifyProof(hash, proof, root) {
  if (!hash || !root || !Array.isArray(proof)) return false;

  let computed = String(hash);
  for (const step of proof) {
    if (!step || !step.hash) return false;
    if (step.position === 'left') {
      computed = sha256Hex(step.hash + computed);
    } else if (step.position === 'right') {
      computed = sha256Hex(computed + step.hash);
    } else {
      return false;
    }
  }

  return computed === root;
}

module.exports = {
  sha256Hex,
  buildMerkleTree,
  getProofForIndex,
  getProofForHash,
  verifyProof
};
