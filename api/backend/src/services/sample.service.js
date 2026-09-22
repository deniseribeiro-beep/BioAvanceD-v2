const { SampleModel, BLOCKED_SPECIMEN_STATUSES } = require('../models/Sample');
const SampleMovementModel = require('../models/SampleMovement');
const logger = require('../utils/logger');
const { validateParticipantId } = require('../utils/patientAnonymization');
const { generateUniqueBarcode } = require('../utils/barcodeGenerator');
const {
  generateIndustrialBarcodeArtifacts,
  parseScannedBarcode
} = require('../utils/barcodeSymbology');
const { generateUniqueSpecimenId } = require('../utils/specimenIdGenerator');
const { appendMovementWithHashChain } = require('../utils/sampleMovementLedger');
const { getCollection } = require('../utils/collectionResolver');
const { withMongoTransaction } = require('../utils/mongoTransaction');
const rcsAssessmentService = require('./rcs-assessment.service');
const qualityDomain = require('./quality-domain.service');
const specimenPreanalyticsService = require('./specimen-preanalytics.service');
const quarantineActionService = require('./quarantine-action.service');
const { applyOrganizationScopeFilter } = require('./rbac-assignment.service');
const participantIdentityService = require('./participantIdentity.service');
const AllocateSampleUseCase = require('../core/use-cases/AllocateSampleUseCase');
const MongoStorageRepository = require('../infrastructure/persistence/mongo/MongoStorageRepository');
const MongoAuditRepository = require('../infrastructure/persistence/mongo/MongoAuditRepository');
const MongoLineageRepository = require('../infrastructure/persistence/mongo/MongoLineageRepository');
const { ObjectId } = require('mongodb');

const { CRITICAL_SENSOR_STATUSES, isEquipmentBlocked } = require('../models/equipmentStatus');

const LOCATION_REQUIRED_MESSAGE = 'Localização física obrigatória para cadastro de amostra';
// #470: imports the shared equipment-readiness constants (#774) — the
// equipment-readiness half of RF004's gate, missing here until now.

/**
 * Every caller (sample.routes.js) passes an already-cast ObjectId as
 * `specimenId` — but that field on Sample is a separate, server-generated
 * string (see specimenIdGenerator.js), so a bare `{ specimenId }` query never
 * matched it. Looks up by _id first (the real intent), falling back to the
 * specimenId field for any caller that does pass the string form.
 */
async function findSampleByAnyId(samplesCollection, id) {
  if (id instanceof ObjectId || (typeof id === 'string' && ObjectId.isValid(id) && String(id).length === 24)) {
    const sample = await samplesCollection.findOne({ _id: new ObjectId(id) });
    if (sample) return sample;
  }
  return samplesCollection.findOne({ specimenId: id });
}

function createSampleValidationError(message, statusCode = 422) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/**
 * #462: legacy `locationID` input is replaced by a `boxId` (StorageBox
 * ObjectId) + `positionCode` pair — the canonical way a specimen's physical
 * placement is expressed post-migration (docs/architecture/
 * legacy-location-migration-mapping.md).
 */
function normalizeRequiredStorageBoxAssignment(rawBoxId, rawPositionCode) {
  if (rawBoxId === undefined || rawBoxId === null || rawBoxId === '') {
    throw createSampleValidationError(LOCATION_REQUIRED_MESSAGE, 400);
  }

  const boxId = typeof rawBoxId === 'string' ? rawBoxId.trim() : String(rawBoxId);
  if (!ObjectId.isValid(boxId)) {
    throw createSampleValidationError(`${LOCATION_REQUIRED_MESSAGE}: boxId deve ser um identificador válido`);
  }

  const positionCode = typeof rawPositionCode === 'string' ? rawPositionCode.trim() : rawPositionCode;
  if (!positionCode || typeof positionCode !== 'string') {
    throw createSampleValidationError(`${LOCATION_REQUIRED_MESSAGE}: positionCode é obrigatório`);
  }

  return { boxId: new ObjectId(boxId), positionCode };
}

/**
 * #462: walks the StorageContainer chain up from a StorageBox's `parent_id`
 * (RACK, optionally through a DRAWER) to SHELF then FREEZER — the same
 * hierarchy the #461 backfill script materializes. Best-effort: a box with a
 * broken/incomplete chain returns whichever levels resolved, `null` above
 * that.
 */
async function resolveStorageHierarchyForBox(db, box) {
  const storageContainersCollection = db.collection('storageContainers');

  let rack = box.parent_id ? await storageContainersCollection.findOne({ _id: box.parent_id }) : null;
  if (rack && rack.containerType === 'DRAWER') {
    rack = rack.parent_id ? await storageContainersCollection.findOne({ _id: rack.parent_id }) : null;
  }

  const shelf = rack?.parent_id ? await storageContainersCollection.findOne({ _id: rack.parent_id }) : null;
  const freezer = shelf?.parent_id ? await storageContainersCollection.findOne({ _id: shelf.parent_id }) : null;

  return { rack, shelf, freezer };
}

function buildIdVariants(...ids) {
  const variants = [];
  const seen = new Set();
  const add = (value) => {
    if (value === undefined || value === null || value === '') return;
    const key = `${typeof value}:${String(value)}`;
    if (!seen.has(key)) {
      seen.add(key);
      variants.push(value);
    }
  };

  for (const id of ids) {
    if (id === undefined || id === null || id === '') continue;
    add(id);
    add(String(id));

    const numeric = Number(id);
    if (Number.isFinite(numeric)) {
      add(numeric);
    }
  }

  return variants;
}

function isOperationalSensor(sensor) {
  const status = String(sensor?.status || sensor?.maintenanceStatus || sensor?.operationalStatus || '').trim().toLowerCase();
  return !status || !CRITICAL_SENSOR_STATUSES.includes(status);
}

/**
 * Service de Amostras
 * RF004 - Cadastro de Amostra
 * RF006 - Retirada de Amostra
 * Implementa validação de ID de paciente conforme LGPD
 */
class SampleService {
  async createSample(db, sampleData, options = {}) {
    try {
      const { boxId, positionCode } = normalizeRequiredStorageBoxAssignment(sampleData.boxId, sampleData.positionCode);
      delete sampleData.locationID;

      const samplesCollection = await getCollection(db, 'samples');

      // Gera ID único para a amostra antes da validação, já que é gerado
      // pelo servidor e nunca é fornecido pelo cliente no cadastro
      if (!sampleData.specimenId) {
        sampleData.specimenId = await generateUniqueSpecimenId(db, 'samples');
        logger.info(`ID único de espécime gerado automaticamente: ${sampleData.specimenId}`);
      } else {
        const existingSpecimen = await samplesCollection.findOne({ specimenId: sampleData.specimenId });
        if (existingSpecimen) {
          throw new Error(`Já existe um espécime com o ID ${sampleData.specimenId}`);
        }
      }

      // RF004 - Validação completa
      const validation = SampleModel.validate(sampleData);
      if (!validation.isValid) {
        let validationMessage = 'Dados da amostra inválidos conforme modelo MIABIS/BioAvanceD';
        if (Array.isArray(validation.errors) && validation.errors.length > 0) {
          validationMessage = validation.errors.join(', ');
        }

        const validationError = new Error(validationMessage);
        validationError.statusCode = 422;
        throw validationError;
      }

      if (typeof sampleData.participantId !== 'string' || !/^\d{8}$/.test(sampleData.participantId)) {
        const participantIdError = new Error('participantId inválido');
        participantIdError.statusCode = 400;
        throw participantIdError;
      }

      const participantExists = await validateParticipantId(db, sampleData.participantId);
      if (!participantExists) {
        const notFoundError = new Error(`participantId ${sampleData.participantId} não encontrado. Verifique se o ID está correto.`);
        notFoundError.statusCode = 404;
        throw notFoundError;
      }

      // RF004 - Validação de quantidade
      if (sampleData.quantity === undefined || sampleData.quantity === null || typeof sampleData.quantity !== 'number' || sampleData.quantity <= 0) {
        throw new Error('Quantidade deve ser um número maior que zero (µL)');
      }

      // RF004 AC#3 - vínculo com estudo, protocolo e coleção, quando aplicável:
      // se o cliente informar studyId/protocolId/collectionId, cada um deve
      // resolver a um documento real já cadastrado (não texto livre arbitrário).
      if (sampleData.studyId !== undefined && sampleData.studyId !== null && sampleData.studyId !== '') {
        const study = await db.collection('studies').findOne({ studyId: String(sampleData.studyId) });
        if (!study) {
          throw createSampleValidationError(`studyId ${sampleData.studyId} não encontrado`, 404);
        }
        // RF021 AC#5 (#591): existence alone isn't enough — a Sample can't
        // be registered against a study that isn't active.
        if (study.studyStatus !== 'active') {
          throw createSampleValidationError(`Estudo ${sampleData.studyId} não está ativo (status: ${study.studyStatus})`, 422);
        }
      }

      if (sampleData.protocolId !== undefined && sampleData.protocolId !== null && sampleData.protocolId !== '') {
        const protocol = await db.collection('protocols').findOne({ protocolId: String(sampleData.protocolId) });
        if (!protocol) {
          throw createSampleValidationError(`protocolId ${sampleData.protocolId} não encontrado`, 404);
        }
        // RF021 AC#5 (#591): same status gate as study — a Sample can't be
        // registered against a protocol that isn't approved (draft/retired
        // block it).
        if (protocol.approvalStatus !== 'approved') {
          throw createSampleValidationError(`Protocolo ${sampleData.protocolId} não está aprovado (status: ${protocol.approvalStatus})`, 422);
        }
      }

      if (sampleData.collectionId !== undefined && sampleData.collectionId !== null && sampleData.collectionId !== '') {
        const collectionDoc = await db.collection('collections').findOne({ collectionId: String(sampleData.collectionId) });
        if (!collectionDoc) {
          throw createSampleValidationError(`collectionId ${sampleData.collectionId} não encontrado`, 404);
        }
      }

      // ELM-0128 - collectionSite (Reference(Organization)): quando informado,
      // deve resolver a uma Organization real já cadastrada.
      if (sampleData.collectionSite !== undefined && sampleData.collectionSite !== null && sampleData.collectionSite !== '') {
        const organization = await db.collection('organizations').findOne({ organizationId: String(sampleData.collectionSite) });
        if (!organization) {
          throw createSampleValidationError(`collectionSite ${sampleData.collectionSite} não encontrado`, 404);
        }
      }

      const storageBoxesCollection = db.collection('storageBoxes');
      const box = await storageBoxesCollection.findOne({ _id: boxId });
      if (!box) {
        throw createSampleValidationError(`${LOCATION_REQUIRED_MESSAGE}: boxId inválido ou não cadastrado`);
      }

      const { rack, shelf, freezer } = await resolveStorageHierarchyForBox(db, box);
      if (!freezer) {
        throw createSampleValidationError(`${LOCATION_REQUIRED_MESSAGE}: hierarquia de armazenamento incompleta para a caixa informada`);
      }

      const equipmentCollection = db.collection('equipment');
      const equipment = await equipmentCollection.findOne({
        equipmentID: { $in: buildIdVariants(freezer.containerID) }
      });

      if (!equipment) {
        throw createSampleValidationError('Equipamento vinculado à localização física não está cadastrado');
      }

      // #470: equipment.status must also be checked — existence alone isn't
      // readiness (mirrors intakeWizard.js's isEquipmentReadyForContainer).
      const equipmentStatus = String(equipment.status || equipment.maintenanceStatus || equipment.operationalStatus || '').trim().toLowerCase();
      if (isEquipmentBlocked(equipmentStatus)) {
        throw createSampleValidationError(`Equipamento vinculado à localização física não está operacional. Status atual: ${equipmentStatus}.`);
      }

      // #462: Sensor has no dict-02 canonical placement of its own, so the
      // operational-sensor safety gate (RF004) stays keyed at equipment
      // level (freezer.containerID === Equipment.equipmentID, per the
      // mapping doc's already-established direct join) rather than the
      // finer per-location granularity the legacy `locations` lookup used.
      const equipmentVariants = buildIdVariants(freezer.containerID);
      const sensorLocationQuery = {
        $or: [
          { locationId: { $in: equipmentVariants } },
          { locationID: { $in: equipmentVariants } }
        ]
      };
      const sensorsCollection = db.collection('sensors');
      const operationalSensor = await sensorsCollection.findOne(sensorLocationQuery);

      if (!operationalSensor || !isOperationalSensor(operationalSensor)) {
        const statusValue = String(operationalSensor?.status || operationalSensor?.maintenanceStatus || operationalSensor?.operationalStatus || '').trim();
        const statusMessage = statusValue
          ? ` Sensor atual está em status ${statusValue}.`
          : '';
        throw createSampleValidationError(`Localização física sem sensor operacional associado.${statusMessage}`);
      }

      // O identificador físico do tubo é textual e sua simbologia canônica é
      // Data Matrix. Valores numéricos históricos não são convertidos nem
      // preservados como compatibilidade.
      if (sampleData.barcode === undefined || sampleData.barcode === null || sampleData.barcode === '') {
        sampleData.barcode = await generateUniqueBarcode(db);
        logger.info(`Identificador Data Matrix gerado automaticamente: ${sampleData.barcode}`);
      } else {
        if (typeof sampleData.barcode !== 'string') {
          throw createSampleValidationError('barcode deve ser uma string canônica para identificação Data Matrix');
        }
        sampleData.barcode = sampleData.barcode.trim();
        if (!sampleData.barcode) {
          sampleData.barcode = await generateUniqueBarcode(db);
          logger.info(`Identificador Data Matrix gerado automaticamente: ${sampleData.barcode}`);
        } else {
          const existingSample = await samplesCollection.findOne({ barcode: sampleData.barcode });
          if (existingSample) {
            throw new Error(`Já existe uma amostra com o código de barras ${sampleData.barcode}`);
          }
        }
      }

      // #492: live registration didn't compute RCS server-side at all —
      // mirrors import.service.js's CSV/XLSX branch (#383), which is the
      // only other place `sprec` -> RCS-GOV field mapping already exists.
      if (sampleData.sprec && typeof sampleData.sprec === 'object' && Object.keys(sampleData.sprec).length > 0) {
        const canonicalQualityAssessment = qualityDomain.resolveMethodologicalQuality(sampleData);
        sampleData.modelVersion = canonicalQualityAssessment.model_version;
        sampleData.matrixType = canonicalQualityAssessment.matrix_type;
        sampleData.governanceStatus = canonicalQualityAssessment.governance_status;
        sampleData.governanceFailureReasons = canonicalQualityAssessment.governance_failure_reasons || [];
        sampleData.governanceRuleCodes = canonicalQualityAssessment.governance_rule_codes || [];
        sampleData.rcsScore = canonicalQualityAssessment.rcs_score;
        sampleData.scoreBasedGrade = canonicalQualityAssessment.score_based_grade;
        sampleData.finalGrade = canonicalQualityAssessment.final_grade || '';
        sampleData.gradeRoute = canonicalQualityAssessment.grade_route;
        sampleData.axisPenalties = canonicalQualityAssessment.axis_penalties || [];
        sampleData.calculationTrace = canonicalQualityAssessment.calculation_trace || {};
        sampleData.rcsEvaluation = canonicalQualityAssessment;
      }

      const sample = SampleModel.create(sampleData);

      const result = await samplesCollection.insertOne(sample);

      const movementsCollection = await getCollection(db, 'sampleMovements');
      const createdQuantity = Number(sample.currentQuantity ?? sample.quantity ?? 0);
      const createMovementID = await SampleMovementModel.generateMovementID(db);

      try {
        await appendMovementWithHashChain(movementsCollection, SampleMovementModel.create({
          movementId: createMovementID,
          specimenId: sample.specimenId,
          barcode: sample.barcode,
          type: 'create',
          quantity: createdQuantity,
          unit: sample.unit || 'µL',
          responsible: options?.auditInfo?.userName || options?.auditInfo?.actorName || 'SYSTEM',
          destination: `storage:${boxId}:${positionCode}`,
          purpose: 'sample_birth',
          linkedProject: sample.linkedProject || null,
          observations: options?.auditInfo?.notes || null,
          userId: options?.auditInfo?.userId || null,
          userName: options?.auditInfo?.userName || null,
          userRole: options?.auditInfo?.userRole || null,
          ipAddress: options?.auditInfo?.ipAddress || null,
          userAgent: options?.auditInfo?.userAgent || null,
          previousQuantity: 0,
          newQuantity: createdQuantity
        }));
      } catch (ledgerError) {
        await samplesCollection.deleteOne({ _id: result.insertedId });
        throw new Error(`Falha ao registrar cadeia de custódia no nascimento da amostra: ${ledgerError.message || ledgerError}`);
      }

      // A amostra nasce sem snapshot físico embutido. AllocateSampleUseCase
      // persiste occupancyGrid + cadeia física canônica v2 + auditoria +
      // outbox na fronteira transacional MongoDB.
      const allocateUseCase = new AllocateSampleUseCase({
        storageRepository: new MongoStorageRepository(db),
        auditRepository: new MongoAuditRepository(db),
        lineageRepository: new MongoLineageRepository(db)
      });

      try {
        await allocateUseCase.execute({
          specimenId: result.insertedId,
          boxId: String(boxId),
          position: positionCode,
          actor: {
            userId: options?.auditInfo?.userId || null,
            userName: options?.auditInfo?.userName || options?.auditInfo?.actorName || null,
            userRole: options?.auditInfo?.userRole || null,
            ipAddress: options?.auditInfo?.ipAddress || null,
            userAgent: options?.auditInfo?.userAgent || null
          }
        });
      } catch (allocationError) {
        await samplesCollection.deleteOne({ _id: result.insertedId });
        const message = allocationError?.message || String(allocationError);
        const wrapped = new Error(`Falha ao alocar amostra na posição de armazenamento: ${message}`);
        wrapped.statusCode = message.includes('STORAGE_COLLISION') || message.includes('já está alocada') ? 409 : 422;
        throw wrapped;
      }

      const currentStoragePlacement = await new MongoStorageRepository(db)
        .findCurrentStoragePlacement(sample.specimenId);

      // #492/#502: only recorded once the sample has fully landed (ledger +
      // allocation both succeeded) — a failure here doesn't roll back
      // sample creation, mirroring import.service.js's best-effort recording
      // (#499), but not recording against a sample that itself got rolled
      // back avoids a dangling RcsAssessment with no surviving sample.
      if (sample.rcsEvaluation) {
        try {
          const assessment = await rcsAssessmentService.recordAssessment(db, sample.specimenId, sample.rcsEvaluation);
          await samplesCollection.updateOne(
            { _id: result.insertedId },
            { $set: { sealedRcsAssessmentId: assessment._id } }
          );
          sample.sealedRcsAssessmentId = assessment._id;
        } catch (assessmentError) {
          logger.error('Falha ao registrar RcsAssessment para a amostra:', assessmentError.message || assessmentError);
        }
      }

      // #524: mirrors the RcsAssessment pin above and import.service.js's
      // CSV/XLSX branch (#502) — records the canonical, referenced
      // SpecimenPreanalytics snapshot alongside the embedded sprec copy.
      // Same best-effort semantics: a failure here doesn't roll back sample
      // creation, and it isn't attempted against a sample that itself got
      // rolled back above.
      if (sample.sprec) {
        try {
          const profile = await specimenPreanalyticsService.recordProfile(db, sample.specimenId, sample.sprec);
          await samplesCollection.updateOne(
            { _id: result.insertedId },
            { $set: { sealedSpecimenPreanalyticsId: profile._id } }
          );
          sample.sealedSpecimenPreanalyticsId = profile._id;
        } catch (profileError) {
          logger.error('Falha ao registrar SpecimenPreanalytics para a amostra:', profileError.message || profileError);
        }
      }

      // Log sanitizado (apenas ID, sem dados sensíveis)
      logger.info('Amostra criada:', {
        specimenId: sample.specimenId,
        participantId: sample.participantId
      });

      return {
        _id: result.insertedId,
        ...sample,
        currentStoragePlacement
      };
    } catch (error) {
      logger.error('Erro ao criar amostra:', error.message);
      throw error;
    }
  }

  async withdrawSample(db, specimenId, withdrawalData, auditInfo = {}) {
    try {
      const samplesCollection = await getCollection(db, 'samples');
      const movementsCollection = await getCollection(db, 'sampleMovements');
      
      // O contrato operacional recebe specimenId (ou o _id interno já
      // resolvido pela rota); identificação física Data Matrix não é alias
      // de identidade do espécime.
      const sample = await findSampleByAnyId(samplesCollection, specimenId);

      if (!sample) {
        throw new Error('Amostra não encontrada');
      }

      // Validações de status (RF006 AC#4)
      const currentSpecimenStatus = SampleModel.resolveSpecimenStatus(sample);
      if (BLOCKED_SPECIMEN_STATUSES.includes(currentSpecimenStatus)) {
        throw new Error(`Amostra não está disponível para retirada (Status: ${currentSpecimenStatus})`);
      }

      // Validações MIABIS
      if (!SampleModel.validateWithdrawalType(withdrawalData.withdrawalType)) {
        throw new Error('Tipo de retirada inválido. Deve ser: Parcial ou Total');
      }

      if (!withdrawalData.withdrawalResponsible || !SampleModel.validateResponsibleName(withdrawalData.withdrawalResponsible)) {
        throw new Error('Nome do responsável deve conter nome e sobrenome');
      }

      if (!withdrawalData.linkedProject || withdrawalData.linkedProject.trim() === '') {
        throw new Error('Projeto vinculado é obrigatório');
      }

      // Calcular quantidade disponível atual
      const availableQty = sample.currentQuantity !== undefined
        ? sample.currentQuantity
        : sample.quantity;

      // #541: 'depleted' isn't in BLOCKED_SPECIMEN_STATUSES (it can't be —
      // that would also make it sticky in computeStatus and block
      // returnSample's un-deplete-on-return flow), so a Total withdrawal
      // on an already-exhausted sample isn't caught by the status gate
      // above. Without this, withdrawQty floors at 0 and the write
      // "succeeds" with nothing actually withdrawn.
      if (availableQty <= 0) {
        throw new Error(`Quantidade indisponível. Disponível: ${availableQty} ${sample.unit || 'µL'}`);
      }

      // Determinar quantidade a retirar
      let withdrawQty;
      if (withdrawalData.withdrawalType === 'Total') {
        withdrawQty = availableQty;
      } else {
        // Retirada parcial - quantidade obrigatória
        withdrawQty = parseFloat(withdrawalData.withdrawalQuantity || withdrawalData.quantity);
        if (!withdrawQty || withdrawQty <= 0) {
          throw new Error('Quantidade a retirar é obrigatória para retirada parcial');
        }
        if (withdrawQty > availableQty) {
          throw new Error(`Quantidade indisponível. Disponível: ${availableQty} ${sample.unit || 'µL'}`);
        }
      }

      // Calcular novo saldo
      const newAvailableQty = availableQty - withdrawQty;
      const totalWithdrawn = (sample.totalWithdrawn || 0) + withdrawQty;

      const specimenStatus = SampleModel.computeStatus(sample.initialQuantity || sample.quantity, newAvailableQty, currentSpecimenStatus);

      // Registrar movimentação no ledger (imutável)
      const movementID = await SampleMovementModel.generateMovementID(db);
      const movement = SampleMovementModel.create({
        movementId: movementID,
        specimenId: sample.specimenId,
        barcode: sample.barcode,
        type: 'withdraw',
        quantity: withdrawQty,
        unit: sample.unit || 'µL',
        responsible: withdrawalData.withdrawalResponsible,
        destination: withdrawalData.sampleDestination || withdrawalData.withdrawalDestination,
        purpose: withdrawalData.purpose || withdrawalData.justification,
        linkedProject: withdrawalData.linkedProject || sample.linkedProject,
        observations: withdrawalData.observations || withdrawalData.notes,
        userId: auditInfo.userId || null,
        userName: auditInfo.userName || null,
        userRole: auditInfo.userRole || null,
        ipAddress: auditInfo.ipAddress || null,
        userAgent: auditInfo.userAgent || null,
        previousQuantity: availableQty,
        newQuantity: newAvailableQty
      });

      // RF006 AC#6: ledger append + balance update must land atomically —
      // a crash between the two would desync the movement ledger from
      // currentQuantity, silently.
      await withMongoTransaction(db, async (session) => {
        await appendMovementWithHashChain(movementsCollection, movement, { session });

        const update = {
          currentQuantity: newAvailableQty,
          totalWithdrawn: totalWithdrawn,
          withdrawnAt: new Date(),
          withdrawalType: withdrawalData.withdrawalType,
          withdrawalResponsible: withdrawalData.withdrawalResponsible,
          sampleDestination: withdrawalData.sampleDestination || withdrawalData.withdrawalDestination,
          linkedProject: withdrawalData.linkedProject || sample.linkedProject,
          lastWithdrawalID: movementID,
          specimenStatus,
          updatedAt: new Date()
        };

        await samplesCollection.updateOne(
          { specimenId: sample.specimenId },
          { $set: update },
          { session }
        );
      });

      logger.info(`Retirada registrada: Sample ${sample.barcode || sample._id}, Qtd: ${withdrawQty}, Novo saldo: ${newAvailableQty}`);

      return {
        success: true,
        movementID,
        withdrawnQuantity: withdrawQty,
        remainingQuantity: newAvailableQty,
        newStatus: specimenStatus
      };
    } catch (error) {
      logger.error('Erro ao retirar amostra:', error.message);
      throw error;
    }
  }

  async getSample(db, specimenId) {
    try {
      const samplesCollection = await getCollection(db, 'samples');
      const sample = await findSampleByAnyId(samplesCollection, specimenId);
      if (!sample) return null;
      // Guarantee specimenStatus is populated even for legacy documents
      // written before the field existed (#415 — frontend readers can then
      // drop their lifecycleStatus fallback).
      sample.specimenStatus = SampleModel.resolveSpecimenStatus(sample);
      return sample;
    } catch (error) {
      logger.error('Erro ao buscar amostra:', error.message);
      throw error;
    }
  }

  async listSamples(db, filters = {}) {
    try {
      const samplesCollection = await getCollection(db, 'samples');
      const query = {};

      if (filters.participantId) {
        query.participantId = filters.participantId;
      }

      if (filters.specimenStatus) {
        query.specimenStatus = filters.specimenStatus;
      }

      if (filters.sampleType) {
        query.sampleType = filters.sampleType;
      }

      // #340 (RF003 AC#3): org-scoped caller sees only samples whose
      // collectionSite is one of their scoped organizations. No-op for a
      // 'global' (Administrador) scope. Caller must resolve+attach
      // organizationScope via rbac.js's requireOrganizationScope first.
      if (filters.organizationScope) {
        applyOrganizationScopeFilter(query, filters.organizationScope, 'collectionSite');
      }

      const limit = filters.limit || 50;
      const skip = filters.skip || 0;

      // #647 (same shape as #645's sensor-list bug): no sort meant Mongo's
      // natural (insertion) order decided which samples landed on the
      // default 50-item page -- once the collection passed that default
      // (e2e fixtures accumulate across sessions, see docker-workflow's
      // local-env), a freshly created sample silently never appeared in
      // the list, so SampleDetailsPage's client-side find-by-id came up
      // empty for a sample that had just been created. Newest-first makes
      // a just-created record always land on page 1 regardless of backlog.
      const samples = await samplesCollection
        .find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .toArray();
      // See getSample's comment — same specimenStatus guarantee for the list view.
      samples.forEach((sample) => {
        sample.specimenStatus = SampleModel.resolveSpecimenStatus(sample);
      });

      const total = await samplesCollection.countDocuments(query);

      return { samples, total, limit, skip };
    } catch (error) {
      logger.error('Erro ao listar amostras:', error.message);
      throw error;
    }
  }

  async updateSample(db, specimenId, updateData) {
    try {
      const samplesCollection = await getCollection(db, 'samples');
      const existing = await findSampleByAnyId(samplesCollection, specimenId);
      if (!existing) {
        return null;
      }

      const nextAvailable = updateData.currentQuantity !== undefined
        ? updateData.currentQuantity
        : existing.currentQuantity ?? existing.quantity;
      const nextOriginal = updateData.initialQuantity !== undefined
        ? updateData.initialQuantity
        : existing.initialQuantity ?? existing.quantity;

      const currentSpecimenStatus = updateData.specimenStatus || SampleModel.resolveSpecimenStatus(existing);
      const specimenStatus = SampleModel.computeStatus(
        nextOriginal,
        nextAvailable,
        currentSpecimenStatus
      );

      let normalizedBarcodeUpdate;
      if (Object.prototype.hasOwnProperty.call(updateData, 'barcode')) {
        if (typeof updateData.barcode !== 'string') {
          throw createSampleValidationError('barcode deve ser uma string canônica para identificação Data Matrix');
        }

        normalizedBarcodeUpdate = updateData.barcode.trim();
        if (!normalizedBarcodeUpdate) {
          throw createSampleValidationError('barcode não pode ser vazio na atualização');
        }

        if (normalizedBarcodeUpdate !== existing.barcode) {
          const duplicateBarcode = await samplesCollection.findOne({ barcode: normalizedBarcodeUpdate });
          if (duplicateBarcode) {
            throw createSampleValidationError(`Já existe uma amostra com o código de barras ${normalizedBarcodeUpdate}`, 409);
          }
        }
      }

      // lifecycleStatus/availabilityStatus/quarantineStatus are retired
      // (#408), and status/currentStatus alongside them (#540) —
      // specimenStatus is the sole source of truth, so any caller still
      // sending the legacy fields on the wire is silently ignored rather
      // than persisted.
      //
      // #875: spreading the rest of updateData into $set (previously here)
      // is a denylist of only those 5 fields -- every other body key,
      // recognized or not, sailed through untouched. Use an allowlist
      // instead, derived from SampleModel.create()'s field set
      // (src/models/Sample.js:184-246), excluding identity (specimenId,
      // participantId), the 5 status fields above (already handled/
      // recomputed), and _id/createdAt/updatedAt (this service owns
      // updatedAt below). Add a field to Sample.create() and this list
      // together.
      // 'notes' is not in Sample.js's field list but is pinned writable by
      // #540's test; whether it belongs in the model is #875's dict-02
      // flag, not this change's call.
      const ALLOWED_UPDATE_FIELDS = [
        'sampleType', 'sampleOrigin', 'extractionProtocol', 'barcode',
        'registeredAt',
        'withdrawnAt', 'receivedAt', 'quantity', 'unit', 'quality',
        'modelVersion', 'matrixType', 'governanceStatus',
        'governanceFailureReasons', 'governanceRuleCodes',
        'biologicalPenalty', 'rcsScore', 'scoreBasedGrade', 'finalGrade',
        'gradeRoute', 'axisPenalties', 'calculationTrace', 'rcsEvaluation',
        'externalQualityAssessment', 'locationID', 'linkedProject',
        'collectionSite', 'sprec', 'merkleRoot', 'sealedRcsAssessmentId',
        'sealedSpecimenPreanalyticsId', 'consentTemplateId', 'clinicalData',
        'pharmacologyData', 'consentStatus', 'quarantineReason',
        'importBatchId', 'importedAt', 'importedBy', 'currentQuantity',
        'initialQuantity', 'totalWithdrawn', 'totalReturned',
        'accessionNumber', 'orderNumber', 'processingStatus',
        'protocolApplied', 'specimenCollection', 'studyId', 'protocolId',
        'collectionId', 'linkedFiles', 'notes'
      ];
      const restUpdateData = {};
      for (const key of ALLOWED_UPDATE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(updateData, key)) {
          restUpdateData[key] = key === 'barcode' ? normalizedBarcodeUpdate : updateData[key];
        }
      }

      const payload = {
        ...restUpdateData,
        specimenStatus,
        updatedAt: new Date()
      };
      
      const result = await samplesCollection.updateOne(
        { specimenId: existing.specimenId },
        { $set: payload }
      );

      if (result.matchedCount === 0) {
        return null;
      }

      return await samplesCollection.findOne({ specimenId: existing.specimenId });
    } catch (error) {
      logger.error('Erro ao atualizar amostra:', error.message);
      throw error;
    }
  }

  async deleteSample(db, specimenId) {
    try {
      const samplesCollection = await getCollection(db, 'samples');
      const result = await samplesCollection.deleteOne({ specimenId });
      return result.deletedCount > 0;
    } catch (error) {
      logger.error('Erro ao deletar amostra:', error.message);
      throw error;
    }
  }

  async getSampleByBarcode(db, barcode) {
    try {
      const samplesCollection = await getCollection(db, 'samples');
      const patientsCollection = await getCollection(db, 'patients');
      
      const parsedBarcode = parseScannedBarcode(barcode);
      const barcodeStr = parsedBarcode.normalizedValue;
      logger.info(`Buscando amostra com código de barras: "${barcodeStr}" (simbologia: ${parsedBarcode.scannerSymbology})`);
      
      if (!parsedBarcode.isValid) {
        throw createSampleValidationError('Identificador físico inválido: apenas Data Matrix canônico é suportado');
      }

      // O valor codificado é identidade física exata. Não há fallback
      // numérico, case-insensitive ou regex para dados históricos.
      const sample = await samplesCollection.findOne({ barcode: barcodeStr });
      if (sample) {
        logger.info(`Amostra encontrada por identificador Data Matrix: ${sample._id}, barcode: ${sample.barcode}`);
      }

      if (!sample) {
        // Log de debug: lista alguns códigos de barras existentes para comparação
        const sampleCount = await samplesCollection.countDocuments({});
        const sampleExamples = await samplesCollection.find({ barcode: { $exists: true, $ne: null } })
          .limit(5)
          .project({ barcode: 1, _id: 0 })
          .toArray();
        logger.warn(`Amostra não encontrada com código de barras: "${barcodeStr}". Total de amostras: ${sampleCount}. Exemplos de barcodes: ${JSON.stringify(sampleExamples.map(s => s.barcode))}`);
        return { sample: null, participant: null };
      }
      let participant = null;
      if (sample.participantId) {
        participant = await patientsCollection.findOne({ participantId: sample.participantId });
        if (participant) {
          // RF005/RNF007 (#561/#564/#574): patientName resolved via
          // ParticipantIdentity instead of read directly off the Patient
          // document. decryptIdentity falls back to the ciphertext sibling
          // once the plaintext field is dropped (#566).
          const identityCollection = await getCollection(db, 'participantIdentities');
          const rawIdentity = await identityCollection.findOne({ participantId: sample.participantId });
          const identity = rawIdentity ? participantIdentityService.decryptIdentity(rawIdentity) : null;
          const anonymizeName = (name) => {
            if (!name) return '***';
            const parts = name.trim().split(' ');
            if (parts.length === 1) return parts[0].charAt(0) + '***';
            return parts[0].charAt(0) + '. ' + parts[parts.length - 1].charAt(0) + '.';
          };
          participant = {
            participantId: participant.participantId,
            patientName: anonymizeName(identity?.patientName),
            recordNumber: participant.recordNumber
          };
        }
      }

      // See getSample's comment — same specimenStatus guarantee for barcode lookups.
      sample.specimenStatus = SampleModel.resolveSpecimenStatus(sample);

      return { sample, participant };
    } catch (error) {
      logger.error('Erro ao buscar amostra por código de barras:', error.message);
      throw error;
    }
  }

  async getSampleResults(db, specimenId) {
    try {
      const resultsCollection = db.collection('results');
      const sample = await this.getSample(db, specimenId);
      
      if (!sample) {
        throw new Error('Amostra não encontrada');
      }

      const results = await resultsCollection.find({ specimenId: sample.specimenId }).toArray();
      return results;
    } catch (error) {
      logger.error('Erro ao buscar arquivos de analise da amostra:', error.message);
      throw error;
    }
  }

  async getBarcodeIndustrialAssets(barcodeValue, options = {}) {
    const parsedBarcode = parseScannedBarcode(barcodeValue);
    if (!parsedBarcode.isValid) {
      throw new Error('Código de barras inválido para renderização industrial');
    }

    return generateIndustrialBarcodeArtifacts(parsedBarcode.normalizedValue, {
      includePayload: options.includePayload !== false
    });
  }

  async returnSample(db, specimenId, returnData, auditInfo = {}) {
    try {
      const samplesCollection = await getCollection(db, 'samples');
      const movementsCollection = await getCollection(db, 'sampleMovements');
      
      // Devolução opera por identidade canônica do espécime. O Data Matrix
      // é resolvido apenas na fronteira própria de identificação física.
      const sample = await findSampleByAnyId(samplesCollection, specimenId);

      if (!sample) {
        throw new Error('Amostra não encontrada');
      }

      // Validações de status (RF006 AC#4)
      const currentSpecimenStatus = SampleModel.resolveSpecimenStatus(sample);
      if (BLOCKED_SPECIMEN_STATUSES.includes(currentSpecimenStatus)) {
        throw new Error(`Amostra não está disponível para devolução (Status: ${currentSpecimenStatus})`);
      }

      // Validação: só pode devolver se houver quantidade retirada
      const totalWithdrawn = sample.totalWithdrawn || 0;
      const totalReturned = sample.totalReturned || 0;
      const pendingReturn = totalWithdrawn - totalReturned;

      if (pendingReturn <= 0) {
        throw new Error('Não há quantidade pendente de devolução para esta amostra');
      }

      // Validação do responsável
      if (!returnData.returnResponsible || returnData.returnResponsible.trim().length < 3) {
        throw new Error('Responsável pela devolução é obrigatório');
      }

      // Validação da condição (normaliza aliases PT-BR antes de validar)
      const normalizedCondition = SampleMovementModel.normalizeReturnCondition(returnData.condition);
      const validConditions = Object.values(SampleMovementModel.RETURN_CONDITIONS);
      if (!returnData.condition || !validConditions.includes(normalizedCondition)) {
        throw new Error('Condição da amostra é obrigatória (Íntegra, Parcialmente comprometida ou Inutilizada)');
      }
      returnData.condition = normalizedCondition;

      // Observações obrigatórias se condição não for íntegra
      if (returnData.condition !== SampleMovementModel.RETURN_CONDITIONS.INTACT && (!returnData.observations || returnData.observations.trim() === '')) {
        throw new Error('Observações são obrigatórias quando a condição não é Íntegra');
      }

      // Determinar quantidade a devolver
      let returnQty;
      if (returnData.returnType === 'Total') {
        returnQty = pendingReturn;
      } else {
        returnQty = parseFloat(returnData.returnQuantity || returnData.quantity);
        if (!returnQty || returnQty <= 0) {
          throw new Error('Quantidade a devolver é obrigatória');
        }
        if (returnQty > pendingReturn) {
          throw new Error(`Quantidade excede o pendente de devolução. Pendente: ${pendingReturn} ${sample.unit || 'µL'}`);
        }
      }

      // Calcular novos saldos
      let newAvailableQty = (sample.currentQuantity || 0);
      let newTotalReturned = totalReturned + returnQty;
      
      // Se condição é inutilizada, a quantidade não retorna ao estoque
      if (returnData.condition !== SampleMovementModel.RETURN_CONDITIONS.UNUSABLE) {
        newAvailableQty += returnQty;
      }

      const specimenStatus = SampleModel.computeStatus(sample.initialQuantity || sample.quantity, newAvailableQty, currentSpecimenStatus);

      // Registrar movimentação no ledger (imutável)
      const movementID = await SampleMovementModel.generateMovementID(db);
      const movement = SampleMovementModel.create({
        movementId: movementID,
        specimenId: sample.specimenId,
        barcode: sample.barcode,
        type: 'return',
        quantity: returnQty,
        unit: sample.unit || 'µL',
        responsible: returnData.returnResponsible,
        condition: returnData.condition,
        linkedProject: returnData.linkedProject || sample.linkedProject,
        observations: returnData.observations || returnData.notes,
        relatedWithdrawalId: sample.lastWithdrawalID || null,
        userId: auditInfo.userId || null,
        userName: auditInfo.userName || null,
        userRole: auditInfo.userRole || null,
        ipAddress: auditInfo.ipAddress || null,
        userAgent: auditInfo.userAgent || null,
        previousQuantity: sample.currentQuantity || 0,
        newQuantity: newAvailableQty
      });

      // RF006 AC#6: ledger append + balance update must land atomically —
      // see the same note in withdrawSample.
      await withMongoTransaction(db, async (session) => {
        await appendMovementWithHashChain(movementsCollection, movement, { session });

        const update = {
          currentQuantity: newAvailableQty,
          totalReturned: newTotalReturned,
          specimenStatus,
          updatedAt: new Date()
        };

        if (specimenStatus === 'available') {
          update.withdrawnAt = null;
          update.withdrawalType = null;
          update.withdrawalResponsible = null;
          update.sampleDestination = null;
        }

        await samplesCollection.updateOne(
          { specimenId: sample.specimenId },
          { $set: update },
          { session }
        );
      });

      logger.info(`Devolução registrada: Sample ${sample.barcode || sample._id}, Qtd: ${returnQty}, Condição: ${returnData.condition}, Novo saldo: ${newAvailableQty}`);

      return { 
        success: true, 
        movementID,
        returnedQuantity: returnQty,
        condition: returnData.condition,
        newAvailableQuantity: newAvailableQty,
        newStatus: specimenStatus
      };
    } catch (error) {
      logger.error('Erro ao retornar amostra:', error.message);
      throw error;
    }
  }

  /**
   * Obtém histórico de movimentações de uma amostra
   */
  async getSampleMovements(db, specimenId) {
    try {
      const samplesCollection = await getCollection(db, 'samples');
      const movementsCollection = await getCollection(db, 'sampleMovements');

      // Movements are keyed by canonical specimenId. The physical
      // identifier is retained as event metadata, not as an alternate
      // identity key for custody-history retrieval.
      const sample = await findSampleByAnyId(samplesCollection, specimenId);
      const specimenIdStr = sample
        ? sample.specimenId
        : (specimenId.toString ? specimenId.toString() : specimenId);

      const movements = await movementsCollection
        .find({ specimenId: specimenIdStr })
        .sort({ timestamp: -1 })
        .toArray();

      return movements;
    } catch (error) {
      logger.error('Erro ao buscar movimentações:', error.message);
      throw error;
    }
  }

  /**
   * Obtém o histórico de snapshots RCS versionados referenciados pela amostra
   * (#383 — dict-07/dict-08: RCS certificado como entidade separada e
   * referenciada, não duplicada em Sample). Mais recente primeiro.
   */
  async getRcsAssessments(db, specimenId) {
    try {
      const samplesCollection = await getCollection(db, 'samples');
      const sample = await findSampleByAnyId(samplesCollection, specimenId);
      const specimenIdStr = sample
        ? sample.specimenId
        : (specimenId.toString ? specimenId.toString() : specimenId);

      return await rcsAssessmentService.getAssessmentsForSpecimen(db, specimenIdStr);
    } catch (error) {
      logger.error('Erro ao buscar snapshots RCS:', error.message);
      throw error;
    }
  }

  /**
   * Obtém o histórico de snapshots SPREC (SpecimenPreanalytics) versionados
   * referenciados pela amostra (#388 — dict-07/dict-08: SPREC como entidade
   * separada e referenciada, não duplicada em Sample). Mais recente primeiro.
   */
  async getSprecProfiles(db, specimenId) {
    try {
      const samplesCollection = await getCollection(db, 'samples');
      const sample = await findSampleByAnyId(samplesCollection, specimenId);
      const specimenIdStr = sample
        ? sample.specimenId
        : (specimenId.toString ? specimenId.toString() : specimenId);

      return await specimenPreanalyticsService.getProfilesForSpecimen(db, specimenIdStr);
    } catch (error) {
      logger.error('Erro ao buscar snapshots SPREC:', error.message);
      throw error;
    }
  }

  /**
   * Obtém o histórico de QuarantineActions referenciadas pela amostra
   * (#406 — dict-02 P1X-0113–0119: quarentena como entidade separada e
   * referenciada, não campos embutidos em Sample). Mais recente primeiro,
   * mesmo padrão de #383/#388.
   */
  async getQuarantineActions(db, specimenId) {
    try {
      const samplesCollection = await getCollection(db, 'samples');
      const sample = await findSampleByAnyId(samplesCollection, specimenId);
      const specimenIdStr = sample
        ? sample.specimenId
        : (specimenId.toString ? specimenId.toString() : specimenId);

      return await quarantineActionService.getActionsForSpecimen(db, specimenIdStr);
    } catch (error) {
      logger.error('Erro ao buscar ações de quarentena:', error.message);
      throw error;
    }
  }

  /**
   * Garante que amostras com status QUARANTINED não sejam retornadas para pesquisadores.
   */
  async findAvailableSamplesForResearch(db, query = {}) {
    const samplesCollection = await getCollection(db, 'samples');
    // Garante que só retorna amostras AVAILABLE
    const finalQuery = { ...query, specimenStatus: 'available' };
    return samplesCollection.find(finalQuery).toArray();
  }
}

module.exports = new SampleService();
