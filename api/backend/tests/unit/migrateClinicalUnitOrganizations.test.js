import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const scriptPath = require.resolve('../../src/scripts/migrateClinicalUnitOrganizations');
const mongodbPath = require.resolve('mongodb');

const originalEnv = { ...process.env };

function loadScriptWithFakeMongo({ connect, db }) {
  const originalMongoModuleRecord = require.cache[mongodbPath];
  const { ObjectId: RealObjectId } = require('mongodb');

  function FakeMongoClient(uri) {
    this.uri = uri;
  }
  FakeMongoClient.prototype.connect = connect;
  FakeMongoClient.prototype.db = db;
  FakeMongoClient.prototype.close = vi.fn().mockResolvedValue(undefined);

  require.cache[mongodbPath] = {
    id: mongodbPath,
    filename: mongodbPath,
    loaded: true,
    exports: { MongoClient: FakeMongoClient, ObjectId: RealObjectId },
  };

  delete require.cache[scriptPath];
  const mod = require('../../src/scripts/migrateClinicalUnitOrganizations');

  return {
    mod,
    FakeMongoClient,
    restore() {
      require.cache[mongodbPath] = originalMongoModuleRecord;
      delete require.cache[scriptPath];
    },
  };
}

function loadScriptWithoutFakeMongo() {
  delete require.cache[scriptPath];
  return require('../../src/scripts/migrateClinicalUnitOrganizations');
}

function fakeDb({ patients, clinicalUnits, organizations }) {
  const patientsToArray = vi.fn().mockResolvedValue(patients);
  const patientsFind = vi.fn().mockReturnValue({ toArray: patientsToArray });
  const patientsUpdateOne = vi.fn().mockResolvedValue({ acknowledged: true });
  const patientsCollection = { find: patientsFind, updateOne: patientsUpdateOne };

  const clinicalUnitsToArray = vi.fn().mockResolvedValue(clinicalUnits || []);
  const clinicalUnitsFind = vi.fn().mockReturnValue({ toArray: clinicalUnitsToArray });
  const clinicalUnitsCollection = { find: clinicalUnitsFind };

  const orgsToArray = vi.fn().mockResolvedValue(organizations || []);
  const orgsFind = vi.fn().mockReturnValue({ toArray: orgsToArray });
  const orgsInsertOne = vi.fn().mockResolvedValue({ acknowledged: true });
  const organizationsCollection = { find: orgsFind, insertOne: orgsInsertOne };

  const collection = vi.fn((name) => {
    if (name === 'patients') return patientsCollection;
    if (name === 'clinical_units') return clinicalUnitsCollection;
    return organizationsCollection;
  });

  return { collection, patientsFind, patientsUpdateOne, clinicalUnitsFind, orgsFind, orgsInsertOne };
}

describe('scripts/migrateClinicalUnitOrganizations', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('throws when neither MONGODB_URI nor MONGO_URI is set', async () => {
    delete process.env.MONGODB_URI;
    delete process.env.MONGO_URI;

    const mod = loadScriptWithoutFakeMongo();

    await expect(mod.migrateClinicalUnitOrganizations()).rejects.toThrow(
      /MONGODB_URI ou MONGO_URI não encontrada/,
    );
  });

  it('does nothing when no patient has clinicalUnitId/clinicalUnit', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';

    const dbApi = fakeDb({ patients: [] });
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection: dbApi.collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      const result = await mod.migrateClinicalUnitOrganizations();
      expect(result).toEqual({ patientsUpdated: 0, organizationsCreated: 0 });
      expect(dbApi.patientsUpdateOne).not.toHaveBeenCalled();
      expect(dbApi.orgsInsertOne).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('resolves a legacy clinicalUnits ObjectId reference to an Organization and rewrites the patient', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';

    const patients = [
      {
        _id: { toString: () => 'patient-1' },
        clinicalUnitId: '507f1f77bcf86cd799439011',
      },
    ];
    const clinicalUnits = [
      { _id: { toString: () => '507f1f77bcf86cd799439011' }, name: 'Hospital Central', acronym: 'HC' },
    ];
    const dbApi = fakeDb({ patients, clinicalUnits, organizations: [] });
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection: dbApi.collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      const result = await mod.migrateClinicalUnitOrganizations();

      expect(result.patientsUpdated).toBe(1);
      expect(result.organizationsCreated).toBe(1);

      const createdOrg = dbApi.orgsInsertOne.mock.calls[0][0];
      expect(createdOrg.officialName).toBe('Hospital Central');

      const update = dbApi.patientsUpdateOne.mock.calls[0];
      expect(update[1].$set.clinicalUnitId).toBe(createdOrg.organizationId);
      expect(update[1].$set.clinicalUnit).toBe('Hospital Central');
      expect(update[1].$set.unitAcronym).toBe('HC');
    } finally {
      restore();
    }
  });

  it('resolves a free-text clinicalUnit name (no clinicalUnitId) to an Organization', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';

    const patients = [
      { _id: { toString: () => 'patient-1' }, clinicalUnit: 'Biobanco Norte' },
    ];
    const dbApi = fakeDb({ patients, clinicalUnits: [], organizations: [] });
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection: dbApi.collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      const result = await mod.migrateClinicalUnitOrganizations();

      expect(result.patientsUpdated).toBe(1);
      expect(result.organizationsCreated).toBe(1);
      const update = dbApi.patientsUpdateOne.mock.calls[0];
      expect(update[1].$set.clinicalUnit).toBe('Biobanco Norte');
      expect(typeof update[1].$set.clinicalUnitId).toBe('string');
    } finally {
      restore();
    }
  });

  it('reuses an existing Organization matched by normalizedName instead of creating a duplicate', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';

    const patients = [
      { _id: { toString: () => 'patient-1' }, clinicalUnit: 'Biobanco Norte' },
    ];
    const existingOrg = { organizationId: 'org-existing-1', officialName: 'Biobanco Norte', normalizedName: 'BIOBANCO NORTE', acronym: 'BN' };
    const dbApi = fakeDb({ patients, clinicalUnits: [], organizations: [existingOrg] });
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection: dbApi.collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      const result = await mod.migrateClinicalUnitOrganizations();

      expect(result.organizationsCreated).toBe(0);
      expect(dbApi.orgsInsertOne).not.toHaveBeenCalled();
      const update = dbApi.patientsUpdateOne.mock.calls[0];
      expect(update[1].$set.clinicalUnitId).toBe('org-existing-1');
    } finally {
      restore();
    }
  });

  it('skips a patient whose clinicalUnitId already resolves to an existing Organization', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';

    const patients = [
      { _id: { toString: () => 'patient-1' }, clinicalUnitId: 'org-already-migrated', clinicalUnit: 'Hospital Central' },
    ];
    const existingOrg = { organizationId: 'org-already-migrated', officialName: 'Hospital Central', normalizedName: 'HOSPITAL CENTRAL' };
    const dbApi = fakeDb({ patients, clinicalUnits: [], organizations: [existingOrg] });
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection: dbApi.collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      const result = await mod.migrateClinicalUnitOrganizations();

      expect(result.patientsUpdated).toBe(0);
      expect(dbApi.patientsUpdateOne).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('propagates a query error and still closes the client', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';

    const queryError = new Error('mongo query failed');
    const patientsToArray = vi.fn().mockRejectedValue(queryError);
    const patientsFind = vi.fn().mockReturnValue({ toArray: patientsToArray });
    const collection = vi.fn().mockReturnValue({ find: patientsFind, updateOne: vi.fn(), insertOne: vi.fn() });
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      await expect(mod.migrateClinicalUnitOrganizations()).rejects.toThrow('mongo query failed');
    } finally {
      restore();
    }
  });
});
