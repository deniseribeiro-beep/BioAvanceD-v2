const { getManifest } = require('../src/reference-data/essential');
const miabisSeed = require('../src/reference-data/miabis.min.json');
const sprecSeed = require('../src/reference-data/sprec.min.json');
const rcsReferenceData = require('../src/services/rcs-reference-data');

function fail(messages) {
  for (const message of messages) console.error(message);
  process.exit(1);
}

function ensureUnique(items, keys, label, messages) {
  const seen = new Set();
  for (const item of items) {
    const compound = keys.map((key) => String(item?.[key] ?? '')).join('::');
    if (seen.has(compound)) {
      messages.push(`Duplicate detected in ${label} for keys [${keys.join(', ')}]: ${compound}`);
    }
    seen.add(compound);
  }
}

function main() {
  const messages = [];
  const manifest = getManifest();

  if (!manifest.length) messages.push('Essential manifest is empty.');

  const miabis = manifest.find((entry) => entry.key === 'miabis-minimal');
  const sprec = manifest.find((entry) => entry.key === 'sprec-minimal');
  const rcs = manifest.find((entry) => entry.key === 'rcs-gov-1.0');

  for (const entry of manifest) {
    if (!entry.source) messages.push(`Missing source for ${entry.key}`);
    if (!entry.loader) messages.push(`Missing loader for ${entry.key}`);
    if (!entry.uniqueKeys || !entry.uniqueKeys.length) messages.push(`Missing uniqueKeys for ${entry.key}`);
  }

  if (!miabis) messages.push('MIABIS minimal seed missing from manifest.');
  else {
    for (const key of ['sampleTypes', 'sampleOrigins', 'extractionProtocols', 'qualityDescriptions']) {
      if (!Array.isArray(miabisSeed[key]) || miabisSeed[key].length === 0) messages.push(`MIABIS missing ${key}.`);
      else ensureUnique(miabisSeed[key], ['id'], `miabis.${key}`, messages);
    }
  }

  if (!sprec) messages.push('SPREC minimal seed missing from manifest.');
  else {
    if (!sprecSeed.sistema) messages.push('SPREC missing sistema.');
    if (!sprecSeed.fonte) messages.push('SPREC missing fonte.');
    if (!Array.isArray(sprecSeed.axes) || sprecSeed.axes.length === 0) messages.push('SPREC missing axes.');
    else ensureUnique(sprecSeed.axes, ['axis', 'code'], 'sprec.axes', messages);
  }

  if (!rcs) messages.push('RCS-GOV seed missing from manifest.');
  else {
    const requiredKeys = ['catalogs', 'severityMappings', 'weights', 'thresholds', 'governanceRules'];
    for (const key of requiredKeys) {
      if (!rcsReferenceData[key]) messages.push(`RCS missing ${key}.`);
    }
  }

  if (manifest.some((entry) => ['hpo', 'orpha', 'cid', 'omim', 'mondo'].some((blocked) => entry.key.includes(blocked)))) {
    messages.push('Blocked large dataset present in essential manifest.');
  }

  if (messages.length) fail(messages);
  console.log('Essential reference data validation passed.');
}

main();
