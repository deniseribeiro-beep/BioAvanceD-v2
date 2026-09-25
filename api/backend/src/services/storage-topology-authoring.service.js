const { ObjectId } = require('mongodb');
const { ensureStorageContainerIndexes, ensureStorageBoxIndexes } = require('../utils/storageIndexes');
const { isRecordInOrganizationScope } = require('./rbac-assignment.service');

const CONTAINER_PARENT_TYPES = Object.freeze({
  SHELF: 'FREEZER',
  RACK: 'SHELF',
  DRAWER: 'RACK',
});

const CONTAINER_TYPES = new Set(['FREEZER', 'SHELF', 'RACK', 'DRAWER']);
const CONTAINER_STATUSES = new Set(['OPERATIONAL', 'MAINTENANCE', 'RETIRED']);
const BOX_STATUSES = new Set(['ACTIVE', 'FULL', 'RETIRED']);
const TEMPERATURE_UNITS = new Set(['CELSIUS', 'FAHRENHEIT']);

function topologyError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function requiredText(value, field) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw topologyError('INVALID_INPUT', `${field} é obrigatório`);
  return normalized;
}

function optionalObjectId(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (!ObjectId.isValid(value)) throw topologyError('INVALID_INPUT', `${field} inválido`);
  return new ObjectId(value);
}

function buildIdVariants(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  const variants = [raw];
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) variants.push(numeric);
  return [...new Set(variants)];
}

/**
 * #1124: before this, no request on a running stack could create a
 * StorageContainer or a StorageBox -- location-storage-backfill.service.js
 * held the only insertOne calls, and it only materialises legacy
 * `locations`. Ported from Denise's stabilize/v2.0.0-prototype (12b2f889,
 * 23e17a1c), where the docblock also names her normalized v2 custody chain;
 * that chain is not on this branch, so it is not claimed here.
 *
 * This authors the container tree only (FREEZER -> SHELF -> RACK [-> DRAWER]
 * -> StorageBox). It never places a specimen: allocation stays on
 * POST /api/storage/allocate under manageStorageAllocation.
 *
 * A FREEZER's containerID is the Equipment's own equipmentID value: that is
 * the join sample.service, import-lgpd and the RF004 quarantine read
 * (`freezer.containerID === Equipment.equipmentID`, #757).
 */
class StorageTopologyAuthoringService {
  constructor(db) {
    this.db = db;
  }

  async ensureLayoutIndexes() {
    // The containerID unique index is what turns a second FREEZER for the
    // same Equipment into the E11000 createContainer maps to 409.
    await ensureStorageContainerIndexes(this.db.collection('storageContainers'));
    await ensureStorageBoxIndexes(this.db.collection('storageBoxes'));
  }

  /**
   * #1210: Equipment is organization-scoped (#635, #1071); the container
   * tree has no organizationId of its own, so its scope is its root
   * freezer's Equipment's. Same rule as equipment.routes.js: a null
   * organizationId is outside every scope but a global one.
   *
   * Fails CLOSED on a missing scope: the #1081 shape was a guard written as
   * `scope && !inScope(...)`, which silently passes everything when the
   * middleware is absent.
   */
  assertEquipmentInScope(equipment, organizationScope) {
    if (!organizationScope || !isRecordInOrganizationScope(equipment || {}, organizationScope, 'organizationId')) {
      throw topologyError('EQUIPMENT_OUT_OF_SCOPE', 'O equipamento desta topologia pertence a outra organização', 403);
    }
  }

  async assertTreeInScope(node, organizationScope) {
    if (organizationScope?.scope === 'global') return;
    const storageContainers = this.db.collection('storageContainers');
    let current = node;
    // FREEZER -> SHELF -> RACK -> DRAWER is at most three hops from a DRAWER.
    for (let hops = 0; current && current.containerType !== 'FREEZER' && hops < 4; hops += 1) {
      current = current.parent_id
        ? await storageContainers.findOne({ _id: current.parent_id, deletedAt: null })
        : null;
    }
    const containerID = current?.containerType === 'FREEZER' ? current.containerID : null;
    const equipment = containerID === null || containerID === undefined
      ? null
      : await this.db.collection('equipment').findOne({ equipmentID: { $in: buildIdVariants(containerID) }, deletedAt: null });
    this.assertEquipmentInScope(equipment, organizationScope);
  }

  async createContainer(input = {}, actorId = null, organizationScope = null) {
    await this.ensureLayoutIndexes();

    const name = requiredText(input.name, 'name');
    const containerType = requiredText(input.containerType, 'containerType').toUpperCase();
    if (!CONTAINER_TYPES.has(containerType)) {
      throw topologyError('INVALID_CONTAINER_TYPE', `containerType inválido: ${containerType}`);
    }

    const status = String(input.status || 'OPERATIONAL').toUpperCase();
    if (!CONTAINER_STATUSES.has(status)) {
      throw topologyError('INVALID_STATUS', `status inválido: ${status}`);
    }

    const parentId = optionalObjectId(input.parentId ?? input.parent_id, 'parentId');
    const roomId = optionalObjectId(input.roomId, 'roomId');
    const storageContainers = this.db.collection('storageContainers');

    if (containerType === 'FREEZER') {
      if (parentId) throw topologyError('INVALID_HIERARCHY', 'FREEZER não pode ter parentId');
    } else {
      if (!parentId) throw topologyError('INVALID_HIERARCHY', `${containerType} exige parentId`);
      const parent = await storageContainers.findOne({ _id: parentId, deletedAt: null });
      if (!parent) throw topologyError('PARENT_NOT_FOUND', 'Container pai não encontrado', 404);
      const expectedParentType = CONTAINER_PARENT_TYPES[containerType];
      if (parent.containerType !== expectedParentType) {
        throw topologyError('INVALID_HIERARCHY', `${containerType} exige parent do tipo ${expectedParentType}, recebido ${parent.containerType}`);
      }
      if (roomId) throw topologyError('INVALID_ROOM_SCOPE', 'roomId só é aplicável a FREEZER');
      if (input.temperature !== undefined && input.temperature !== null) {
        throw topologyError('INVALID_TEMPERATURE_SCOPE', 'temperature só é aplicável a FREEZER');
      }
      await this.assertTreeInScope(parent, organizationScope);
    }

    let containerID;
    if (containerType === 'FREEZER') {
      const equipmentIdentifier = requiredText(input.equipmentId ?? input.containerID, 'equipmentId');
      const equipment = await this.db.collection('equipment').findOne({
        equipmentID: { $in: buildIdVariants(equipmentIdentifier) },
        deletedAt: null,
      });
      if (!equipment) throw topologyError('EQUIPMENT_NOT_FOUND', `Equipment ${equipmentIdentifier} não encontrado`, 404);
      this.assertEquipmentInScope(equipment, organizationScope);
      // Deliberately NOT String(): Denise's branch stringifies here, but on
      // this branch StorageContainer.containerID is a Number and #757 settled
      // that it and Equipment.equipmentID are the same plain number. Keep
      // the Equipment's own value so the two stay one type.
      containerID = equipment.equipmentID;

      // The containerID unique index (#1209) rejects a same-type duplicate,
      // but 4201 and '4201' are different keys to it, while every consumer
      // joins on both variants. Check across the variants so neither type
      // can double-claim one Equipment; the E11000 mapping below covers a
      // same-type race.
      const existingFreezer = await storageContainers.findOne({
        containerID: { $in: buildIdVariants(containerID) },
        deletedAt: null,
      });
      if (existingFreezer) {
        throw topologyError('STORAGE_CONTAINER_CONFLICT', 'containerID já está associado a outro FREEZER', 409);
      }

      if (roomId) {
        const room = await this.db.collection('rooms').findOne({ _id: roomId, deletedAt: null });
        if (!room) throw topologyError('ROOM_NOT_FOUND', 'Room não encontrada', 404);
      }
    }

    const temperatureUnit = String(input.temperatureUnit || 'CELSIUS').toUpperCase();
    if (!TEMPERATURE_UNITS.has(temperatureUnit)) {
      throw topologyError('INVALID_TEMPERATURE_UNIT', `temperatureUnit inválida: ${temperatureUnit}`);
    }

    const now = new Date();
    const doc = {
      name,
      description: input.description ? String(input.description).trim() : null,
      containerType,
      parent_id: parentId,
      roomId: containerType === 'FREEZER' ? roomId : null,
      temperature: containerType === 'FREEZER' && input.temperature !== undefined ? Number(input.temperature) : null,
      temperatureUnit,
      capacity: input.capacity === undefined || input.capacity === null ? null : Number(input.capacity),
      status,
      createdBy: actorId || null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      ...(containerType === 'FREEZER' ? { containerID } : {}),
    };

    if (doc.temperature !== null && !Number.isFinite(doc.temperature)) {
      throw topologyError('INVALID_TEMPERATURE', 'temperature deve ser numérica');
    }
    if (doc.capacity !== null && (!Number.isFinite(doc.capacity) || doc.capacity < 0)) {
      throw topologyError('INVALID_CAPACITY', 'capacity deve ser número maior ou igual a zero');
    }

    try {
      const result = await storageContainers.insertOne(doc);
      return { _id: result.insertedId, ...doc };
    } catch (error) {
      if (error?.code === 11000) {
        throw topologyError('STORAGE_CONTAINER_CONFLICT', 'containerID já está associado a outro FREEZER', 409);
      }
      throw error;
    }
  }

  async createBox(input = {}, actorId = null, organizationScope = null) {
    await this.ensureLayoutIndexes();

    const name = requiredText(input.name, 'name');
    const parentId = optionalObjectId(input.parentId ?? input.parent_id, 'parentId');
    if (!parentId) throw topologyError('INVALID_HIERARCHY', 'parentId é obrigatório');

    const parent = await this.db.collection('storageContainers').findOne({ _id: parentId, deletedAt: null });
    if (!parent) throw topologyError('PARENT_NOT_FOUND', 'Container pai não encontrado', 404);
    if (!['RACK', 'DRAWER'].includes(parent.containerType)) {
      throw topologyError('INVALID_HIERARCHY', 'StorageBox exige parent do tipo RACK ou DRAWER');
    }
    await this.assertTreeInScope(parent, organizationScope);

    const rows = Number(input.dimension?.rows);
    const cols = Number(input.dimension?.cols);
    if (!Number.isInteger(rows) || rows < 1 || rows > 26) {
      throw topologyError('INVALID_DIMENSION', 'dimension.rows deve ser inteiro entre 1 e 26');
    }
    if (!Number.isInteger(cols) || cols < 1 || cols > 100) {
      throw topologyError('INVALID_DIMENSION', 'dimension.cols deve ser inteiro entre 1 e 100');
    }

    const status = String(input.status || 'ACTIVE').toUpperCase();
    if (!BOX_STATUSES.has(status)) throw topologyError('INVALID_STATUS', `status inválido: ${status}`);

    const now = new Date();
    const doc = {
      ...(input.boxID === undefined || input.boxID === null || input.boxID === '' ? {} : { boxID: input.boxID }),
      name,
      description: input.description ? String(input.description).trim() : null,
      parent_id: parentId,
      dimension: { rows, cols },
      occupancyGrid: {},
      capacity: rows * cols,
      currentOccupancy: 0,
      status,
      createdBy: actorId || null,
      createdAt: now,
      updatedAt: now,
      lastModified: now,
    };

    const result = await this.db.collection('storageBoxes').insertOne(doc);
    return { _id: result.insertedId, ...doc };
  }
}

module.exports = {
  StorageTopologyAuthoringService,
  topologyError,
};
