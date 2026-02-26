/**
 * Repositório de auditoria imutável em MongoDB.
 */
class MongoAuditRepository {
  /**
   * @param {import('mongodb').Db} db
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * @param {{ sampleId: string, barcode?: string|null, eventType: string, before: object, after: object, context: object, timestamp: Date }} input
   * @param {import('mongodb').ClientSession} [session]
   * @returns {Promise<{ movementID: number }>}
   */
  async appendImmutableAudit(input, session) {
    const movementsCollection = this.db.collection('sample_movements');

    const movementID = await this.generateMovementID(session);

    await movementsCollection.insertOne(
      {
        movementID,
        sampleID: input.sampleId,
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
    const countersCollection = this.db.collection('counters');
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

    return counter.value.seq;
  }
}

module.exports = MongoAuditRepository;
