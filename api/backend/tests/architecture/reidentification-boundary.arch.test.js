// node:test-only by contract (README.md Test Strategy -- vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375.
//
// #586 (RF005/RNF007 AC4/AC5, #560): civil identity is resolved in one
// place, POST /api/patients/:id/reidentify. That route is gated on
// `reidentifyParticipant` and on organization scope, requires a `reason`,
// and audits every call (paciente.controller.js#reidentify).
//
// fhir.service.js#toFhirPatient takes the identity as an argument, so the
// first FHIR patient export will need one. The easy way to get it is a
// direct call to getIdentityByParticipantId, which would make the export an
// unaudited re-identification path. Nothing calls toFhirPatient today. This
// test fails the day something does, or the day identity is resolved
// outside the audited route, so the change has to be made deliberately:
// gate the new route on reidentifyParticipant, take the identity through
// the audited path, prove the route refuses a caller without the
// permission, and only then add it below.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');
const { readStripped, stripComments } = require('./helpers/strip-comments');

const BACKEND_SRC = path.resolve(__dirname, '../../src');

// Modules allowed to call each function, relative to src/.
const ALLOWED_CALLERS = {
  // The audited, permission-gated re-identification route.
  getIdentityByParticipantId: ['controllers/paciente.controller.js'],
  // None yet: see the header for what a first caller must bring.
  toFhirPatient: [],
};

const DEFINITIONS = {
  getIdentityByParticipantId: 'services/participantIdentity.service.js',
  toFhirPatient: 'services/fhir.service.js',
};

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const relative = (file) => path.relative(BACKEND_SRC, file).split(path.sep).join('/');
const callPattern = (name) => new RegExp(`\\b${name}\\s*\\(`);

function callersOf(name) {
  return walk(BACKEND_SRC)
    .filter((file) => relative(file) !== DEFINITIONS[name])
    .filter((file) => callPattern(name).test(readStripped(fs, file)))
    .map(relative)
    .sort();
}

for (const name of Object.keys(ALLOWED_CALLERS)) {
  test(`${name} is called only from the audited re-identification path`, () => {
    const unexpected = callersOf(name).filter((file) => !ALLOWED_CALLERS[name].includes(file));
    assert.deepEqual(unexpected, [], `${name} called from ${unexpected.join(', ')}: see this file's header (#586)`);
  });
}

test('the allowed re-identification route is still gated on reidentifyParticipant', () => {
  const routes = readStripped(fs, path.join(BACKEND_SRC, 'interface/routes/patient.routes.js'));
  assert.match(routes, /\/:id\/reidentify'[^\n]*reidentifyParticipant[^\n]*patientController\.reidentify/);
});

// Controls: the allowed caller is really seen, so an empty result above
// is not a matcher that sees nothing, and a comment is not a call.
test('control: the matcher finds the one allowed caller and ignores comments', () => {
  assert.deepEqual(callersOf('getIdentityByParticipantId'), ['controllers/paciente.controller.js']);
  assert.ok(!callPattern('toFhirPatient').test(stripComments('// toFhirPatient(p, identity)')));
});
