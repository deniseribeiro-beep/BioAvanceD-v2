/**
 * Repositório de auditoria imutável em MongoDB.
 */
const sampleMovementLedger = require('../../../utils/sampleMovementLedger');

function createIsolatedCollectionView(collection) {
  const overrides = new Map();

  return new Proxy(collection, {
    get(target, prop, receiver) {
      if (overrides.has(prop)) {
        return overrides.get(prop);
      }

      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(_target, prop, value) {
      overrides.set(prop, value);
      return true;
    },
    defineProperty(_target, prop, descriptor) {
      if ('value' in descriptor) {
        overrides.set(prop, descriptor.value);
      }
      return true;
    },
    deleteProperty(_target, prop) {
      overrides.delete(prop);
      return true;
    }
  });
}

class MongoAuditRepository {
  /**
   * @param {import('mongodb').Db} db
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * @param {{ specimenId: string, barcode?: string|null, eventType: string, before: object, after: object, context: object, timestamp: Date }} input
   * @param {import('mongodb').ClientSession} [session]
   * @returns {Promise<{ movementID: number }>}
   */
  async appendImmutableAudit(input, session) {
    const movementsCollectionName = 'sampleMovements';
    const movementsCollection = createIsolatedCollectionView(this.db.collection(movementsCollectionName));
    sampleMovementLedger.enforceAppendOnlyCollection(movementsCollection, movementsCollectionName);
    await sampleMovementLedger.ensureSampleMovementIndexes(movementsCollection);

    const movementID = await this.generateMovementID(session);

    await sampleMovementLedger.appendMovementWithHashChain(
      movementsCollection,
      {
        movementID,
        specimenId: input.specimenId,
        barcode: input.barcode || null,
        type: input.eventType,
        quantity: null,
        unit: null,
        responsible: input?.context?.actor?.userName || 'SYSTEM',
        destination: null,
        purpose: input?.context?.reason || null,
        linkedProject: null,
        observations: input?.context?.notes || null,
        userId: input?.context?.actor?.userId || null,
        userName: input?.context?.actor?.userName || null,
        userRole: input?.context?.actor?.userRole || null,
        ipAddress: input?.context?.actor?.ipAddress || null,
        userAgent: input?.context?.actor?.userAgent || null,
        previousState: input.before,
        newState: input.after,
        timestamp: input.timestamp,
        createdAt: new Date(),
        immutable: true
      },
      { session }
    );

    return { movementID };
  }

  /**
   * @param {import('mongodb').ClientSession} [session]
   */
  async generateMovementID(session) {
    const countersCollectionName = 'counters';
    const countersCollection = this.db.collection(countersCollectionName);
    const counter = await countersCollection.findOneAndUpdate(
      { _id: 'sample_movements' },
      {
        $inc: { seq: 1 },
        $setOnInsert: { createdAt: new Date() }
      },
      {
        upsert: true,
        returnDocument: 'after',
        session
      }
    );

    // mongodb@6.x findOneAndUpdate returns the modified document directly
    // (not wrapped in `{ value: doc }` as pre-v5 drivers did) — see #294.
    return counter.seq;
  }
}

module.exports = MongoAuditRepository;
