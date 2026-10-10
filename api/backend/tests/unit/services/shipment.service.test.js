import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const shipmentService = require('../../../src/services/shipment.service');
const ShipmentModel = require('../../../src/models/Shipment');

// #660 (RF024 AC5): a Shipment carries out an executed transfer or a
// released distribution, for specimens that authorization names.

function createFakeCollection(seedDocs = []) {
  const docs = [...seedDocs];
  const matches = (doc, filter) => Object.keys(filter).every((key) => String(doc[key]) === String(filter[key]));
  return {
    docs,
    async createIndex() { return 'ok'; },
    async insertOne(doc) { docs.push(doc); return { insertedId: docs.length }; },
    async findOne(filter = {}) { return docs.find((doc) => matches(doc, filter)) || null; },
    async updateOne(filter, update) {
      const doc = docs.find((d) => matches(d, filter));
      if (!doc) return { matchedCount: 0 };
      Object.assign(doc, update.$set);
      return { matchedCount: 1 };
    },
    find() { return { sort() { return this; }, async toArray() { return docs; } }; },
  };
}

function createFakeDb(overrides = {}) {
  const world = {
    organizations: [{ organizationId: 'ORG-A' }, { organizationId: 'ORG-B' }],
    samples: [{ _id: '650000000000000000000001', specimenId: 'SP-1' }, { _id: '650000000000000000000002', specimenId: 'SP-2' }],
    dispositionActions: [{ dispositionActionId: 'DA-1', dispositionAction: 'transfer', entityType: 'Specimen', actionStatus: 'executed', affectedRecordIds: ['SP-1'] }],
    accessRequests: [{ accessRequestId: 'AR-1', distributionStatus: 'released', requestedItems: [{ itemType: 'specimen', itemId: 'SP-2' }] }],
    shipments: [],
    ...overrides,
  };
  const collections = Object.fromEntries(Object.entries(world).map(([name, docs]) => [name, createFakeCollection(docs)]));
  return {
    collection(name) {
      if (!collections[name]) throw new Error(`unexpected collection: ${name}`);
      return collections[name];
    },
  };
}

const payload = (overrides = {}) => ({
  specimenIds: ['SP-1'],
  senderOrganization: 'ORG-A',
  recipientOrganization: 'ORG-B',
  mtaId: 'MTA-2026-001',
  packagingType: 'UN3373',
  dispatchDateTime: '2026-10-10T10:00:00Z',
  dispositionActionId: 'DA-1',
  ...overrides,
});
const scopeA = { scope: 'organization', organizationIds: ['ORG-A'] };
const scopeB = { scope: 'organization', organizationIds: ['ORG-B'] };

describe('ShipmentModel (#660, ELM-0396..0407)', () => {
  it('emits the twelve canonical fields', () => {
    expect(Object.keys(ShipmentModel.fieldsOf())).toEqual([
      'shipmentId', 'specimenIds', 'senderOrganization', 'recipientOrganization', 'mtaId', 'carrier',
      'trackingNumber', 'packagingType', 'temperatureLoggerId', 'dispatchDateTime', 'receiptDateTime', 'conditionOnReceipt',
    ]);
  });

  it('requires the 1..1 fields, a recipient other than the sender, and exactly one authorization', () => {
    const errors = ShipmentModel.validate({ specimenIds: [], senderOrganization: 'ORG-A', recipientOrganization: 'ORG-A' }).errors.join(' | ');
    for (const expected of ['specimenIds', 'mtaId', 'packagingType', 'dispatchDateTime', 'outra organização', 'exatamente uma autorização']) {
      expect(errors).toContain(expected);
    }
    expect(ShipmentModel.validate(payload({ accessRequestId: 'AR-1' })).errors.join()).toContain('exatamente uma autorização');
    expect(ShipmentModel.validate(payload()).isValid).toBe(true);
  });
});

describe('shipment.service (#660, RF024 AC5)', () => {
  it('dispatches the specimens an executed transfer names, stored by canonical id', async () => {
    const db = createFakeDb();
    const shipment = await shipmentService.createShipment(db, payload({ specimenIds: ['650000000000000000000001'] }), { actorId: 'u-1', organizationScope: scopeA });
    expect(shipment).toMatchObject({ specimenIds: ['SP-1'], shipmentStatus: 'dispatched', dispositionActionId: 'DA-1', createdBy: 'u-1', packagingType: { code: 'UN3373' } });
    expect(db.collection('shipments').docs).toHaveLength(1);
  });

  it('dispatches the specimens a released access request names', async () => {
    const db = createFakeDb();
    const shipment = await shipmentService.createShipment(db, payload({ specimenIds: ['SP-2'], dispositionActionId: undefined, accessRequestId: 'AR-1' }));
    expect(shipment.accessRequestId).toBe('AR-1');
  });

  it('refuses a specimen the authorization does not name', async () => {
    const db = createFakeDb();
    await expect(shipmentService.createShipment(db, payload({ specimenIds: ['SP-1', 'SP-2'] }))).rejects.toMatchObject({ statusCode: 422, code: 'SPECIMEN_NOT_AUTHORIZED' });
  });

  it('refuses a transfer not yet executed, a disposition that is no transfer, and a distribution not released', async () => {
    const planned = createFakeDb({ dispositionActions: [{ dispositionActionId: 'DA-1', dispositionAction: 'transfer', entityType: 'Specimen', actionStatus: 'approved', affectedRecordIds: ['SP-1'] }] });
    await expect(shipmentService.createShipment(planned, payload())).rejects.toMatchObject({ statusCode: 409, code: 'AUTHORIZATION_NOT_EXECUTED' });
    const destroy = createFakeDb({ dispositionActions: [{ dispositionActionId: 'DA-1', dispositionAction: 'destroy', entityType: 'Specimen', actionStatus: 'executed', affectedRecordIds: ['SP-1'] }] });
    await expect(shipmentService.createShipment(destroy, payload())).rejects.toMatchObject({ statusCode: 422, code: 'AUTHORIZATION_NOT_TRANSFER' });
    const pending = createFakeDb({ accessRequests: [{ accessRequestId: 'AR-1', distributionStatus: 'pending', requestedItems: [{ itemId: 'SP-2' }] }] });
    await expect(shipmentService.createShipment(pending, payload({ specimenIds: ['SP-2'], dispositionActionId: undefined, accessRequestId: 'AR-1' }))).rejects.toMatchObject({ statusCode: 409, code: 'AUTHORIZATION_NOT_RELEASED' });
  });

  it('refuses a sender outside the caller\'s scope and an organization that does not exist', async () => {
    await expect(shipmentService.createShipment(createFakeDb(), payload(), { organizationScope: scopeB })).rejects.toMatchObject({ statusCode: 403 });
    await expect(shipmentService.createShipment(createFakeDb(), payload({ recipientOrganization: 'ORG-X' }))).rejects.toMatchObject({ statusCode: 422, code: 'ORGANIZATION_NOT_FOUND' });
  });

  it('records the receipt once, by the recipient\'s scope, not before the dispatch', async () => {
    const db = createFakeDb();
    const { shipmentId } = await shipmentService.createShipment(db, payload());
    await expect(shipmentService.receiveShipment(db, shipmentId, { receiptDateTime: '2026-10-11T09:00:00Z' }, { organizationScope: scopeA })).rejects.toMatchObject({ statusCode: 403 });
    await expect(shipmentService.receiveShipment(db, shipmentId, { receiptDateTime: '2026-10-09T09:00:00Z' }, { organizationScope: scopeB })).rejects.toMatchObject({ statusCode: 422 });
    const received = await shipmentService.receiveShipment(db, shipmentId, {
      receiptDateTime: '2026-10-11T09:00:00Z',
      conditionOnReceipt: { integrity: 'intact', temperature: '-78 C' },
    }, { actorId: 'u-2', organizationScope: scopeB });
    expect(received).toMatchObject({
      shipmentStatus: 'received', receivedBy: 'u-2',
      conditionOnReceipt: { integrity: 'intact', temperature: '-78 C', packaging: null, discrepancies: null },
    });
    await expect(shipmentService.receiveShipment(db, shipmentId, { receiptDateTime: '2026-10-12T09:00:00Z' }, { organizationScope: scopeB })).rejects.toMatchObject({ statusCode: 409, code: 'ALREADY_RECEIVED' });
  });

  it('shows a shipment to its sender\'s and recipient\'s organizations only', async () => {
    const db = createFakeDb();
    const { shipmentId } = await shipmentService.createShipment(db, payload());
    expect((await shipmentService.getShipment(db, shipmentId, scopeB)).shipmentId).toBe(shipmentId);
    await expect(shipmentService.getShipment(db, shipmentId, { scope: 'organization', organizationIds: ['ORG-C'] })).rejects.toMatchObject({ statusCode: 403 });
  });
});
