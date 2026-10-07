const { ObjectId } = require('mongodb');
const { getCollection } = require('../../../utils/collectionResolver');
// #923: shared with fhir-import-staging.service.js rather than copied. #918
// added this probe there; writing a second one here is how the insufficient
// startSession() guard came to exist in two places already.
const { isKnownStandaloneDeployment } = require('../../../utils/mongoTransaction');
const StorageAssignmentModel = require('../../../models/StorageAssignment');
const positionGrid = require('../../../utils/storagePositionGrid');
const { escapeRegex } = require('../../../utils/escapeRegex');

/**
 * Repositório Mongo para operações de armazenamento físico de amostras.
 */
class MongoStorageRepository {
  /**
   * @param {import('mongodb').Db} db
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * @param {(session: import('mongodb').ClientSession) => Promise<any>} handler
   * @returns {Promise<any>}
   */
  async withTransaction(handler) {
    const client = this.db?.client || this.db?.s?.client;
    if (!client || typeof client.startSession !== 'function') {
      throw new Error('Cliente Mongo não suporta transação');
    }

    // #923: the guard above only ever detected a MOCK. A real MongoClient
    // always exposes startSession(), on a standalone mongod as much as on a
    // replica set -- so control reached session.withTransaction() and Mongo
    // answered `MongoServerError` code 20, "Transaction numbers are only
    // allowed on a replica set member or mongos". Nothing in that message
    // says which deployment is wrong or why, and only compose.test.yml runs
    // mongo with --replSet: compose.yml, compose.dev.yml and compose.prod.yml
    // declare no `command:` at all. So POST /storage/allocate, /move and
    // DELETE /release have been failing unattributably on three of four
    // stacks.
    //
    // This makes the failure legible. It does NOT make the endpoints work
    // there -- whether a non-replica-set deployment should degrade to
    // sequential writes (the shape sensor.service.js:237-268 and #918 use) or
    // whether dev/prod mongo should become replica sets (the shape
    // compose.test.yml already proves) is a live question on #923, and the
    // two answers differ for chain-of-custody auditing: a degraded move
    // writes the specimen's new position with no guarantee the immutable
    // audit row landed with it.
    if (await isKnownStandaloneDeployment(this.db)) {
      throw new Error(
        'Transação Mongo indisponível: esta implantação não é um replica set nem mongos. ' +
        'Alocação, movimentação e liberação de amostras exigem transação (RF006 item 7, F3-G10). ' +
        'Configure o mongod com --replSet (ver compose.test.yml) ou aponte MONGO_URI para um replica set.'
      );
    }

    const session = client.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        result = await handler(session);
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  /**
   * dict-02 StorageAssignment (ELM-0167-0178, #507): the return shape hands
   * callers the canonical custody entity via `storageAssignment` instead of
   * leaving them to read the raw `storageLocation.boxId/position` snapshot
   * embedded on the Mongo document — that embedding stays as an internal
   * persistence-layer detail, not part of the contract this method exposes.
   * @param {string} specimenId
   * @param {import('mongodb').ClientSession} [session]
   */
  async findSampleById(specimenId, session) {
    const samplesCollection = await getCollection(this.db, 'samples');
    const normalizedId = this.toObjectId(specimenId);
    const sample = await samplesCollection.findOne({ _id: normalizedId }, { session });
    if (!sample) return null;

    const storageAssignment = await this.findCurrentStorageAssignment(specimenId, session);
    return { ...sample, storageAssignment };
  }

  /**
   * dict-02 StorageAssignment (ELM-0167-0178, #507): resolve the open
   * (not yet `removedAt`) placement-history record for a specimen, i.e. its
   * current physical position, per the `StorageLocation`+`StorageAssignment`
   * canonical entity pair (`docs/architecture/canonical-data-contract-v1.md`
   * section 7.4).
   * @param {string} specimenId
   * @param {import('mongodb').ClientSession} [session]
   */
  async findCurrentStorageAssignment(specimenId, session) {
    const storageAssignmentsCollection = this.db.collection('storageAssignments');
    return storageAssignmentsCollection.findOne(
      { specimenId: String(specimenId), removedAt: null },
      { session }
    );
  }

  /**
   * #654: storagePaths is never written anywhere in api/backend/src (the
   * only writer, StoragePath.createFromBox, has zero callers outside its
   * own tests) — so relying on it alone silently drops ancestor data for
   * every real box. Walks storageContainers.parent_id up from a box's own
   * immediate parent until reaching a container with no parent (the
   * FREEZER), tagging each ancestor by its own containerType. This also
   * walks transparently through an optional DRAWER level (#458) between
   * RACK and BOX, which StoragePath's schema has no field for at all.
   * @param {ObjectId|null} [startParentId] - the box's own parent_id
   * @param {import('mongodb').ClientSession} [session]
   * @returns {Promise<Array<object>>} ancestor containers, nearest first
   */
  async resolveAncestorContainersLive(startParentId, session) {
    const containers = [];
    let currentId = startParentId || null;
    if (!currentId) return containers;

    // Deferred until there's actually a parent to look up, not hoisted
    // unconditionally to the top of the method — a box with no parent_id
    // (or callers that never reach this fallback at all) should never
    // touch storageContainers.
    const storageContainersCollection = this.db.collection('storageContainers');
    while (currentId) {
      const container = await storageContainersCollection.findOne({ _id: currentId }, { session });
      if (!container) break;
      containers.push(container);
      currentId = container.parent_id || null;
    }

    return containers;
  }

  /**
   * dict-02 StorageAssignment (ELM-0167-0178): resolve the rack/shelf/
   * equipment chain for a box via its StoragePath when one exists, falling
   * back to a live parent_id walk (#654) when it doesn't — which is every
   * real box today, since nothing writes storagePaths.
   *
   * facilityId/roomId (ELM-0168/0169, #418) resolve by walking up from the
   * freezer's StorageContainer.roomId to Room.facilityId — best-effort,
   * since a FREEZER isn't required to have a Room assigned.
   * @param {ObjectId} boxObjId
   * @param {import('mongodb').ClientSession} [session]
   */
  async findStorageHierarchyForBox(boxObjId, session) {
    const storagePathsCollection = this.db.collection('storagePaths');
    const path = await storagePathsCollection.findOne({ boxId: boxObjId }, { session });

    let rackId = path?.rackId ? String(path.rackId) : null;
    let shelfId = path?.shelfId ? String(path.shelfId) : null;
    let freezerId = path?.freezerId || null;

    if (!path) {
      const box = await this.db.collection('storageBoxes').findOne({ _id: boxObjId }, { session });
      const ancestors = await this.resolveAncestorContainersLive(box?.parent_id, session);
      for (const container of ancestors) {
        if (container.containerType === 'RACK') rackId = String(container._id);
        else if (container.containerType === 'SHELF') shelfId = String(container._id);
        else if (container.containerType === 'FREEZER') freezerId = container._id;
      }
    }

    const { roomId, facilityId } = await this.findFacilityAndRoomForFreezer(freezerId, session);

    return {
      rackId,
      shelfId,
      equipmentId: freezerId ? String(freezerId) : null,
      roomId,
      facilityId
    };
  }

  /**
   * dict-02 StorageAssignment.facilityId/roomId (ELM-0168/0169, #418):
   * resolve a FREEZER StorageContainer's Room, then that Room's Facility.
   * @param {ObjectId} [freezerId]
   * @param {import('mongodb').ClientSession} [session]
   */
  async findFacilityAndRoomForFreezer(freezerId, session) {
    if (!freezerId) {
      return { roomId: null, facilityId: null };
    }

    const storageContainersCollection = this.db.collection('storageContainers');
    const freezer = await storageContainersCollection.findOne({ _id: freezerId }, { session });
    if (!freezer || !freezer.roomId) {
      return { roomId: null, facilityId: null };
    }

    const roomsCollection = this.db.collection('rooms');
    const room = await roomsCollection.findOne({ _id: freezer.roomId }, { session });
    if (!room) {
      return { roomId: String(freezer.roomId), facilityId: null };
    }

    return {
      roomId: String(freezer.roomId),
      facilityId: room.facilityId ? String(room.facilityId) : null
    };
  }

  /**
   * #657: same live parent_id-walk fallback #654 introduced for
   * findStorageHierarchyForBox, reused by getSampleStorageLocation/
   * resolveStorageLocationsForSamples so they build the same path string
   * and typed fullHierarchy shape StoragePath.createFromBox would have
   * produced, instead of falling through to 'N/A'/null for every real box.
   * @param {ObjectId} boxObjId
   * @param {import('mongodb').ClientSession} [session]
   * @returns {Promise<{path: string, fullHierarchy: object}|null>}
   */
  async resolveLiveStoragePath(boxObjId, session) {
    const storageBoxesCollection = this.db.collection('storageBoxes');
    const box = await storageBoxesCollection.findOne({ _id: boxObjId }, { session });
    if (!box) return null;

    const ancestors = await this.resolveAncestorContainersLive(box.parent_id, session);
    let rack = null;
    let shelf = null;
    let freezer = null;
    for (const container of ancestors) {
      if (container.containerType === 'RACK') rack = container;
      else if (container.containerType === 'SHELF') shelf = container;
      else if (container.containerType === 'FREEZER') freezer = container;
    }

    if (!rack || !shelf || !freezer) return null;

    return {
      path: `${freezer.name}/${shelf.name}/${rack.name}/${box.name}`,
      fullHierarchy: {
        freezerId: freezer._id,
        shelfId: shelf._id,
        rackId: rack._id,
        boxId: box._id
      }
    };
  }

  /**
   * dict-02 StorageAssignment (ELM-0167-0178, P1X-0072/0073): open a new
   * placement-history record for a specimen's physical stay at a position.
   * @param {{ specimenId: string, boxId: ObjectId, positionCode: string }} input
   * @param {import('mongodb').ClientSession} [session]
   */
  async openStorageAssignment(input, session) {
    const storageAssignmentsCollection = this.db.collection('storageAssignments');
    const hierarchy = await this.findStorageHierarchyForBox(input.boxId, session);

    const record = StorageAssignmentModel.open({
      specimenId: input.specimenId,
      boxId: input.boxId,
      positionCode: input.positionCode,
      ...hierarchy
    });

    await storageAssignmentsCollection.insertOne(record, { session });
    return record;
  }

  /**
   * dict-02 StorageAssignment: close the open placement-history record for
   * a specimen's stay at a position (removedAt/occupancyStatus), rather
   * than overwriting/discarding it.
   * @param {{ specimenId: string, boxId: ObjectId, positionCode: string }} input
   * @param {import('mongodb').ClientSession} [session]
   */
  async closeStorageAssignment(input, session) {
    const storageAssignmentsCollection = this.db.collection('storageAssignments');
    await storageAssignmentsCollection.updateOne(
      {
        specimenId: String(input.specimenId),
        boxId: String(input.boxId),
        positionCode: input.positionCode,
        removedAt: null
      },
      { $set: StorageAssignmentModel.closeFields() },
      { session }
    );
  }

  /**
   * @param {string} boxId
   * @param {import('mongodb').ClientSession} [session]
   */
  async findBoxById(boxId, session) {
    const storageBoxesCollection = this.db.collection('storageBoxes');
    const normalizedId = this.toObjectId(boxId);
    return storageBoxesCollection.findOne({ _id: normalizedId }, { session });
  }

  /**
   * @param {{ specimenId: string, fromBoxId: string, fromPosition: string, toBoxId: string, toPosition: string }} input
   * @param {import('mongodb').ClientSession} session
   */
  async moveSamplePosition(input, session) {
    const samplesCollection = await getCollection(this.db, 'samples');
    const storageBoxesCollection = this.db.collection('storageBoxes');

    const sampleObjId = this.toObjectId(input.specimenId);
    const fromBoxObjId = this.toObjectId(input.fromBoxId);
    const toBoxObjId = this.toObjectId(input.toBoxId);

    const sourceUpdate = await storageBoxesCollection.updateOne(
      {
        _id: fromBoxObjId,
        [`occupancyGrid.${input.fromPosition}`]: sampleObjId
      },
      {
        $unset: {
          [`occupancyGrid.${input.fromPosition}`]: ''
        },
        $inc: {
          currentOccupancy: -1
        },
        $set: {
          updatedAt: new Date()
        }
      },
      { session }
    );

    if (sourceUpdate.matchedCount === 0) {
      throw new Error('Origem inconsistente: posição de origem não contém a amostra informada');
    }

    // #646 Wave 3 (RF017 AC#7) -- see checkLocationBlocked's own comment.
    // Checked against the destination box only, after the source position
    // is already freed above -- a blocked destination still leaves the
    // specimen correctly vacated from its old position; the caller (not
    // this method) is responsible for retrying with a different target.
    const toBox = await storageBoxesCollection.findOne({ _id: toBoxObjId }, { session });
    if (!toBox) {
      throw new Error('Caixa de destino não encontrada');
    }
    const locationCheck = await this.checkLocationBlocked(toBox, session);
    if (locationCheck.blocked) {
      throw new Error(locationCheck.message);
    }

    const targetUpdate = await storageBoxesCollection.updateOne(
      {
        _id: toBoxObjId,
        [`occupancyGrid.${input.toPosition}`]: { $exists: false }
      },
      {
        $set: {
          [`occupancyGrid.${input.toPosition}`]: sampleObjId,
          updatedAt: new Date()
        },
        $inc: {
          currentOccupancy: 1
        }
      },
      { session }
    );

    if (targetUpdate.matchedCount === 0) {
      throw new Error('STORAGE_COLLISION: posição de destino já ocupada ou inválida');
    }

    const sampleUpdate = await samplesCollection.updateOne(
      { _id: sampleObjId },
      {
        $set: {
          'storageLocation.boxId': toBoxObjId,
          'storageLocation.position': input.toPosition,
          updatedAt: new Date()
        }
      },
      { session }
    );

    if (sampleUpdate.matchedCount === 0) {
      throw new Error('Falha ao atualizar localização da amostra');
    }

    await this.closeStorageAssignment(
      { specimenId: input.specimenId, boxId: fromBoxObjId, positionCode: input.fromPosition },
      session
    );
    await this.openStorageAssignment(
      { specimenId: input.specimenId, boxId: toBoxObjId, positionCode: input.toPosition },
      session
    );
  }

  /**
   * @param {{ specimenId: string, boxId: string, position: string }} input
   * @param {import('mongodb').ClientSession} session
   */
  async allocateSamplePosition(input, session) {
    const samplesCollection = await getCollection(this.db, 'samples');
    const storageBoxesCollection = this.db.collection('storageBoxes');

    const sampleObjId = this.toObjectId(input.specimenId);
    const boxObjId = this.toObjectId(input.boxId);
    const normalizedPosition = String(input.position).trim().toUpperCase();

    const sample = await samplesCollection.findOne({ _id: sampleObjId }, { session });
    if (!sample) {
      throw new Error('Amostra não encontrada');
    }

    if (sample?.storageLocation?.boxId && sample?.storageLocation?.position) {
      throw new Error('Amostra já está alocada em outra posição');
    }

    const box = await storageBoxesCollection.findOne({ _id: boxObjId }, { session });
    if (!box) {
      throw new Error('Caixa de armazenamento não encontrada');
    }

    // #646 Wave 3 (RF017 AC#7) -- see checkLocationBlocked's own comment.
    const locationCheck = await this.checkLocationBlocked(box, session);
    if (locationCheck.blocked) {
      throw new Error(locationCheck.message);
    }

    const positionRegex = /^([A-Z])(\d+)$/;
    const positionMatch = normalizedPosition.match(positionRegex);
    if (!positionMatch) {
      throw new Error('Posição inválida. Use o formato Letra+Número (ex: A1, B4)');
    }

    const [, rowLetter, columnString] = positionMatch;
    const rowIndex = rowLetter.charCodeAt(0) - 65;
    const column = parseInt(columnString, 10);
    const maxRows = Number(box?.dimension?.rows || 0);
    const maxCols = Number(box?.dimension?.cols || 0);

    if (rowIndex < 0 || rowIndex >= maxRows || column < 1 || column > maxCols) {
      throw new Error('Posição fora dos limites da caixa');
    }

    const updateBox = await storageBoxesCollection.updateOne(
      {
        _id: boxObjId,
        [`occupancyGrid.${normalizedPosition}`]: { $exists: false }
      },
      {
        $set: {
          [`occupancyGrid.${normalizedPosition}`]: sampleObjId,
          updatedAt: new Date()
        },
        $inc: {
          currentOccupancy: 1
        }
      },
      { session }
    );

    if (updateBox.matchedCount === 0) {
      throw new Error('STORAGE_COLLISION: posição já ocupada');
    }

    // SampleModel.create() defaults storageLocation to a literal `null`
    // (not an empty object) — a dotted-path $set into a null field is
    // rejected by real MongoDB ("Cannot create field 'boxId' in element
    // {storageLocation: null}"), so the very first allocation after create
    // must replace the whole object, not set nested paths inside it.
    const updateSample = await samplesCollection.updateOne(
      { _id: sampleObjId },
      {
        $set: {
          storageLocation: { boxId: boxObjId, position: normalizedPosition },
          updatedAt: new Date()
        }
      },
      { session }
    );

    if (updateSample.modifiedCount === 0) {
      throw new Error('Falha ao atualizar amostra');
    }

    await this.openStorageAssignment(
      { specimenId: input.specimenId, boxId: boxObjId, positionCode: normalizedPosition },
      session
    );
  }

  /**
   * Re-checks box/sample freshness inside an already-open transaction, scans
   * for the first free position, and performs the atomic occupancyGrid +
   * sample write. Throws BOX_NOT_FOUND / SAMPLE_NOT_FOUND / ALREADY_ALLOCATED /
   * BOX_FULL / STORAGE_COLLISION on failure so callers can map them to their
   * own result shape.
   *
   * @param {{ specimenId: string|import('mongodb').ObjectId, boxId: string|import('mongodb').ObjectId }} input
   * @param {import('mongodb').ClientSession} session
   * @returns {Promise<string>} the assigned position (e.g. "A1")
   */
  async autoAssignSamplePosition(input, session) {
    const samplesCollection = await getCollection(this.db, 'samples');
    const storageBoxesCollection = this.db.collection('storageBoxes');
    const sampleObjId = this.toObjectId(input.specimenId);
    const boxObjId = this.toObjectId(input.boxId);

    const freshBox = await storageBoxesCollection.findOne({ _id: boxObjId }, { session });
    if (!freshBox) {
      throw new Error('BOX_NOT_FOUND');
    }

    // #646 Wave 3 (RF017 AC#7) -- see checkLocationBlocked's own comment.
    const locationCheck = await this.checkLocationBlocked(freshBox, session);
    if (locationCheck.blocked) {
      throw new Error(locationCheck.error);
    }

    const freshSample = await samplesCollection.findOne({ _id: sampleObjId }, { session });
    if (!freshSample) {
      throw new Error('SAMPLE_NOT_FOUND');
    }

    if (freshSample.storageLocation?.boxId && freshSample.storageLocation?.position) {
      throw new Error('ALREADY_ALLOCATED');
    }

    const lockedPosition = positionGrid.findFirstAvailablePosition(freshBox);
    if (!lockedPosition) {
      throw new Error('BOX_FULL');
    }

    const updateBoxResult = await storageBoxesCollection.updateOne(
      {
        _id: boxObjId,
        [`occupancyGrid.${lockedPosition}`]: { $exists: false }
      },
      {
        $set: {
          [`occupancyGrid.${lockedPosition}`]: sampleObjId,
          currentOccupancy: Number(freshBox.currentOccupancy || 0) + 1,
          updatedAt: new Date(),
          lastModified: new Date()
        }
      },
      { session }
    );

    if (updateBoxResult.matchedCount === 0) {
      throw new Error('STORAGE_COLLISION: Colisão detectada durante alocação automática');
    }

    // Same null-parent dotted-path issue allocateSamplePosition fixes above
    // — storageLocation starts as a literal `null`, so the first allocation
    // must replace the whole object rather than $set nested paths into it.
    const updateSampleResult = await samplesCollection.updateOne(
      { _id: sampleObjId },
      {
        $set: {
          storageLocation: { boxId: boxObjId, position: lockedPosition },
          updatedAt: new Date()
        }
      },
      { session }
    );

    if (updateSampleResult.matchedCount === 0) {
      throw new Error('Falha ao atualizar a amostra após alocação automática');
    }

    // #1003: the other three storage-placement writers (allocateSamplePosition,
    // moveSamplePosition, releaseSamplePosition) each open/close a
    // StorageAssignment row -- auto-assign never did, so findSampleById never
    // resolved a storageAssignment for an auto-assigned specimen and
    // releaseSamplePosition/moveSamplePosition both refused to act on it.
    await this.openStorageAssignment(
      { specimenId: input.specimenId, boxId: boxObjId, positionCode: lockedPosition },
      session
    );

    return lockedPosition;
  }

  /**
   * Undoes an autoAssignSamplePosition write (used when a downstream step,
   * e.g. the Neo4j sync, fails after the Mongo allocation already committed).
   *
   * @param {{ specimenId: string|import('mongodb').ObjectId, boxId: string|import('mongodb').ObjectId, position: string }} input
   * @param {import('mongodb').ClientSession} session
   */
  async rollbackAutoAssignedPosition(input, session) {
    const samplesCollection = await getCollection(this.db, 'samples');
    const storageBoxesCollection = this.db.collection('storageBoxes');
    const sampleObjId = this.toObjectId(input.specimenId);
    const boxObjId = this.toObjectId(input.boxId);

    await storageBoxesCollection.updateOne(
      {
        _id: boxObjId,
        [`occupancyGrid.${input.position}`]: sampleObjId
      },
      {
        $unset: {
          [`occupancyGrid.${input.position}`]: ''
        },
        $inc: {
          currentOccupancy: -1
        },
        $set: {
          updatedAt: new Date(),
          lastModified: new Date()
        }
      },
      { session }
    );

    await samplesCollection.updateOne(
      {
        _id: sampleObjId,
        'storageLocation.boxId': boxObjId,
        'storageLocation.position': input.position
      },
      {
        $unset: {
          storageLocation: ''
        },
        $set: {
          updatedAt: new Date()
        }
      },
      { session }
    );

    // #1003: compensates the openStorageAssignment hunk A added to
    // autoAssignSamplePosition above -- without this, a rollback (e.g. the
    // Neo4j-sync-failed path in storageService.js) would leave an OPEN
    // StorageAssignment for a specimen that is no longer allocated.
    await this.closeStorageAssignment(
      { specimenId: input.specimenId, boxId: boxObjId, positionCode: input.position },
      session
    );
  }

  /**
   * @param {{ specimenId: string }} input
   * @param {import('mongodb').ClientSession} session
   */
  async releaseSamplePosition(input, session) {
    const samplesCollection = await getCollection(this.db, 'samples');
    const storageBoxesCollection = this.db.collection('storageBoxes');

    const sampleObjId = this.toObjectId(input.specimenId);
    const sample = await samplesCollection.findOne({ _id: sampleObjId }, { session });

    if (!sample) {
      throw new Error('Amostra não encontrada');
    }

    const sourceBoxId = sample?.storageLocation?.boxId;
    const sourcePosition = sample?.storageLocation?.position;

    if (!sourceBoxId || !sourcePosition) {
      throw new Error('Amostra não possui localização de armazenamento');
    }

    const sourceBoxObjId = this.toObjectId(sourceBoxId);

    const boxUpdate = await storageBoxesCollection.updateOne(
      {
        _id: sourceBoxObjId,
        [`occupancyGrid.${sourcePosition}`]: sampleObjId
      },
      {
        $unset: {
          [`occupancyGrid.${sourcePosition}`]: ''
        },
        $inc: {
          currentOccupancy: -1
        },
        $set: {
          updatedAt: new Date()
        }
      },
      { session }
    );

    if (boxUpdate.matchedCount === 0) {
      throw new Error('Origem inconsistente: posição de origem não contém a amostra informada');
    }

    await samplesCollection.updateOne(
      { _id: sampleObjId },
      {
        $unset: {
          storageLocation: ''
        },
        $set: {
          updatedAt: new Date()
        }
      },
      { session }
    );

    await this.closeStorageAssignment(
      { specimenId: input.specimenId, boxId: sourceBoxObjId, positionCode: String(sourcePosition).toUpperCase() },
      session
    );

    return {
      from: {
        boxId: String(sourceBoxId),
        position: String(sourcePosition).toUpperCase()
      },
      barcode: sample.barcode || null,
      quantity: sample.quantity || null,
      unit: sample.unit || 'µL'
    };
  }

  /**
   * @param {{ boxId: string, position: string }} input
   */
  /**
   * #646 Wave 3 (RF017 AC#7): "Bloquear local indisponível, interditado ou
   * fora de condição" -- StorageBox.status (ACTIVE/FULL/RETIRED) and
   * StorageContainer.status (OPERATIONAL/MAINTENANCE/RETIRED) both already
   * existed but were never checked at any allocation entry point, so a
   * RETIRED box (or one whose rack/shelf/freezer ancestor was RETIRED or
   * under MAINTENANCE) still accepted new allocations as long as the
   * specific position was unoccupied. Shared by every write/check path
   * below (validatePositionAvailability, allocateSamplePosition,
   * autoAssignSamplePosition, moveSamplePosition's destination box) so the
   * block is consistent regardless of which one a caller uses -- fixing
   * only validatePositionAvailability (a separate pre-flight check
   * endpoint) would have left the real allocation paths unguarded.
   * @param {object} box - the StorageBox document (already fetched by the caller)
   * @param {import('mongodb').ClientSession} [session]
   * @returns {Promise<{blocked: boolean, error?: string, message?: string}>}
   */
  async checkLocationBlocked(box, session) {
    if (box.status === 'RETIRED') {
      return {
        blocked: true,
        error: 'BOX_UNAVAILABLE',
        message: `StorageBox ${box._id} está retirada de uso (status: RETIRED)`
      };
    }

    const storagePath = await this.db.collection('storagePaths').findOne({ boxId: box._id }, { session });
    const ancestorIds = storagePath
      ? [storagePath.rackId, storagePath.shelfId, storagePath.freezerId].filter(Boolean)
      // #654: storagePaths is never written anywhere, so this is the path
      // every real box takes — without it, a RETIRED/MAINTENANCE ancestor
      // could never block allocation for any real box.
      : (await this.resolveAncestorContainersLive(box.parent_id, session)).map((c) => c._id);
    if (ancestorIds.length > 0) {
      // #655 regression fix: a raw-driver insert (every e2e seed helper
      // besides the FREEZER level, per #598 -- and potentially real legacy
      // data) can produce a container with no status field at all.
      // { $ne: 'OPERATIONAL' } alone matches a missing field just as
      // readily as an explicit non-operational one; { $exists: true } scopes
      // the block to containers that actually have a status set, matching
      // StorageContainer.js's own Mongoose default (OPERATIONAL when unset).
      const blockedAncestor = await this.db.collection('storageContainers').findOne({
        _id: { $in: ancestorIds },
        status: { $exists: true, $ne: 'OPERATIONAL' }
      }, { session });
      if (blockedAncestor) {
        return {
          blocked: true,
          error: 'LOCATION_UNAVAILABLE',
          message: `Localização indisponível: ${blockedAncestor.containerType || 'container'} "${blockedAncestor.name || blockedAncestor._id}" está com status ${blockedAncestor.status}`
        };
      }
    }

    return { blocked: false };
  }

  async validatePositionAvailability(input) {
    const storageBoxesCollection = this.db.collection('storageBoxes');
    const boxObjId = this.toObjectId(input.boxId);
    const position = String(input.position).trim().toUpperCase();

    const box = await storageBoxesCollection.findOne({ _id: boxObjId });
    if (!box) {
      return {
        available: false,
        error: 'BOX_NOT_FOUND',
        message: `StorageBox ${input.boxId} não encontrada`
      };
    }

    // Checked before the position-format/bounds work below, since "this
    // box can't be used at all" doesn't depend on which position was
    // requested.
    const locationCheck = await this.checkLocationBlocked(box);
    if (locationCheck.blocked) {
      return { available: false, error: locationCheck.error, message: locationCheck.message };
    }

    const positionRegex = /^([A-Z])(\d+)$/;
    const match = position.match(positionRegex);
    if (!match) {
      return {
        available: false,
        error: 'INVALID_POSITION_FORMAT',
        message: `Posição "${position}" inválida. Usar formato: Letra+Número (ex: A1, B4)`
      };
    }

    const [, rowLetter, colStr] = match;
    const row = rowLetter.charCodeAt(0) - 65;
    const col = parseInt(colStr, 10);
    const maxRows = Number(box?.dimension?.rows || 0);
    const maxCols = Number(box?.dimension?.cols || 0);

    if (row >= maxRows || row < 0) {
      return {
        available: false,
        error: 'POSITION_OUT_OF_BOUNDS_ROW',
        message: `Posição "${position}" fora do intervalo. Linhas válidas: A até ${String.fromCharCode(65 + maxRows - 1)}`
      };
    }

    if (col > maxCols || col < 1) {
      return {
        available: false,
        error: 'POSITION_OUT_OF_BOUNDS_COL',
        message: `Posição "${position}" fora do intervalo. Colunas válidas: 1 até ${maxCols}`
      };
    }

    // Plain-object bracket access is safe here even though `occupancyGrid`
    // is declared as a Mongoose Map in the schema (StorageBox.js): `box` is
    // fetched via the native driver's `findOne` above, never via the
    // Mongoose model, so `occupancyGrid` is always a plain BSON object on
    // this path. See #484 (split from #480/#23) — storageService.js's
    // sibling method uses a polymorphic Map/object check because it fetches
    // the same way; that extra branch is defensive, not load-bearing.
    const occupiedSampleId = box.occupancyGrid?.[position] || null;
    if (occupiedSampleId) {
      return {
        available: false,
        error: 'STORAGE_COLLISION',
        message: `Posição "${position}" já está ocupada por amostra ${occupiedSampleId}`,
        occupiedBySampleId: String(occupiedSampleId)
      };
    }

    return {
      available: true,
      boxData: {
        boxId: box._id,
        boxName: box.name,
        dimension: box.dimension,
        currentOccupancy: box.currentOccupancy || 0,
        capacity: (box.dimension?.rows || 0) * (box.dimension?.cols || 0),
        availablePositions: ((box.dimension?.rows || 0) * (box.dimension?.cols || 0)) - (box.currentOccupancy || 0)
      }
    };
  }

  /**
   * @param {{ boxId: string }} input
   */
  async getBoxAvailablePositions(input) {
    const storageBoxesCollection = this.db.collection('storageBoxes');
    const boxObjId = this.toObjectId(input.boxId);
    const box = await storageBoxesCollection.findOne({ _id: boxObjId });

    if (!box) return null;

    const positions = [];
    const rows = Number(box?.dimension?.rows || 0);
    const cols = Number(box?.dimension?.cols || 0);
    for (let row = 0; row < rows; row += 1) {
      const rowLetter = String.fromCharCode(65 + row);
      for (let col = 1; col <= cols; col += 1) {
        positions.push(`${rowLetter}${col}`);
      }
    }

    const occupancyGrid = box.occupancyGrid || {};
    const availablePositions = positions.filter((position) => !occupancyGrid[position]);
    const occupiedPositions = positions.filter((position) => !!occupancyGrid[position]);
    const capacity = rows * cols;
    const occupied = Number(box.currentOccupancy || 0);

    return {
      boxId: box._id,
      boxName: box.name,
      dimension: box.dimension,
      stats: {
        capacity,
        occupied,
        available: availablePositions.length,
        occupancyPercent: capacity > 0 ? Math.round((occupied / capacity) * 100) : 0
      },
      availablePositions,
      occupiedPositions: occupiedPositions.slice(0, 10)
    };
  }

  /**
   * @param {{ specimenId: string }} input
   */
  async getSampleStorageLocation(input) {
    const samplesCollection = await getCollection(this.db, 'samples');
    const storagePathsCollection = this.db.collection('storagePaths');
    const sampleObjId = this.toObjectId(input.specimenId);

    const sample = await samplesCollection.findOne({ _id: sampleObjId });
    if (!sample) {
      return {
        found: false,
        error: 'SAMPLE_NOT_FOUND'
      };
    }

    if (!sample?.storageLocation?.boxId) {
      return {
        found: false,
        message: 'Amostra sem localização de armazenamento'
      };
    }

    const boxObjId = this.toObjectId(sample.storageLocation.boxId);
    const storagePath = await storagePathsCollection.findOne({ boxId: boxObjId });
    const liveResolution = storagePath ? null : await this.resolveLiveStoragePath(boxObjId);

    return {
      found: true,
      location: {
        specimenId: sample._id,
        barcode: sample.barcode,
        box: {
          boxId: sample.storageLocation.boxId,
          boxName: sample.storageLocation.boxName || null,
          position: sample.storageLocation.position
        },
        locationID: sample.storageLocation.locationID || null,
        readable: sample.storageLocation.readable || null,
        path: storagePath?.path || liveResolution?.path || 'N/A',
        fullHierarchy: storagePath
          ? {
              freezerId: storagePath.freezerId,
              shelfId: storagePath.shelfId,
              rackId: storagePath.rackId,
              boxId: storagePath.boxId
            }
          : (liveResolution ? liveResolution.fullHierarchy : null)
      }
    };
  }

  /**
   * Batched form of getSampleStorageLocation for a page of already-fetched
   * sample documents (#517, SamplesPageView list view): one storagePaths
   * query across every referenced boxId instead of one getSampleStorageLocation
   * call per row, keyed by specimenId string for O(1) attachment by callers.
   * Same resolution source as getSampleStorageLocation (the dual-written
   * sample.storageLocation embedded field, not the storageAssignments
   * collection) so the two stay consistent.
   * @param {Array<{_id: any, barcode?: string, storageLocation?: any}>} samples
   * @returns {Promise<Map<string, object|null>>}
   */
  async resolveStorageLocationsForSamples(samples) {
    const storagePathsCollection = this.db.collection('storagePaths');

    const boxIds = samples
      .map((sample) => sample?.storageLocation?.boxId)
      .filter(Boolean)
      .map((boxId) => this.toObjectId(boxId));

    const paths = boxIds.length
      ? await storagePathsCollection.find({ boxId: { $in: boxIds } }).toArray()
      : [];
    const pathByBoxId = new Map(paths.map((path) => [String(path.boxId), path]));

    // #657: same live parent_id-walk fallback getSampleStorageLocation uses,
    // deduped by boxId so samples sharing a box (same page) trigger only one
    // live resolution instead of one per sample.
    const missingBoxIds = boxIds.filter((boxId) => !pathByBoxId.has(String(boxId)));
    const liveByBoxId = new Map();
    for (const boxId of missingBoxIds) {
      const key = String(boxId);
      if (liveByBoxId.has(key)) continue;
      liveByBoxId.set(key, await this.resolveLiveStoragePath(boxId));
    }

    const result = new Map();
    for (const sample of samples) {
      const key = String(sample._id);
      if (!sample?.storageLocation?.boxId) {
        result.set(key, null);
        continue;
      }

      const boxKey = String(sample.storageLocation.boxId);
      const storagePath = pathByBoxId.get(boxKey) || null;
      const liveResolution = storagePath ? null : liveByBoxId.get(boxKey);
      result.set(key, {
        specimenId: sample._id,
        barcode: sample.barcode,
        box: {
          boxId: sample.storageLocation.boxId,
          boxName: sample.storageLocation.boxName || null,
          position: sample.storageLocation.position
        },
        locationID: sample.storageLocation.locationID || null,
        readable: sample.storageLocation.readable || null,
        path: storagePath?.path || liveResolution?.path || 'N/A',
        fullHierarchy: storagePath
          ? {
              freezerId: storagePath.freezerId,
              shelfId: storagePath.shelfId,
              rackId: storagePath.rackId,
              boxId: storagePath.boxId
            }
          : (liveResolution ? liveResolution.fullHierarchy : null)
      });
    }

    return result;
  }

  /**
   * @param {{ query: string, scopeFilter?: object }} input - scopeFilter: #1211's organization terms
   */
  async searchAllocatableSampleCandidates(input) {
    const searchTerm = String(input.query || '').trim();
    if (searchTerm.length < 2) return [];

    const samplesCollection = await getCollection(this.db, 'samples');

    const searchRegex = new RegExp(escapeRegex(searchTerm), 'i');
    return samplesCollection.find({
      $and: [
        {
          $or: [
            { barcode: searchRegex },
            { participantId: searchRegex },
            { specimenId: searchRegex }
          ]
        },
        { specimenStatus: { $in: ['available', 'reserved'] } },
        {
          $or: [
            { 'storageLocation.boxId': { $exists: false } },
            { 'storageLocation.boxId': null }
          ]
        },
        ...(input.scopeFilter && Object.keys(input.scopeFilter).length > 0 ? [input.scopeFilter] : [])
      ]
    }).limit(20).toArray();
  }

  /**
   * @param {string|import('mongodb').ObjectId} id
   */
  toObjectId(id) {
    if (id instanceof ObjectId) return id;
    try {
      if (typeof id === 'string' && ObjectId.isValid(id)) {
        return new ObjectId(id);
      }
    } catch (err) {
      return id;
    }
    return id;
  }
}

module.exports = MongoStorageRepository;
