const { ObjectId } = require('mongodb');
const { getCollection } = require('../../../utils/collectionResolver');
const NormalizedPhysicalStorageStore = require('./NormalizedPhysicalStorageStore');

class MongoStorageTopologyReadRepository {
  /**
   * @param {import('mongodb').Db} db
   */
  constructor(db) {
    this.db = db;
  }

  async listOperationalFreezers() {
    const storageContainersCollection = this.db.collection('storageContainers');
    return storageContainersCollection
      .find({
        containerType: 'FREEZER',
        status: 'OPERATIONAL'
      })
      .sort({ name: 1 })
      .toArray();
  }

  /**
   * @param {{ freezerId: string }} input
   */
  async getFreezerOccupancyStats(input) {
    const storageContainersCollection = this.db.collection('storageContainers');
    const storageBoxesCollection = this.db.collection('storageBoxes');
    const freezerObjId = this.toObjectId(input.freezerId);

    const freezer = await storageContainersCollection.findOne({
      _id: freezerObjId,
      containerType: 'FREEZER'
    });

    if (!freezer) {
      return {
        stats: null,
        error: 'FREEZER_NOT_FOUND'
      };
    }

    const stats = await storageBoxesCollection
      .aggregate([
        {
          $lookup: {
            from: 'storageContainers',
            localField: 'parent_id',
            foreignField: '_id',
            as: 'rack'
          }
        },
        { $unwind: '$rack' },
        {
          $group: {
            _id: '$rack._id',
            rackName: { $first: '$rack.name' },
            totalCapacity: {
              $sum: {
                $multiply: ['$dimension.rows', '$dimension.cols']
              }
            },
            totalOccupied: { $sum: '$currentOccupancy' }
          }
        },
        { $sort: { rackName: 1 } }
      ])
      .toArray();

    const totalCapacity = stats.reduce((sum, rack) => sum + rack.totalCapacity, 0);
    const totalOccupied = stats.reduce((sum, rack) => sum + rack.totalOccupied, 0);

    return {
      stats: {
        freezerId: freezer._id,
        freezerName: freezer.name,
        temperature: freezer.temperature,
        rackStats: stats,
        aggregate: {
          totalCapacity,
          totalOccupied,
          totalAvailable: totalCapacity - totalOccupied,
          occupancyPercent: totalCapacity > 0 ? Math.round((totalOccupied / totalCapacity) * 100) : 0
        }
      }
    };
  }

  /**
   * @param {{ freezerId: string }} input
   */
  async getFreezerTree(input) {
    const storageContainersCollection = this.db.collection('storageContainers');
    const storageBoxesCollection = this.db.collection('storageBoxes');
    const freezerObjId = this.toObjectId(input.freezerId);

    const freezer = await storageContainersCollection.findOne({
      _id: freezerObjId,
      containerType: 'FREEZER'
    });

    if (!freezer) return null;

    const shelves = await storageContainersCollection
      .find({ parent_id: freezerObjId, containerType: 'SHELF' })
      .sort({ name: 1 })
      .toArray();

    const shelvesWithRacks = await Promise.all(
      shelves.map(async (shelf) => {
        const racks = await storageContainersCollection
          .find({ parent_id: shelf._id, containerType: 'RACK' })
          .sort({ name: 1 })
          .toArray();

        const racksWithBoxes = await Promise.all(
          racks.map(async (rack) => {
            const boxes = await storageBoxesCollection
              .find({ parent_id: rack._id })
              .sort({ name: 1 })
              .toArray();

            const boxesWithStats = boxes.map((box) => {
              const capacity = Number(box?.dimension?.rows || 0) * Number(box?.dimension?.cols || 0);
              const occupied = Number(box.currentOccupancy || 0);
              return {
                boxId: box._id,
                boxName: box.name,
                boxID: box.boxID,
                dimension: box.dimension,
                stats: {
                  capacity,
                  occupied,
                  available: capacity - occupied,
                  occupancyPercent: capacity > 0 ? Math.round((occupied / capacity) * 100) : 0
                },
                status: box.status
              };
            });

            return {
              rackId: rack._id,
              rackName: rack.name,
              boxes: boxesWithStats,
              stats: {
                boxes: boxesWithStats.length,
                totalCapacity: boxesWithStats.reduce((sum, box) => sum + box.stats.capacity, 0),
                totalOccupied: boxesWithStats.reduce((sum, box) => sum + box.stats.occupied, 0)
              }
            };
          })
        );

        return {
          shelfId: shelf._id,
          shelfName: shelf.name,
          racks: racksWithBoxes,
          stats: {
            racks: racksWithBoxes.length,
            boxes: racksWithBoxes.reduce((sum, rack) => sum + rack.boxes.length, 0),
            totalCapacity: racksWithBoxes.reduce((sum, rack) => sum + rack.stats.totalCapacity, 0),
            totalOccupied: racksWithBoxes.reduce((sum, rack) => sum + rack.stats.totalOccupied, 0)
          }
        };
      })
    );

    const totalCapacity = shelvesWithRacks.reduce((sum, shelf) => sum + shelf.stats.totalCapacity, 0);
    const totalOccupied = shelvesWithRacks.reduce((sum, shelf) => sum + shelf.stats.totalOccupied, 0);

    return {
      freezerId: freezer._id,
      freezerName: freezer.name,
      temperature: freezer.temperature,
      temperatureUnit: freezer.temperatureUnit,
      status: freezer.status,
      shelves: shelvesWithRacks,
      aggregateStats: {
        totalShelves: shelvesWithRacks.length,
        totalRacks: shelvesWithRacks.reduce((sum, shelf) => sum + shelf.stats.racks, 0),
        totalBoxes: shelvesWithRacks.reduce((sum, shelf) => sum + shelf.stats.boxes, 0),
        totalCapacity,
        totalOccupied,
        totalAvailable: totalCapacity - totalOccupied,
        occupancyPercent: totalCapacity > 0 ? Math.round((totalOccupied / totalCapacity) * 100) : 0
      }
    };
  }

  /**
   * Validates the denormalized StorageBox occupancy cache against the
   * authoritative canonical-v2 custody chain. The box grid remains a layout
   * acceleration structure; it is never accepted as specimen placement
   * authority.
   *
   * @param {{ boxId: string }} input
   */
  async checkBoxIntegrity(input) {
    const storageBoxesCollection = this.db.collection('storageBoxes');
    const samplesCollection = await getCollection(this.db, 'Specimen');
    const physicalStore = new NormalizedPhysicalStorageStore(this.db);

    const boxObjId = this.toObjectId(input.boxId);
    const box = await storageBoxesCollection.findOne({ _id: boxObjId });
    if (!box) {
      return {
        valid: false,
        error: 'BOX_NOT_FOUND'
      };
    }

    const errors = [];
    let actualCount = 0;
    const occupancyGrid = box.occupancyGrid || {};

    for (const [position, specimenRef] of Object.entries(occupancyGrid)) {
      if (!specimenRef) continue;
      actualCount += 1;

      const normalizedSampleId = this.toObjectId(specimenRef);
      const sample = await samplesCollection.findOne({ _id: normalizedSampleId });

      if (!sample) {
        errors.push(`Orfão: posição ${position} referencia amostra inexistente ${specimenRef}`);
        continue;
      }

      const canonicalSpecimenId = sample.specimenId || sample._id;
      const placement = await physicalStore.findCurrentBySpecimen(canonicalSpecimenId);
      if (!placement) {
        errors.push(
          `Inconsistência: Box referencia ${specimenRef} em ${position}, ` +
          'mas não existe posicionamento físico canônico ativo'
        );
        continue;
      }

      if (
        String(placement.boxId) !== String(boxObjId) ||
        String(placement.positionCode).toUpperCase() !== String(position).toUpperCase()
      ) {
        errors.push(
          `Inconsistência: Box referencia ${specimenRef} em ${position}, ` +
          `mas a cadeia canônica aponta para ${placement.boxId}/${placement.positionCode}`
        );
      }
    }

    if (actualCount !== Number(box.currentOccupancy || 0)) {
      errors.push(
        `Contagem incorreta: currentOccupancy=${box.currentOccupancy}, mas ocupação real=${actualCount}`
      );
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      stats: {
        boxId: box._id,
        dimension: box.dimension,
        capacity: Number(box?.dimension?.rows || 0) * Number(box?.dimension?.cols || 0),
        currentOccupancy: Number(box.currentOccupancy || 0),
        actualOccupancy: actualCount
      }
    };
  }

  /**
   * @param {string|import('mongodb').ObjectId} id
   */
  toObjectId(id) {
    if (id instanceof ObjectId) return id;
    if (typeof id === 'string' && ObjectId.isValid(id)) {
      return new ObjectId(id);
    }
    return id;
  }
}

module.exports = MongoStorageTopologyReadRepository;
