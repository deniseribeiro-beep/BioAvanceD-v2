#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'coverage') continue;
      walk(p, out);
    } else if (/\.(js|mjs|cjs)$/.test(ent.name)) out.push(p);
  }
  return out;
}

const SKIP = [
  path.join('foundation', 'mongoTopologyV2.test.js'),
  path.join('config', 'collections.test.js'),
];

const replacements = [
  [/\bsample_movements:/g, 'sampleMovements:'],
  [/\.collections\.sample_movements\b/g, '.collections.sampleMovements'],
  [/makeCollection\(['"]sample_movements['"]\)/g, "makeCollection('sampleMovements')"],
  [/collection\(['"]sample_movements['"]\)/g, "collection('sampleMovements')"],
  [/createFakeCollection\(['"]sample_movements['"]\)/g, "createFakeCollection('sampleMovements')"],
  // consent_templates → consentTemplates (canonical)
  [/\bconsent_templates:/g, 'consentTemplates:'],
  [/collection\(['"]consent_templates['"]\)/g, "collection('consentTemplates')"],
  [/makeCollection\(['"]consent_templates['"]\)/g, "makeCollection('consentTemplates')"],
  // clinical_units
  [/\bclinical_units:/g, 'clinicalUnits:'],
  [/collection\(['"]clinical_units['"]\)/g, "collection('clinicalUnits')"],
  // disease_dictionary / medication_dictionary / biomarker_observations
  [/\bdisease_dictionary:/g, 'diseaseDictionary:'],
  [/\bmedication_dictionary:/g, 'medicationDictionary:'],
  [/\bbiomarker_observations:/g, 'biomarkerObservations:'],
  [/collection\(['"]disease_dictionary['"]\)/g, "collection('diseaseDictionary')"],
  [/collection\(['"]medication_dictionary['"]\)/g, "collection('medicationDictionary')"],
  [/collection\(['"]biomarker_observations['"]\)/g, "collection('biomarkerObservations')"],
  // makeDb({ patients, ...}) short property names when used as collection maps
  // Only rewrite `patients,` / `patients }` when preceded by makeDb({ or similar — too risky.
  // Instead rewrite bare `patients,` inside makeDb calls via a second pass on known patterns:
  [/makeDb\(\{\s*consentTemplates:\s*([^,]+),\s*patients\b/g, 'makeDb({ consentTemplates: $1, participants'],
  [/makeDb\(\{\s*patients\b/g, 'makeDb({ participants'],
  // variable named patients passed as shorthand property in makeDb
  [/consentTemplates:\s*templates,\s*patients,/g, 'consentTemplates: templates, participants,'],
  [/consentTemplates:\s*templates,\s*patients\b/g, 'consentTemplates: templates, participants'],
  [/,\s*patients,\s*participantIdentities/g, ', participants, participantIdentities'],
  [/,\s*patients\s*\}/g, ', participants }'],
  // seed maps still using patients: var after earlier partial rename
  [/\bpatients:\s*patients\b/g, 'participants: patients'],
  [/\bpatients:\s*patientsCollection\b/g, 'participants: patientsCollection'],
];

const root = path.join(__dirname, '..', 'tests');
let changed = 0;
for (const file of walk(root)) {
  if (SKIP.some((s) => file.endsWith(s))) continue;
  let src = fs.readFileSync(file, 'utf8');
  const orig = src;
  for (const [re, rep] of replacements) src = src.replace(re, rep);
  if (src !== orig) {
    fs.writeFileSync(file, src);
    changed += 1;
    console.log('updated', path.relative(process.cwd(), file));
  }
}
console.log('CHANGED', changed);
