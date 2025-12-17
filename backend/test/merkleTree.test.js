const assert = require('assert');
const { buildTree, getProof, verifyProof, _sha256 } = require('../src/utils/merkleTree');

function testBuildAndVerify() {
  const leaves = ['a', 'b', 'c', 'd'];
  const { root, layers } = buildTree(leaves);

  // Root should be a 64-hex-character SHA256
  assert.strictEqual(typeof root, 'string');
  assert.strictEqual(root.length, 64);
  assert.ok(Array.isArray(layers));

  // Proof for 'c' (index 2) should verify
  const index = 2;
  const proof = getProof(leaves, index);
  assert.ok(Array.isArray(proof));
  assert.strictEqual(verifyProof('c', proof, root), true);

  // Tampered proof should not verify
  const tampered = JSON.parse(JSON.stringify(proof));
  if (tampered.length > 0) {
    tampered[0].hash = '0'.repeat(64);
  }
  assert.strictEqual(verifyProof('c', tampered, root), false);
}

function testSingleLeaf() {
  const leaf = ['only'];
  const { root } = buildTree(leaf);
  // For single leaf, proof is empty array, verifyProof should succeed
  const proof = getProof(leaf, 0);
  assert.deepStrictEqual(proof, []);
  assert.strictEqual(verifyProof('only', proof, root), true);
}

function testEdgeCases() {
  // Out of range index returns null
  const res = getProof(['a'], 5);
  assert.strictEqual(res, null);

  // _sha256 helper produces 64-char hex
  const h = _sha256('test-123');
  assert.strictEqual(typeof h, 'string');
  assert.strictEqual(h.length, 64);
}

// Run tests
(function run() {
  console.log('-> Running merkleTree tests...');
  try {
    testBuildAndVerify();
    testSingleLeaf();
    testEdgeCases();
    console.log('\x1b[32m%s\x1b[0m', '✓ All merkleTree tests passed');
    process.exit(0);
  } catch (err) {
    console.error('\x1b[31m%s\x1b[0m', '✗ Test failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();