const { GraphProjectionService } = require('../../../services/graphProjection.service');

/**
 * Chain-of-custody trail (ISO 20387) for the custody use cases.
 *
 * #1312 (RF023 AC8): no request path writes Neo4j. A custody step is an
 * outbox event (CUSTODY_EVENT_RECORDED) appended to MongoDB, inside the
 * caller's transaction when it passes one, and the projector applies it to
 * the graph. Nothing here reads or writes Neo4j, and no consent is read from
 * the projection: MongoDB is the consent authority.
 */
class LineageRepository {
  /**
   * @param {import('mongodb').Db} db
   * @param {{ graphProjection?: GraphProjectionService }} [options]
   */
  constructor(db, options = {}) {
    this.db = db || null;
    this.graphProjection = options.graphProjection || new GraphProjectionService();
  }

  normalizePointerId(pointer, fieldName) {
    const normalized = pointer !== undefined && pointer !== null ? String(pointer).trim() : '';
    if (!normalized) {
      throw new Error(`[ISO20387][LINEAGE] ${fieldName} obrigatório para trilha de custódia`);
    }
    return normalized;
  }

  /**
   * In-process check of the fields a custody event needs, run before any
   * MongoDB write. It reads nothing.
   */
  async validateBeforePersistence(input) {
    this.normalizePointerId(input?.specimenId, 'specimenId');
    if (!input?.eventType) {
      throw new Error('[ISO20387][LINEAGE] eventType obrigatório para trilha de custódia');
    }
    return true;
  }

  /**
   * Appends the custody step to the graph outbox. `options.session` is the
   * aggregate's Mongo transaction: the event commits or aborts with it.
   * @returns {Promise<{ eventId: string|null }>}
   */
  async recordCustodyEvent(input, options = {}) {
    if (!this.db) {
      throw new Error('[ISO20387][LINEAGE] Banco MongoDB indisponível para a trilha de custódia');
    }
    await this.validateBeforePersistence(input);

    const appended = await this.graphProjection.appendCustodyEvent(this.db, {
      specimenId: this.normalizePointerId(input.specimenId, 'specimenId'),
      barcode: input.barcode || null,
      eventType: String(input.eventType),
      happenedAt: input.happenedAt || new Date(),
      actorId: input.actorId || null,
      reason: input.reason || null,
      from: input.from || null,
      to: input.to || null,
      sourceService: 'lineage-repository'
    }, options.session ? { session: options.session } : {});

    return { eventId: appended?.eventId || null };
  }
}

module.exports = LineageRepository;
