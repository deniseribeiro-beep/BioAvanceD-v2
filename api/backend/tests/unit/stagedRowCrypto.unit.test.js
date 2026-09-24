/**
 * #807 (RNF020 AC#4, RNF029 AC#5): a rejected import row carries the same
 * civil identity that participantIdentities stores encrypted, so it is
 * encrypted at rest in import_staging_records too. The encryption follows
 * the class of the data, not the success or failure of the import.
 *
 * The helper seals `row` and `normalized` into one AES-GCM envelope on write
 * and restores them on read, so the quarantine API and UI see the same shape
 * as before.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const keyRegistry = require('../../src/config/keyRegistry');
const { sealStagedRecord, revealStagedRecord, sealedStagingCollection } = require('../../src/utils/stagedRowCrypto');

const CIVIL_ROW = { Nome: 'Maria da Silva', CPF: '12345678900', 'Data de nascimento': '1980-01-02' };
const NORMALIZED = { patientName: 'Maria da Silva', identityDocument: '12345678900' };

function stagedRecord(overrides = {}) {
  return {
    batchId: 'batch-807',
    rowNumber: 2,
    status: 'ERROR',
    errors: ['CPF invalido'],
    row: CIVIL_ROW,
    normalized: NORMALIZED,
    ...overrides,
  };
}

describe('#807: stagedRowCrypto', () => {
  const originalOptOut = process.env.ALLOW_UNENCRYPTED_FIELD_STORAGE;

  afterEach(() => {
    if (originalOptOut === undefined) delete process.env.ALLOW_UNENCRYPTED_FIELD_STORAGE;
    else process.env.ALLOW_UNENCRYPTED_FIELD_STORAGE = originalOptOut;
  });

  it('writes no civil value in plaintext when a key is configured', () => {
    const sealed = sealStagedRecord(stagedRecord());

    expect(JSON.stringify(sealed)).not.toContain('12345678900');
    expect(JSON.stringify(sealed)).not.toContain('Maria da Silva');
    expect(sealed.row).toBeNull();
    expect(sealed.normalized).toBeNull();
    expect(sealed.sealedPayload).toMatchObject({ alg: 'aes-256-gcm', keyId: 'vitest-key-001' });
  });

  it('keeps the fields a reviewer needs to see why the row was rejected', () => {
    const sealed = sealStagedRecord(stagedRecord());

    expect(sealed).toMatchObject({
      batchId: 'batch-807',
      rowNumber: 2,
      status: 'ERROR',
      errors: ['CPF invalido'],
    });
  });

  it('round-trips: reveal restores row and normalized and drops the envelope', () => {
    const revealed = revealStagedRecord(sealStagedRecord(stagedRecord()));

    expect(revealed.row).toEqual(CIVIL_ROW);
    expect(revealed.normalized).toEqual(NORMALIZED);
    expect(revealed).not.toHaveProperty('sealedPayload');
  });

  // Control case: a record staged before #807 has no envelope, and must read
  // back exactly as it was stored.
  it('reads a legacy plaintext record back unchanged', () => {
    const legacy = stagedRecord();
    expect(revealStagedRecord(legacy)).toEqual(legacy);
  });

  it('leaves a record with nothing to seal untouched', () => {
    const empty = stagedRecord({ row: null, normalized: null });
    expect(sealStagedRecord(empty)).toEqual(empty);
  });

  describe('with no key configured', () => {
    function withoutKey(fn) {
      const original = keyRegistry.getActiveKey;
      keyRegistry.getActiveKey = () => null;
      try {
        return fn();
      } finally {
        keyRegistry.getActiveKey = original;
      }
    }

    it('withholds the civil payload rather than storing it in plaintext', () => {
      delete process.env.ALLOW_UNENCRYPTED_FIELD_STORAGE;
      const sealed = withoutKey(() => sealStagedRecord(stagedRecord()));

      expect(JSON.stringify(sealed)).not.toContain('12345678900');
      expect(sealed.row).toBeNull();
      expect(sealed.normalized).toBeNull();
      expect(sealed.payloadWithheld).toBe('ENCRYPTION_KEY_MISSING');
      // The rejection itself survives: RNF011 AC#4's "sem correcao silenciosa".
      expect(sealed.errors).toEqual(['CPF invalido']);
    });

    it('keeps plaintext only under the explicit ALLOW_UNENCRYPTED_FIELD_STORAGE opt-out', () => {
      process.env.ALLOW_UNENCRYPTED_FIELD_STORAGE = 'true';
      const sealed = withoutKey(() => sealStagedRecord(stagedRecord()));

      expect(sealed.row).toEqual(CIVIL_ROW);
      expect(sealed).not.toHaveProperty('payloadWithheld');
    });
  });
});

/**
 * #1191: the FHIR import staging path keeps civil identity in `normalized`
 * (patientName, patientDocument, patientBirthDate, patientEmail), the whole
 * FHIR Patient resource in `fhir`, and a copy of the email in
 * `consentTracking`, and it reads and updates those records at about fifteen
 * sites. sealedStagingCollection wraps the collection handle so every write
 * seals and every read reveals, without touching the service's own logic.
 */
describe('#1191: sealedStagingCollection', () => {
  const FIELDS = ['row', 'normalized', 'fhir', 'consentTracking'];

  // A minimal in-memory stand-in for a driver collection: enough of
  // insertMany/find/findOne/updateOne($set) to observe what reaches storage.
  function fakeCollection() {
    const docs = [];
    const matches = (doc, filter) =>
      Object.entries(filter || {}).every(([k, v]) => String(doc[k]) === String(v));
    return {
      docs,
      async insertMany(input) {
        input.forEach((d, i) => docs.push({ _id: d._id ?? `id-${docs.length + i}`, ...d }));
        return { insertedCount: input.length };
      },
      find(filter) {
        let out = docs.filter((d) => matches(d, filter));
        const cursor = {
          sort() { return cursor; },
          async toArray() { return out.map((d) => ({ ...d })); },
        };
        return cursor;
      },
      async findOne(filter) {
        const found = docs.find((d) => matches(d, filter));
        return found ? { ...found } : null;
      },
      async updateOne(filter, update) {
        const found = docs.find((d) => matches(d, filter));
        if (found) Object.assign(found, update.$set || {});
        return { matchedCount: found ? 1 : 0 };
      },
    };
  }

  const FHIR_RECORD = {
    _id: 'r1',
    batchId: 'b1',
    rowNumber: 1,
    status: 'VALID',
    normalized: { patientName: 'Joana Lima', patientDocument: '98765432100', patientEmail: 'joana@example.com', specimenId: 'SP-1' },
    fhir: { patient: { name: [{ text: 'Joana Lima' }], birthDate: '1975-03-04' } },
  };

  it('seals every configured field on insert, including fhir', async () => {
    const raw = fakeCollection();
    const staging = sealedStagingCollection(raw, { fields: FIELDS });

    await staging.insertMany([FHIR_RECORD]);

    const atRest = JSON.stringify(raw.docs);
    expect(atRest).not.toContain('Joana Lima');
    expect(atRest).not.toContain('98765432100');
    expect(atRest).not.toContain('1975-03-04');
    expect(raw.docs[0].status).toBe('VALID');
  });

  it('reveals on find().sort().toArray() and on findOne', async () => {
    const raw = fakeCollection();
    const staging = sealedStagingCollection(raw, { fields: FIELDS });
    await staging.insertMany([FHIR_RECORD]);

    const [listed] = await staging.find({ batchId: 'b1' }).sort({ rowNumber: 1 }).toArray();
    const one = await staging.findOne({ _id: 'r1' });

    for (const record of [listed, one]) {
      expect(record.normalized).toEqual(FHIR_RECORD.normalized);
      expect(record.fhir).toEqual(FHIR_RECORD.fhir);
      expect(record).not.toHaveProperty('sealedPayload');
    }
  });

  it('a $set of one sealed field keeps the others and stays sealed', async () => {
    const raw = fakeCollection();
    const staging = sealedStagingCollection(raw, { fields: FIELDS });
    await staging.insertMany([FHIR_RECORD]);

    await staging.updateOne(
      { _id: 'r1' },
      { $set: { status: 'PENDING_CONSENT', consentTracking: { email: 'joana@example.com', sentAt: 'x' } } }
    );

    expect(JSON.stringify(raw.docs)).not.toContain('joana@example.com');
    const after = await staging.findOne({ _id: 'r1' });
    expect(after.status).toBe('PENDING_CONSENT');
    expect(after.consentTracking).toEqual({ email: 'joana@example.com', sentAt: 'x' });
    // The fields the update did not name survive the reseal.
    expect(after.normalized).toEqual(FHIR_RECORD.normalized);
    expect(after.fhir).toEqual(FHIR_RECORD.fhir);
  });

  // Control: an update that names no sealed field is passed through as is.
  it('passes an update naming no sealed field straight through', async () => {
    const raw = fakeCollection();
    const staging = sealedStagingCollection(raw, { fields: FIELDS });
    await staging.insertMany([FHIR_RECORD]);

    await staging.updateOne({ _id: 'r1' }, { $set: { status: 'COMMITTED' } });

    expect(raw.docs[0].status).toBe('COMMITTED');
    expect((await staging.findOne({ _id: 'r1' })).normalized).toEqual(FHIR_RECORD.normalized);
  });
});
