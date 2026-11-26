import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const service = require('../../../src/services/physicalIdentificationProtocol.service');

// #1514 (RF016 AC7, RULE-037): the ex ante protocol's execution gate reads
// the stored record. A query-matching fake db, `$or` included.
function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => (key === '$or' ? value.some((branch) => matches(doc, branch)) : doc[key] === value));
}
function createFakeDb() {
  const collections = {};
  return {
    collections,
    collection(name) {
      if (!collections[name]) {
        const docs = [];
        collections[name] = {
          docs,
          async findOne(filter) { return docs.find((doc) => matches(doc, filter)) || null; },
          async insertOne(doc) { docs.push(structuredClone(doc)); },
        };
      }
      return collections[name];
    },
  };
}

const base = {
  protocolVersion: '1.0.0',
  scope: 'ex_ante_synthetic',
  evidenceUri: 'object://evidence/BioAvanceD_Protocolo_Avaliacao_Ex_Ante_Identificacao_Fisica_v1.0.0.docx',
  evidenceHash: '6ce782d763976a8ec4a106e6a212d13b2e838a0bd5b19db146418472a7c787f1',
  approvedSymbologies: ['data_matrix'],
  fixtureCatalogRefs: ['catalog:vial:synthetic-001'],
  realSpecimenUse: false,
};
const approved = { approvalStatus: 'approved_for_execution', approvedAt: '2026-09-12T20:00:00.000Z' };

describe('physicalIdentificationProtocol.service (#1514, RF016 AC7, RULE-037)', () => {
  let db;
  beforeEach(() => { db = createFakeDb(); });

  const register = (over) => service.registerProtocol(db, { ...base, ...over });
  const authorize = (protocol) => service.authorizeExecution(db, protocol.physicalIdentificationValidationProtocolId);

  it('refuses to run a draft protocol', async () => {
    const draft = await register({ protocolVersion: '1.0.0-draft' });
    await expect(authorize(draft)).rejects.toMatchObject({ statusCode: 409, code: 'PROTOCOL_NOT_EXECUTABLE', message: expect.stringMatching(/RULE-037/) });
  });

  it('refuses to run a retired protocol', async () => {
    const retired = await register({ protocolVersion: '0.9.0', approvalStatus: 'retired' });
    await expect(authorize(retired)).rejects.toMatchObject({ statusCode: 409, code: 'PROTOCOL_NOT_EXECUTABLE', message: expect.stringMatching(/RULE-037/) });
  });

  it('refuses to run an approved ex ante protocol that uses a real specimen', async () => {
    const real = await register({ protocolVersion: '1.1.0', ...approved, realSpecimenUse: true });
    await expect(authorize(real)).rejects.toMatchObject({ statusCode: 409, code: 'PROTOCOL_NOT_EXECUTABLE', message: expect.stringMatching(/RULE-037/) });
  });

  it('authorizes a run of an approved synthetic protocol and records no result', async () => {
    const protocol = await register(approved);
    const execution = await authorize(protocol);
    expect(execution).toMatchObject({
      physicalIdentificationValidationProtocolId: protocol.physicalIdentificationValidationProtocolId,
      protocolVersion: '1.0.0',
      scope: 'ex_ante_synthetic',
      approvalStatus: 'approved_for_execution',
      realSpecimenUse: false,
    });
    expect(execution.authorizedAt).toBeInstanceOf(Date);
    expect(db.collections.physicalIdentificationValidationProtocols.docs).toHaveLength(1);
  });

  it('answers 404 for an unknown protocol', async () => {
    await expect(service.authorizeExecution(db, 'no-such-protocol')).rejects.toMatchObject({ statusCode: 404, code: 'PROTOCOL_NOT_FOUND' });
  });

  it('refuses a second protocol with the same version', async () => {
    await register({});
    await expect(register({})).rejects.toMatchObject({ statusCode: 409, code: 'PROTOCOL_EXISTS' });
    expect(db.collections.physicalIdentificationValidationProtocols.docs).toHaveLength(1);
  });

  it('refuses an approved protocol without approvedAt as a validation error', async () => {
    await expect(register({ protocolVersion: '2.0.0', approvalStatus: 'approved_for_execution' })).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
  });

  it('refuses an approved protocol whose approvedAt does not parse, and stores nothing', async () => {
    await expect(register({ protocolVersion: '2.1.0', approvalStatus: 'approved_for_execution', approvedAt: 'not-a-date' })).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
    expect(db.collections.physicalIdentificationValidationProtocols?.docs ?? []).toHaveLength(0);
  });

  it('refuses a numeric protocol id, and stores nothing', async () => {
    await expect(register({ physicalIdentificationValidationProtocolId: 42 })).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
    expect(db.collections.physicalIdentificationValidationProtocols?.docs ?? []).toHaveLength(0);
  });

  it('refuses an object protocol id, and stores nothing', async () => {
    await expect(register({ physicalIdentificationValidationProtocolId: { $ne: null } })).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
    expect(db.collections.physicalIdentificationValidationProtocols?.docs ?? []).toHaveLength(0);
  });
});
