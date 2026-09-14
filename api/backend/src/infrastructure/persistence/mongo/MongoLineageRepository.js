const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const { getCollection } = require('../../../utils/collectionResolver');
const { GraphProjectionService } = require('../../../services/graphProjection.service');

const ACTIVE_CONSENT_STATUSES = new Set(['ACTIVE', 'VALID', 'GRANTED']);

class MongoLineageRepository {
  /**
   * RF023 v2: MongoDB is the operational authority. Neo4j is updated only
   * by the transactional graph outbox and is never consulted as an
   * authorization source for a domain write.
   *
   * @param {import('mongodb').Db} db
   * @param {{ graphProjectionService?: GraphProjectionService }} [options]
   */
  constructor(db, options = {}) {
    if (!db || typeof db.collection !== 'function') {
      throw new Error('[RF023] MongoDB obrigatório para linhagem canônica');
    }
    this.db = db;
    this.graphProjectionService = options.graphProjectionService || new GraphProjectionService();
  }

  normalizePointerId(pointer, fieldName) {
    const normalized = pointer !== undefined && pointer !== null ? String(pointer).trim() : '';
    if (!normalized) {
      throw new Error(`[RF023] ${fieldName} obrigatório para linhagem canônica`);
    }
    return normalized;
  }

  toObjectId(value) {
    if (value instanceof ObjectId) return value;
    return typeof value === 'string' && ObjectId.isValid(value) ? new ObjectId(value) : value;
  }

  async findSpecimen(specimenId, session) {
    const samples = await getCollection(this.db, 'samples');
    return samples.findOne({ _id: this.toObjectId(specimenId) }, { session });
  }

  async findActiveConsent(participantId, session) {
    if (!participantId) return null;
    const consents = await getCollection(this.db, 'consents');
    const rows = await consents
      .find({ participantId: String(participantId), status: { $in: [...ACTIVE_CONSENT_STATUSES] } }, { session })
      .sort({ signedAt: -1, createdAt: -1 })
      .limit(1)
      .toArray();
    return rows[0] || null;
  }

  async validateBeforePersistence(input, session) {
    const specimenId = this.normalizePointerId(input?.specimenId, 'specimenId');
    if (!input?.eventType) {
      throw new Error('[RF023] eventType obrigatório para trilha de custódia');
    }

    const specimen = await this.findSpecimen(specimenId, session);
    if (!specimen) {
      throw new Error('[RF023] Espécime canônico não encontrado no MongoDB');
    }

    if (input?.requireEthicalConsent === false) return true;

    const participantId = specimen.participantId || specimen.donorId || null;
    if (!participantId) {
      throw new Error('[RF023] Espécime sem participantId para decisão de consentimento');
    }

    const consent = await this.findActiveConsent(participantId, session);
    if (!consent) {
      throw new Error('[RF023] Consentimento ativo não encontrado na autoridade MongoDB');
    }

    return true;
  }

  async appendSpecimenProjection(specimen, session) {
    if (!specimen) return null;
    return this.graphProjectionService.appendSpecimenEvent(
      this.db,
      {
        specimenId: String(specimen._id),
        participantId: specimen.participantId || specimen.donorId || null,
        parentSpecimenId: specimen.parentSpecimenId || specimen.parentSampleId || null,
        barcode: specimen.barcode || null,
        specimenStatus: specimen.specimenStatus || specimen.status || null,
        sourceService: 'mongo-lineage-repository',
      },
      { session }
    );
  }

  async recordCustodyEvent(input, session) {
    const specimenId = this.normalizePointerId(input?.specimenId, 'specimenId');
    if (!input?.eventType) {
      throw new Error('[RF023] eventType obrigatório para trilha de custódia');
    }
    if (!session) {
      throw new Error('[RF023] Custódia e outbox devem compartilhar a transação MongoDB');
    }

    const specimen = await this.findSpecimen(specimenId, session);
    if (!specimen) {
      throw new Error('[RF023] Espécime canônico não encontrado no MongoDB');
    }

    await this.appendSpecimenProjection(specimen, session);

    const eventId = input.custodyEventId || crypto.randomUUID();
    await this.graphProjectionService.appendCustodyEvent(
      this.db,
      {
        specimenId,
        custodyEventId: eventId,
        eventType: String(input.eventType),
        happenedAt: input.happenedAt || new Date(),
        actorId: input.actorId || null,
        reason: input.reason || null,
        from: input.from || null,
        to: input.to || null,
        sourceService: 'mongo-lineage-repository',
      },
      { session }
    );

    return { eventId, queued: true };
  }

  async createSampleNodeWithParent(input, session) {
    const specimenId = this.normalizePointerId(input?.specimenId, 'specimenId');
    const specimen = await this.findSpecimen(specimenId, session);
    if (!specimen) {
      throw new Error('[RF023] Espécime canônico não encontrado no MongoDB');
    }

    await this.appendSpecimenProjection(
      {
        ...specimen,
        parentSpecimenId: input.parentSampleId || specimen.parentSpecimenId || specimen.parentSampleId || null,
      },
      session
    );

    if (input.parentSampleId) {
      await this.graphProjectionService.appendLineageEvent(
        this.db,
        {
          specimenId,
          parentSpecimenId: String(input.parentSampleId),
          sourceService: 'mongo-lineage-repository',
        },
        session ? { session } : {}
      );
    }

    return {
      specimenId,
      parentId: input.parentSampleId || null,
      relationshipType: input.relationshipType || 'TOPOLOGICAL_PARENT',
      queued: true,
    };
  }

  async compensateCustodyEvent() {
    // RF023 v2 no longer writes Neo4j before Mongo. The outbox row is enlisted
    // in the same Mongo transaction, so rollback removes both domain mutation
    // and projection event atomically; there is nothing to compensate.
    return { compensated: false, reason: 'transactional_outbox_requires_no_compensation' };
  }
}

module.exports = MongoLineageRepository;
