// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375. History: #138, #148, #182, #375, #393.
//
// #967: catalog.2.0.0.json (the approved v2.0.0 release, 1644 elements,
// generated from docs/extracted-v2.0.0/dict-DICIONARIO.md -- see
// canonical-dictionary/v2.js's own header) names the canonical
// field for every entity, and nothing in the repo compared those names
// against the shape the runtime code actually produces. This is that
// comparison, for 18 entities: SecurityConfiguration (a service singleton's
// getDefaultConfig()) plus 17 models exposing a pure `static fieldsOf(data =
// {})`. It must stay green while recording every drift it finds explicitly,
// in KNOWN_DRIFT -- both a new, undeclared drift and a KNOWN_DRIFT entry that
// no longer matches reality are failures (see diffEntity below for how the
// second half works).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadCanonicalDictionary } = require('../../src/reference-data/canonical-dictionary/v2');

// Recurse only into a plain nested object. `null` (`typeof null === 'object'`)
// and `Date` (`Object.entries(aDate)` is `[]`) both look like "nothing here"
// to a naive recursion and would silently vanish from the flattened path
// list -- exactly the failure this whole guard exists to catch, just moved
// one level down into its own plumbing. Both traps are live in
// SecurityConfiguration's own getDefaultConfig() output (lastUpdatedBy: null,
// lastUpdatedAt: new Date()), which is why the dedicated pinning test below
// uses that exact shape rather than a hypothetical one.
function flattenKeys(value, prefix = '') {
  const paths = [];
  for (const [key, v] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      paths.push(...flattenKeys(v, path));
    } else {
      paths.push(path);
    }
  }
  return paths;
}

// Shape A: a service singleton, pure getDefaultConfig(). Shape B: a model's
// pure `static fieldsOf(data = {})`. Every entry below was read, not
// guessed from its filename -- RcsAssessment.js/RcsAssessmentModel is the
// concrete case where filename and canonical entity name diverge
// (catalog entity is "RCSAssessment", all-caps RCS).
const ENTITY_TARGETS = {
  SecurityConfiguration: () => require('../../src/services/security.service').getDefaultConfig(),
  AllergyIntolerance: () => require('../../src/models/AllergyIntolerance').fieldsOf(),
  ClinicalObservation: () => require('../../src/models/ClinicalObservation').fieldsOf(),
  ClinicalOutcome: () => require('../../src/models/ClinicalOutcome').fieldsOf(),
  Condition: () => require('../../src/models/Condition').fieldsOf(),
  DerivedScore: () => require('../../src/models/DerivedScore').fieldsOf(),
  Encounter: () => require('../../src/models/Encounter').fieldsOf(),
  FamilyHistory: () => require('../../src/models/FamilyHistory').fieldsOf(),
  MedicationExposure: () => require('../../src/models/MedicationExposure').fieldsOf(),
  ParticipantIdentity: () => require('../../src/models/ParticipantIdentity').fieldsOf(),
  Permission: () => require('../../src/models/Permission').fieldsOf(),
  PhenotypeObservation: () => require('../../src/models/PhenotypeObservation').fieldsOf(),
  Procedure: () => require('../../src/models/Procedure').fieldsOf(),
  QuarantineAction: () => require('../../src/models/QuarantineAction').fieldsOf(),
  RCSAssessment: () => require('../../src/models/RcsAssessment').fieldsOf(),
  Role: () => require('../../src/models/Role').fieldsOf(),
  SpecimenPreanalytics: () => require('../../src/models/SpecimenPreanalytics').fieldsOf(),
  UserRoleAssignment: () => require('../../src/models/UserRoleAssignment').fieldsOf(),
};

// Drift measured against catalog.1.3.0.json, 2026-09-02, and re-measured
// against catalog.2.0.0.json, 2026-10-07, via loadCanonicalDictionary() and
// each ENTITY_TARGETS entry above. The v2.0.0 re-measure changed only
// RCSAssessment: 16 V2E elements absent, which name the issue that builds
// them (TODO(#1320)), and two former extras (finalGrade, gradeRoute) that
// v2.0.0 made canonical. Every other entry carries TODO(#967) and a
// one-line note of what the drift is, per the issue's own instruction --
// populated from what running the diff actually produced, not from a list
// handed down in advance. An entity absent from this table has zero measured
// drift. `absent` entries are canonical elementIds the code never emits;
// `extra` entries are code keys with no canonical counterpart.
const KNOWN_DRIFT = {
  SecurityConfiguration: {
    absent: [
      {
        elementId: 'P1X-0276', field: 'securityConfigId',
        note: "TODO(#967): 1..1 Core -- getDefaultConfig() carries no id field; the collection's Mongo _id: 'main' plays that role only at the persistence layer (security.service.js#getConfig), never in the object this test inspects."
      },
      {
        elementId: 'P1X-0277', field: 'environment',
        note: 'TODO(#967): 1..1 Core -- catalog wants an environment discriminator (e.g. prod/staging); getDefaultConfig() emits none.'
      },
      {
        elementId: 'P1X-0324', field: 'effectivePeriod',
        note: 'TODO(#967): 0..1 Essencial -- not emitted.'
      }
    ],
    extra: [
      {
        key: 'passwordRules.minLengthWithMFA',
        note: '#1257: deliberate. NIST SP 800-63B-4 section 3.1.1.2 sets two length floors, 15 for a password used as a single factor and 8 for one used with MFA, and dict-02 has one minLength (P1X-0284), which carries the single-factor floor. The MFA floor has no canonical row.'
      }
    ]
  },
  DerivedScore: {
    absent: [],
    extra: [
      {
        key: 'derivedScoreId',
        note: "TODO(#967): DerivedScoreModel's own generated-id key has no canonical dict-02 field row for DerivedScore at all."
      }
    ]
  },
  Encounter: {
    absent: [
      {
        elementId: 'ELM-0197', field: 'encounterPeriod',
        note: 'TODO(#967): 1..1 Core -- catalog names the Period itself as one field; the model only emits its two leaves (see the two extras below), so the parent path never appears in the flattened code keys.'
      }
    ],
    extra: [
      {
        key: 'encounterPeriod.start',
        note: 'TODO(#967): leaf of the Period the catalog names only at the parent path ELM-0197 (absent above).'
      },
      {
        key: 'encounterPeriod.end',
        note: 'TODO(#967): leaf of the Period the catalog names only at the parent path ELM-0197 (absent above).'
      }
    ]
  },
  ParticipantIdentity: {
    absent: [
      { elementId: 'P1X-0348', field: 'participantIdentityId', note: 'TODO(#967): 1..1 Core -- ParticipantIdentityModel has no id field of its own at all.' },
      { elementId: 'P1X-0354', field: 'identityDocumentCiphertext', note: 'TODO(#967): 0..1 Condicional -- model stores identityDocument in the clear (see the identityDocument extra below), not as ciphertext.' },
      { elementId: 'P1X-0355', field: 'recordNumberCiphertext', note: 'TODO(#967): 0..1 Condicional -- not emitted.' },
      { elementId: 'P1X-0356', field: 'clinicalUnitId', note: 'TODO(#967): 0..1 Condicional -- not emitted.' },
      { elementId: 'P1X-0359', field: 'representativeIdentityDocumentCiphertext', note: 'TODO(#967): 0..1 Condicional -- model stores representativeIdentityDocument in the clear (see the extra below), not as ciphertext.' },
      { elementId: 'P1X-0361', field: 'identityStatus', note: 'TODO(#967): 1..1 Core -- not emitted.' },
      { elementId: 'P1X-0362', field: 'encryptionKeyVersion', note: 'TODO(#967): 1..1 Core -- not emitted, consistent with no ciphertext field being emitted either.' },
      { elementId: 'P1X-0363', field: 'lastVerifiedAt', note: 'TODO(#967): 0..1 Condicional -- not emitted.' },
      { elementId: 'P1X-0364', field: 'verifiedBy', note: 'TODO(#967): 0..1 Condicional -- not emitted.' }
    ],
    extra: [
      {
        key: 'identityDocument',
        note: 'TODO(#967): plaintext field with no canonical counterpart -- the catalog only names identityDocumentCiphertext (P1X-0354, absent above).'
      },
      {
        key: 'representativeIdentityDocument',
        note: 'TODO(#967): plaintext field with no canonical counterpart -- the catalog only names representativeIdentityDocumentCiphertext (P1X-0359, absent above).'
      }
    ]
  },
  QuarantineAction: {
    absent: [
      {
        elementId: 'P1X-0116', field: 'startedAt',
        note: 'TODO(#967): 1..1 Core -- fieldsOf() does not set it; QuarantineActionModel.create() sets it separately, outside fieldsOf(), so this registry (which calls fieldsOf() directly, per #967\'s own instruction) never sees it.'
      },
      {
        elementId: 'P1X-0117', field: 'releasedAt',
        note: 'TODO(#967): 0..1 Condicional -- same as startedAt: set by create()/release(), not fieldsOf().'
      }
    ],
    extra: []
  },
  RCSAssessment: {
    absent: [
      { elementId: 'ELM-0160', field: 'rcsGrade', note: 'TODO(#967): 0..1 Core -- not emitted; finalGrade is its own v2.0.0 element (V2E-0541), so it is not a rename of this one.' },
      { elementId: 'ELM-0161', field: 'rcsModelVersion', note: 'TODO(#967): 1..1 Core -- code emits modelVersion (extra below), not this canonical name.' },
      { elementId: 'ELM-0162', field: 'sprecRcsMappingVersion', note: 'TODO(#967): 1..1 Core -- not emitted.' },
      { elementId: 'ELM-0163', field: 'rcsAxisResults', note: 'TODO(#967): 0..* Core -- code emits axisPenalties (extra below), not this canonical name.' },
      { elementId: 'ELM-0164', field: 'governanceGateResult', note: 'TODO(#967): 1..1 Core -- code emits governanceStatus (extra below), not this canonical name.' },
      { elementId: 'ELM-0165', field: 'unmappedCodes', note: 'TODO(#967): 0..* Condicional -- not emitted.' },
      { elementId: 'ELM-0166', field: 'rcsCalculatedAt', note: 'TODO(#967): 0..1 Core -- not emitted by fieldsOf(); create() sets a separate assessedAt outside fieldsOf().' },
      { elementId: 'P1X-0060', field: 'rcsAssessmentId', note: 'TODO(#967): 1..1 Core -- RcsAssessmentModel has no id field of its own at all.' },
      { elementId: 'P1X-0062', field: 'sprecProfileId', note: 'TODO(#967): 1..1 Core -- not emitted; no reference back to the SpecimenPreanalytics snapshot this assessment was computed from.' },
      { elementId: 'P1X-0064', field: 'biologicalPenalty', note: 'TODO(#967): 0..1 Condicional -- not emitted.' },
      { elementId: 'P1X-0066', field: 'decisionRoute', note: 'TODO(#967): 1..1 Core -- not emitted; gradeRoute is its own v2.0.0 element (V2E-0542), so it is not a rename of this one.' },
      { elementId: 'P1X-0067', field: 'governanceChecks', note: 'TODO(#967): 1..* Core -- code emits governanceRuleCodes (extra below), not this canonical name.' },
      { elementId: 'P1X-0068', field: 'governanceFailureCodes', note: 'TODO(#967): 0..* Condicional -- code emits governanceFailureReasons (extra below), not this canonical name.' },
      { elementId: 'P1X-0069', field: 'inputSnapshotHash', note: 'TODO(#967): 1..1 Core -- not emitted.' },
      { elementId: 'P1X-0070', field: 'evidenceRefs', note: 'TODO(#967): 0..* Essencial -- not emitted.' },
      { elementId: 'P1X-0071', field: 'calculationStatus', note: 'TODO(#967): 1..1 Core -- code emits calculationTrace (extra below), a free-form value, not this canonical status field.' },
      { elementId: 'V2E-0439', field: 'qualificationContext', note: 'TODO(#1320): 1..1 Core -- v2.0.0 element (added), not emitted; RCS v4 builds it.' },
      { elementId: 'V2E-0440', field: 'intendedUseCode', note: 'TODO(#1320): 1..1 Core -- v2.0.0 element (added), not emitted; RCS v4 builds it.' },
      { elementId: 'V2E-0441', field: 'targetAnalyte', note: 'TODO(#1320): 1..1 Core -- v2.0.0 element (added), not emitted; RCS v4 builds it.' },
      { elementId: 'V2E-0442', field: 'assayFamily', note: 'TODO(#1320): 1..1 Core -- v2.0.0 element (added), not emitted; RCS v4 builds it.' },
      { elementId: 'V2E-0443', field: 'workflowProtocolId', note: 'TODO(#1320): 1..1 Core -- v2.0.0 element (added), not emitted; RCS v4 builds it.' },
      { elementId: 'V2E-0444', field: 'workflowProtocolVersion', note: 'TODO(#1320): 1..1 Core -- v2.0.0 element (added), not emitted; RCS v4 builds it.' },
      { elementId: 'V2E-0445', field: 'rulePackageVersion', note: 'TODO(#1320): 1..1 Core -- v2.0.0 element (added), not emitted; RCS v4 builds it.' },
      { elementId: 'V2E-0446', field: 'rulePackageChecksum', note: 'TODO(#1320): 1..1 Core -- v2.0.0 element (added), not emitted; RCS v4 builds it.' },
      { elementId: 'V2E-0447', field: 'inputSnapshotUri', note: 'TODO(#1320): 1..1 Core -- v2.0.0 element (added), not emitted; RCS v4 builds it.' },
      { elementId: 'V2E-0448', field: 'sprecVersion', note: 'TODO(#1320): 1..1 Core -- v2.0.0 element (added), not emitted; RCS v4 builds it.' },
      { elementId: 'V2E-0449', field: 'executionEnvironment', note: 'TODO(#1320): 1..1 Core -- v2.0.0 element (added), not emitted; RCS v4 builds it.' },
      { elementId: 'V2E-0450', field: 'justifications', note: 'TODO(#1320): 1..* Core -- v2.0.0 element (added), not emitted; RCS v4 builds it.' },
      { elementId: 'V2E-0538', field: 'inputSnapshotId', note: 'TODO(#1320): 1..1 Core -- v2.0.0 element (added), not emitted; RCS v4 builds it.' },
      { elementId: 'V2E-0539', field: 'preanalyticalPenalty', note: 'TODO(#1320): 0..1 Conditional -- v2.0.0 element (added), not emitted; RCS v4 builds it.' },
      { elementId: 'V2E-0540', field: 'score', note: 'TODO(#1320): 0..1 Conditional -- v2.0.0 element (added), not emitted; RCS v4 builds it.' },
      { elementId: 'V2E-0543', field: 'routeReasons', note: 'TODO(#1320): 1..* Core -- v2.0.0 element (added), not emitted; RCS v4 builds it.' }
    ],
    extra: [
      { key: 'modelVersion', note: 'TODO(#967): no canonical counterpart; likely predecessor of rcsModelVersion (ELM-0161, absent above).' },
      { key: 'governanceStatus', note: 'TODO(#967): no canonical counterpart; likely predecessor of governanceGateResult (ELM-0164, absent above).' },
      { key: 'governanceFailureReasons', note: 'TODO(#967): no canonical counterpart; likely predecessor of governanceFailureCodes (P1X-0068, absent above).' },
      { key: 'governanceRuleCodes', note: 'TODO(#967): no canonical counterpart; likely predecessor of governanceChecks (P1X-0067, absent above).' },
      { key: 'axisPenalties', note: 'TODO(#967): no canonical counterpart; likely predecessor of rcsAxisResults (ELM-0163, absent above).' },
      { key: 'calculationTrace', note: 'TODO(#967): no canonical counterpart; free-form trace value, not calculationStatus (P1X-0071, absent above).' }
    ]
  },
  SpecimenPreanalytics: {
    absent: [],
    extra: [
      { key: 'matrixType', note: "TODO(#967): SpecimenPreanalytics.js's own header documents this as one of the generic axis-position slots import.service.js populates from CSV columns, from which the sprec* canonical names are derived -- no canonical field named exactly matrixType." },
      { key: 'sampleType', note: 'TODO(#967): generic axis slot; sprecSpecimenType is the derived canonical field, already present and matched.' },
      { key: 'primaryContainer', note: 'TODO(#967): generic axis slot; sprecPrimaryContainer/sprecCollectionType are the derived canonical fields, already present and matched.' },
      { key: 'preCentrifugation', note: 'TODO(#967): generic axis slot; warmIschemiaTime/preCentrifugationDelay are the derived canonical fields, already present and matched.' },
      { key: 'centrifugation', note: 'TODO(#967): generic axis slot; coldIschemiaTime/firstCentrifugation are the derived canonical fields, already present and matched.' }
    ]
  }
};

// The comparison itself, factored out so the synthetic self-test below can
// exercise it without touching ENTITY_TARGETS/KNOWN_DRIFT. `known` defaults
// to no allowance at all, so calling this without a third argument is
// exactly "everything measured must match the catalog exactly".
//
// Both directions of drift are checked, which is what keeps KNOWN_DRIFT from
// rotting: an entry that no longer corresponds to a real absence/extra (the
// code was fixed, or the catalog changed) is reported exactly as loudly as a
// brand-new, undeclared one.
function diffEntity(entity, canonicalRows, codeObject, known = { absent: [], extra: [] }) {
  const codeKeys = new Set(flattenKeys(codeObject));
  const canonicalFieldSet = new Set(canonicalRows.map((row) => row.field));

  const actualAbsent = canonicalRows.filter((row) => !codeKeys.has(row.field));
  const actualExtra = [...codeKeys].filter((key) => !canonicalFieldSet.has(key));

  const knownAbsentIds = new Set(known.absent.map((entry) => entry.elementId));
  const knownExtraKeys = new Set(known.extra.map((entry) => entry.key));

  const messages = [];

  for (const row of actualAbsent) {
    if (!knownAbsentIds.has(row.elementId)) {
      messages.push(
        `${entity} ${row.elementId} '${row.field}' (${row.cardinality} ${row.requirement}) is `
          + 'absent from the runtime object and not declared in KNOWN_DRIFT -- new drift: '
          + 'either make the code emit it, or add a TODO(#967) entry'
      );
    }
  }
  for (const entry of known.absent) {
    if (!actualAbsent.some((row) => row.elementId === entry.elementId)) {
      messages.push(
        `${entity} KNOWN_DRIFT.absent entry ${entry.elementId} '${entry.field}' is stale -- `
          + 'the code now emits this field, so the allowance no longer corresponds to real '
          + 'drift; remove the entry'
      );
    }
  }
  for (const key of actualExtra) {
    if (!knownExtraKeys.has(key)) {
      messages.push(
        `${entity} code key '${key}' has no canonical catalog counterpart and is not declared `
          + 'in KNOWN_DRIFT -- new drift: either remove the key, rename it to the canonical '
          + 'field, or add a TODO(#967) entry'
      );
    }
  }
  for (const entry of known.extra) {
    if (!actualExtra.includes(entry.key)) {
      messages.push(
        `${entity} KNOWN_DRIFT.extra entry '${entry.key}' is stale -- the code no longer `
          + 'emits an unmatched key by that name, so the allowance no longer corresponds to '
          + 'real drift; remove the entry'
      );
    }
  }

  return messages;
}

test('flattenKeys treats a null value and a Date instance as leaves, never recursing into them', () => {
  // Both traps are live in SecurityConfiguration's own getDefaultConfig()
  // output (lastUpdatedBy: null, lastUpdatedAt: new Date()) -- a naive
  // `typeof v === 'object'` recursion yields zero leaves for either and the
  // field silently vanishes, which would make the conformance test below
  // pass by omission rather than by an honest match. Pinned directly here,
  // independent of getDefaultConfig()'s actual current shape.
  const paths = flattenKeys({ a: null, b: new Date(), c: { d: 1 } });
  assert.deepEqual(paths, ['a', 'b', 'c.d']);
});

test('#967: every registered entity has at least one canonical catalog row', () => {
  // A typo'd entity name in ENTITY_TARGETS or KNOWN_DRIFT would silently
  // compare against zero catalog rows -- every field would read as "extra",
  // which offendersIn-style guards elsewhere in this suite treat as the
  // under-collection risk worth a floor check for.
  const catalog = loadCanonicalDictionary();
  const missing = Object.keys(ENTITY_TARGETS).filter(
    (entity) => !catalog.some((row) => row.entity === entity)
  );
  assert.deepEqual(missing, [], `no catalog rows at all for: ${missing.join(', ')} -- check the entity name`);
});

test('#967: canonical catalog fields match the runtime shape ENTITY_TARGETS produce, modulo KNOWN_DRIFT', () => {
  const catalog = loadCanonicalDictionary();
  const messages = [];

  for (const [entity, buildCodeObject] of Object.entries(ENTITY_TARGETS)) {
    const canonicalRows = catalog.filter((row) => row.entity === entity);
    const known = KNOWN_DRIFT[entity] || { absent: [], extra: [] };
    messages.push(...diffEntity(entity, canonicalRows, buildCodeObject(), known));
  }

  assert.deepEqual(
    messages,
    [],
    'catalog.2.0.0.json field names and the runtime object the code actually '
      + 'produces disagree, in a way KNOWN_DRIFT does not (yet) account for. '
      + '1..1 Core absences are the serious class -- fix the code, or file the '
      + 'drift as a TODO(#967) KNOWN_DRIFT entry with a one-line note:\n  '
      + messages.join('\n  ')
  );
});

test('#967: the guard actually detects new drift, a clean match, and a stale KNOWN_DRIFT entry', () => {
  // The failure mode of "compare two sets and assert equal" is a silently
  // vacuous comparison (e.g. both sides accidentally empty) -- so exercise
  // diffEntity directly against synthetic catalog rows and a synthetic code
  // object, entirely separate from ENTITY_TARGETS/KNOWN_DRIFT above.
  const canonicalRows = [
    { elementId: 'X-1', entity: 'Widget', field: 'a', cardinality: '1..1', requirement: 'Core' },
    { elementId: 'X-2', entity: 'Widget', field: 'b', cardinality: '0..1', requirement: 'Essencial' }
  ];

  // Undeclared: 'a' matches (silent, correctly not reported), 'b' is
  // absent from the code, and 'c' is an extra code key -- neither is in any
  // KNOWN_DRIFT allowance, so both must be flagged.
  const undeclared = diffEntity('Widget', canonicalRows, { a: 1, c: 2 });
  assert.equal(undeclared.length, 2, `expected exactly 2 messages, got:\n  ${undeclared.join('\n  ')}`);
  assert.ok(undeclared.some((m) => m.includes("X-2 'b'")), "missing 'b' absence message");
  assert.ok(undeclared.some((m) => m.includes("key 'c'")), "missing 'c' extra-key message");

  // Declaring both in KNOWN_DRIFT silences them.
  const known = {
    absent: [{ elementId: 'X-2', field: 'b' }],
    extra: [{ key: 'c' }]
  };
  const declared = diffEntity('Widget', canonicalRows, { a: 1, c: 2 }, known);
  assert.deepEqual(declared, [], `a fully-declared drift set still reported:\n  ${declared.join('\n  ')}`);

  // If the code is then fixed (b now emitted, c no longer emitted), the
  // same KNOWN_DRIFT table is now stale on both entries -- that must be
  // flagged too, or the table could rot indefinitely once a fix lands.
  const stale = diffEntity('Widget', canonicalRows, { a: 1, b: 2 }, known);
  assert.equal(stale.length, 2, `expected exactly 2 staleness messages, got:\n  ${stale.join('\n  ')}`);
  assert.ok(stale.every((m) => m.includes('stale')), `expected only staleness messages:\n  ${stale.join('\n  ')}`);
});
