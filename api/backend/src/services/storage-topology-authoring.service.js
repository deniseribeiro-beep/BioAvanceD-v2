const { ObjectId } = require('mongodb');
const { ensureStorageConfigurationIndexes } = require('../utils/storageIndexes');

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

class StorageTopologyAuthoringService {
  /**
   * StorageBox/StorageContainer are governed layout/configuration inputs.
   * They are deliberately NOT the operational custody authority. Runtime
   * specimen placement remains exclusively in the normalized v2 chain:
   * SpecimenContainerAssignment -> ContainerPositionAssignment ->
   * StoragePosition -> StorageRack -> RackLocationAssignment.
   */
  constructor(db) {
    this.db = db;
  }

  async ensureLayoutIndexes() {
    await ensureStorageConfigurationIndexes(this.db);
  }

  async createContainer(input = {}, actorId = null) {
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
    }

    let containerID;
    if (containerType === 'FREEZER') {
      const equipmentIdentifier = requiredText(input.equipmentId ?? input.containerID, 'equipmentId');
      const equipment = await this.db.collection('equipment').findOne({
        equipmentID: { $in: buildIdVariants(equipmentIdentifier) },
        deletedAt: null,
      });
      if (!equipment) throw topologyError('EQUIPMENT_NOT_FOUND', `Equipment ${equipmentIdentifier} não encontrado`, 404);
      containerID = String(equipment.equipmentID ?? equipmentIdentifier);

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

  async createBox(input = {}, actorId = null) {
    await this.ensureLayoutIndexes();

    const name = requiredText(input.name, 'name');
    const parentId = optionalObjectId(input.parentId ?? input.parent_id, 'parentId');
    if (!parentId) throw topologyError('INVALID_HIERARCHY', 'parentId é obrigatório');

    const parent = await this.db.collection('storageContainers').findOne({ _id: parentId, deletedAt: null });
    if (!parent) throw topologyError('PARENT_NOT_FOUND', 'Container pai não encontrado', 404);
    if (!['RACK', 'DRAWER'].includes(parent.containerType)) {
      throw topologyError('INVALID_HIERARCHY', 'StorageBox exige parent do tipo RACK ou DRAWER');
    }

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
