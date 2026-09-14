const { connectDB } = require('../../../database/mongo');
const { withMongoTransaction } = require('../../../utils/mongoTransaction');
const MongoLineageRepository = require('../../persistence/mongo/MongoLineageRepository');

/**
 * Temporary compatibility adapter for legacy construction sites.
 *
 * RF023 v2 forbids domain writes to Neo4j. This class deliberately ignores
 * the historical Neo4j driver argument and delegates every domain operation
 * to the MongoDB canonical lineage repository + transactional outbox.
 *
 * It exists only while the remaining call sites are migrated; no Cypher or
 * Neo4j session is permitted here. Once consumers are zero this file is
 * deleted by the Wave 2 cleanup gate.
 */
class LineageRepository {
  constructor(_legacyNeo4jDriver = null, options = {}) {
    this.db = options.db || null;
  }

  async getDelegate() {
    const db = this.db || await connectDB();
    return new MongoLineageRepository(db);
  }

  async validateBeforePersistence(input, session) {
    const delegate = await this.getDelegate();
    return delegate.validateBeforePersistence(input, session);
  }

  async recordCustodyEvent(input, session) {
    const delegate = await this.getDelegate();
    if (session) return delegate.recordCustodyEvent(input, session);

    return withMongoTransaction(delegate.db, async (txSession) =>
      delegate.recordCustodyEvent(input, txSession)
    );
  }

  async createSampleNodeWithParent(input, session) {
    const delegate = await this.getDelegate();
    if (session) return delegate.createSampleNodeWithParent(input, session);

    return withMongoTransaction(delegate.db, async (txSession) =>
      delegate.createSampleNodeWithParent(input, txSession)
    );
  }

  async compensateCustodyEvent() {
    return {
      compensated: false,
      reason: 'rf023_transactional_outbox_requires_no_neo4j_compensation'
    };
  }
}

module.exports = LineageRepository;
