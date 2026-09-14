const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const { getCollection } = require('../../../utils/collectionResolver');
const { GraphProjectionService } = require('../../../services/graphProjection.service');
const ConsentGovernanceV2Repository = require('./ConsentGovernanceV2Repository');

class MongoLineageRepository {
  /**
   * RF023 v2: MongoDB is the operational authority. Neo4j is updated only
   * by the transactional graph outbox and is never consulted as an
   * authorization source for a domain write.
   *
   * @param {import('mongodb').Db} db
   * @param {{ graphProjectionService?: GraphProjectionService, consentRepository?: ConsentGovernanceV2Repository }} [options]
   */
  constructor(db, options = {}) {
    this.db = db;
    this.graphProjectionService = options.graphProjectionService || new GraphProjectionService();
    this.consentRepository = options.consentRepository || new ConsentGovernanceV2Repository(db, {
      graphProjectionService: this.graphProjectionService
    });
  }

  ensureDb() {
    if (!this.db || typeof this.db.collection !== 'function') {
      throw new Error('[RF023] MongoDB obrigatório para linhagem canônica');
    }
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
    this.ensureDb();
    const samples = await getCollection(this.db, 'samples');
    const normalized = this.toObjectId(specimenId);
    return samples.findOne({
      $or: [
        { _id: normalized },
        { specimenId: String(specimenId) }
      ]
    }, { session });
  }

  async findActiveConsent(participantId, session) {
    this.ensureDb();
    return this.consentRepository.findActiveConsent(participantId, session);
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

    const participantId = specimen.participantId || null;
    if (!participantId) {
      throw new Error('[RF023] Espécime sem participantId para decisão de consentimento');
    }

    const authorization = await this.consentRepository.authorize({
      participantId,
      permissionCode: input.permissionCode || null,
      purposeCode: input.purposeCode || null,
      evaluatedAt: input.happenedAt || new Date()
    }, session);

    if (authorization.decision === 'deny') {
      throw new Error('[RF023] Operação negada pela governança de consentimento v2');
    }
    if (authorization.decision === 'review_required') {
      throw new Error('[RF023] Operação requer revisão de consentimento/finalidade');
    }

    return true;
  }

  async appendSpecimenProjection(specimen, session) {
    if (!specimen) return null;
    return this.graphProjectionService.appendSpecimenEvent(
      this.db,
      {
        specimenId: String(specimen.specimenId || specimen._id),
        participantId: specimen.participantId || null,
        parentSpecimenIds: Array.isArray(specimen.parentSpecimenIds) ? specimen.parentSpecimenIds : [],
        barcode: specimen.barcode || null,
        specimenStatus: specimen.specimenStatus || null,
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
        specimenId: String(specimen.specimenId || specimenId),
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
    if (!session) {
      throw new Error('[RF023] Linhagem e outbox devem compartilhar a transação MongoDB');
    }

    const specimen = await this.findSpecimen(specimenId, session);
    if (!specimen) {
      throw new Error('[RF023] Espécime canônico não encontrado no MongoDB');
    }

    const parentSpecimenIds = Array.isArray(input.parentSpecimenIds)
      ? input.parentSpecimenIds.map(String).filter(Boolean)
      : Array.isArray(specimen.parentSpecimenIds)
        ? specimen.parentSpecimenIds.map(String).filter(Boolean)
        : [];

    await this.appendSpecimenProjection({ ...specimen, parentSpecimenIds }, session);

    for (const parentSpecimenId of parentSpecimenIds) {
      await this.graphProjectionService.appendLineageEvent(
        this.db,
        {
          specimenId: String(specimen.specimenId || specimenId),
          parentSpecimenId,
          sourceService: 'mongo-lineage-repository',
        },
        { session }
      );
    }

    return {
      specimenId: String(specimen.specimenId || specimenId),
      parentSpecimenIds,
      relationshipType: input.relationshipType || 'DERIVED_FROM',
      queued: true,
    };
  }

  async compensateCustodyEvent() {
    return { compensated: false, reason: 'transactional_outbox_requires_no_compensation' };
  }
}

module.exports = MongoLineageRepository;
