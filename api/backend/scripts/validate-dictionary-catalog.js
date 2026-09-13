const canonicalDictionary = require('../src/reference-data/canonical-dictionary');

function fail(messages) {
  for (const message of messages) console.error(message);
  process.exitCode = 1;
}

async function main() {
  const completeness = await canonicalDictionary.checkCompleteness();
  const checksum = await canonicalDictionary.dictionaryChecksum();
  const messages = [];

  if (completeness.loadedTotal !== completeness.expectedTotal) {
    messages.push(`Canonical dictionary v2.0.0 has ${completeness.loadedTotal} elements, expected ${completeness.expectedTotal}.`);
  }
  if (completeness.historicalTotal !== completeness.expectedHistoricalTotal) {
    messages.push(`Historical element accounting is ${completeness.historicalTotal}, expected ${completeness.expectedHistoricalTotal}.`);
  }
  if (completeness.newTotal !== completeness.expectedNewTotal) {
    messages.push(`V2 element accounting is ${completeness.newTotal}, expected ${completeness.expectedNewTotal}.`);
  }
  if (completeness.entityTotal !== completeness.expectedEntityTotal) {
    messages.push(`Canonical entity/artifact accounting is ${completeness.entityTotal}, expected ${completeness.expectedEntityTotal}.`);
  }
  if (completeness.duplicateIds.length) {
    messages.push(`Duplicate element IDs: ${completeness.duplicateIds.join(', ')}`);
  }
  if (completeness.missingRequiredFieldIds.length) {
    messages.push(`Elements missing executable contract metadata: ${completeness.missingRequiredFieldIds.join(', ')}`);
  }
  if (completeness.nonPhaseOneIds.length) {
    messages.push(`Elements outside Foundation preparation Phase 1: ${completeness.nonPhaseOneIds.join(', ')}`);
  }
  if (!completeness.verified) {
    messages.push('Canonical dictionary v2.0.0 completeness gate did not verify.');
  }

  if (messages.length) {
    fail(messages);
    return;
  }

  console.log(JSON.stringify({
    status: 'PASS',
    dictionaryVersion: completeness.dictionaryVersion,
    sourceSheet: completeness.sourceSheet,
    loadedTotal: completeness.loadedTotal,
    historicalTotal: completeness.historicalTotal,
    newTotal: completeness.newTotal,
    entityTotal: completeness.entityTotal,
    checksum,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
