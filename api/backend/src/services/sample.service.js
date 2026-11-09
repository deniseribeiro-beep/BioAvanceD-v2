const { SampleModel, BLOCKED_SPECIMEN_STATUSES, findRcsDerivedFields, rcsDerivedWriteDetails } = require('../models/Sample');
const SampleMovementModel = require('../models/SampleMovement');
const collectionGovernanceService = require('./collectionGovernance.service');
const logger = require('../utils/logger');
const { validateParticipantId } = require('../utils/patientAnonymization');
const { generateUniqueBarcode } = require('../utils/barcodeGenerator');
const {
  generateBarcodeSymbologies,
  generateIndustrialBarcodeArtifacts,
  parseScannedBarcode
} = require('../utils/barcodeSymbology');
const { generateUniqueSpecimenId } = require('../utils/sampleIDGenerator');
const { appendMovementWithHashChain } = require('../utils/sampleMovementLedger');
const { getCollection } = require('../utils/collectionResolver');
const crypto = require('crypto');
const { withMongoTransaction, withTransactionWhereSupported, isTransientTransactionError } = require('../utils/mongoTransaction');
const rcsAssessmentService = require('./rcs-assessment.service');
const qualityDomain = require('./quality-domain.service');
const specimenPreanalyticsService = require('./specimen-preanalytics.service');
const quarantineActionService = require('./quarantine-action.service');
const legalHoldService = require('./legalHold.service');
const operationalStateDecisionService = require('./operationalStateDecision.service');
const { applySampleOrganizationScope } = require('./sampleTenancy.service');
const participantIdentityService = require('./participantIdentity.service');
const { issueSpecimenLabel } = require('./specimenLabel.service');
const LabelIdentifierModel = require('../models/LabelIdentifier');
const { withoutLegacyBarcode, assertLegacyBarcodeWritable } = require('../utils/sampleBarcodeWindow');
const AllocateSampleUseCase = require('../core/use-cases/AllocateSampleUseCase');
const MongoStorageRepository = require('../infrastructure/persistence/mongo/MongoStorageRepository');
const MongoAuditRepository = require('../infrastructure/persistence/mongo/MongoAuditRepository');
const LineageRepository = require('../infrastructure/database/neo4j/LineageRepository');
const { recordLineageProjection, recordSpecimenProjection, GraphProjectionService } = require('./graphProjection.service');
const { ObjectId } = require('mongodb');

const { CRITICAL_SENSOR_STATUSES, isEquipmentBlocked } = require('../models/equipmentStatus');

const LOCATION_REQUIRED_MESSAGE = 'Localização física obrigatória para cadastro de amostra';
// #470: imports the shared equipment-readiness constants (#774) — the
// equipment-readiness half of RF004's gate, missing here until now.

// The route id may be the Mongo _id or the server-generated specimenId
// string (see sampleIDGenerator.js). #1216 moved this lookup to a util so
// the sample-file controller and the storage routes resolve it the same way.
const { findSampleByAnyId } = require('../utils/sampleLookup');

function createSampleValidationError(message, statusCode = 422) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

// RF006 AC3 / RF026 AC7: a status write the generic update refuses (a
// quantityStatus, `closed`, a v1.3.0 value, a change out of closed). The
// code lets the route answer 422 for exactly these.
const STATUS_WRITE_REFUSED = 'SPECIMEN_STATUS_WRITE_REFUSED';
function createStatusWriteRefusal(message) {
  const error = createSampleValidationError(message, 422);
  error.code = STATUS_WRITE_REFUSED;
  return error;
}

// RNF018 AC4: a write to the RCS result is refused; only certification sets it.
function createRcsDerivedWriteRefusal(fields) {
  const details = rcsDerivedWriteDetails(fields);
  const error = createSampleValidationError(details.join(', '), 422);
  error.code = 'RCS_DERIVED_WRITE_REFUSED';
  error.fields = fields;
  error.details = details;
  return error;
}

// RNF018 AC1 (#1525): the backend twin of SampleDetailsPage's quantity check.
// A quantity field the edit names is a finite number at or above zero, or
// null; anything else is refused before anything is written.
const QUANTITY_UPDATE_FIELDS = ['quantity', 'currentQuantity', 'initialQuantity'];
function findInvalidQuantityFields(updateData) {
  return QUANTITY_UPDATE_FIELDS.filter((field) => {
    if (!Object.prototype.hasOwnProperty.call(updateData, field)) return false;
    const value = updateData[field];
    if (value === null) return false;
    return !(typeof value === 'number' && Number.isFinite(value) && value >= 0);
  });
}
function createInvalidQuantityRefusal(fields) {
  const details = fields.map((field) => `${field} deve ser um número maior ou igual a zero`);
  const error = createSampleValidationError(details.join(', '), 422);
  error.code = 'INVALID_QUANTITY';
  error.fields = fields;
  error.details = details;
  return error;
}

// RNF007 AC4 (#1463): a caller-supplied code carries no personal data. The
// refusal names the kind, never the value, as the ingestion path does.
const BARCODE_PERSONAL_DATA = 'BARCODE_PERSONAL_DATA';
function createBarcodePersonalDataRefusal(what) {
  const error = createSampleValidationError(`O código de barras não pode conter ${what} (RNF007 AC4)`, 422);
  error.code = BARCODE_PERSONAL_DATA;
  error.details = [error.message];
  return error;
}

const NAME_PARTICLES = new Set(['das', 'dos']);
function foldLetters(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
// A name part (3+ letters, not a particle) that is a whole letter run of
// the code, or the whole name or two adjacent parts run together.
function containsPersonName(code, name) {
  const foldedName = foldLetters(name);
  const parts = foldedName.split(/[^a-z]+/).filter((part) => part.length >= 3 && !NAME_PARTICLES.has(part));
  if (parts.length === 0) return false;
  const foldedCode = foldLetters(code);
  const runs = new Set(foldedCode.split(/[^a-z]+/).filter(Boolean));
  if (parts.some((part) => runs.has(part))) return true;
  const letters = foldedCode.replace(/[^a-z]/g, '');
  const joined = [foldedName.replace(/[^a-z]/g, '')];
  for (let i = 0; i + 1 < parts.length; i += 1) joined.push(parts[i] + parts[i + 1]);
  return joined.some((candidate) => candidate.length >= 6 && letters.includes(candidate));
}

// Reads the name through ParticipantIdentity (decryptIdentity falls back to
// the ciphertext sibling) and never logs or returns it.
async function assertCodeHasNoPersonalData(db, code, participantId) {
  const what = LabelIdentifierModel.personalDataIn(code);
  if (what) throw createBarcodePersonalDataRefusal(what);
  if (!participantId) return;
  const identityRecord = await (await getCollection(db, 'participantIdentities')).findOne({ participantId: String(participantId) });
  const identity = identityRecord ? participantIdentityService.decryptIdentity(identityRecord) : null;
  if (identity?.patientName && containsPersonName(code, identity.patientName)) {
    throw createBarcodePersonalDataRefusal('o nome do participante');
  }
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
      delete sampleData.storageLocation;

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
        validationError.details = Array.isArray(validation.errors) ? validation.errors : [];
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
        // RF004 AC2/AC3/AC7, RF021 AC6: human research material enters only
        // a collection governed as a biobank or a biorepository, with the
        // one context its regime names and an approval in force.
        const refusal = await collectionGovernanceService.registrationRefusal(db, collectionDoc);
        if (refusal) {
          throw createSampleValidationError(refusal, 422);
        }
        // RF004 AC4: a biorepository specimen belongs to the context's study
        // and protocol; one naming another is refused.
        const ctx = collectionDoc.governanceContext;
        if (collectionDoc.governanceRegime === 'biorepository') {
          for (const field of ['studyId', 'protocolId']) {
            const given = sampleData[field];
            if (given !== undefined && given !== null && given !== '' && String(given) !== ctx[field]) {
              throw createSampleValidationError(`${field} ${given} difere do ${field} do biorrepositório da coleção (${ctx[field]})`, 422);
            }
          }
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

      // dict-02 ELM-0120 (#1368): a derivative names its parents by
      // specimenId. Each must exist, belong to the same participant (consent
      // governance flows through the donor) and not be closed. The sample
      // stores the specimenIds; the lineage event carries each parent's
      // _id, the key the graph holds a Sample under.
      const parentSpecimenIds = [...new Set((Array.isArray(sampleData.parentSpecimenIds) ? sampleData.parentSpecimenIds : [])
        .map((parentId) => String(parentId).trim())
        .filter(Boolean))];
      let parentMongoIds = [];
      if (parentSpecimenIds.length > 0) {
        const parents = await samplesCollection.find({ specimenId: { $in: parentSpecimenIds } }).toArray();
        const byId = new Map(parents.map((parent) => [String(parent.specimenId), parent]));
        for (const parentId of parentSpecimenIds) {
          const parent = byId.get(parentId);
          if (parentId === String(sampleData.specimenId)) {
            throw createSampleValidationError(`parentSpecimenIds ${parentId} é a própria amostra`, 422);
          }
          if (!parent) {
            throw createSampleValidationError(`parentSpecimenIds ${parentId} não encontrado`, 404);
          }
          if (String(parent.participantId) !== String(sampleData.participantId)) {
            throw createSampleValidationError(`parentSpecimenIds ${parentId} pertence a outro participante`, 422);
          }
          if (SampleModel.isTerminalSpecimen(parent)) {
            throw createSampleValidationError(`parentSpecimenIds ${parentId} está encerrada (status: ${parent.specimenStatus})`, 422);
          }
        }
        parentMongoIds = parentSpecimenIds.map((parentId) => String(byId.get(parentId)._id));
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

      // Gera código de barras automaticamente se não fornecido
      if (!sampleData.barcode || (typeof sampleData.barcode === 'string' && sampleData.barcode.trim() === '')) {
        sampleData.barcode = await generateUniqueBarcode(db);
        logger.info(`Código de barras gerado automaticamente: ${sampleData.barcode}`);
      } else {
        // Converte para string se necessário
        sampleData.barcode = String(sampleData.barcode).trim();
        // RNF007 AC4 (#1463): refused before any write.
        await assertCodeHasNoPersonalData(db, sampleData.barcode, sampleData.participantId);

        // #944: era "RF004", que nao menciona barcode em nenhum criterio.
        // O requisito e dict-02 ELM-0116 (Specimen.barcodeValue, Unico).
        // Verifica duplicidade por barcode (se fornecido)
        const existingSample = await samplesCollection.findOne({ barcode: sampleData.barcode });
        if (existingSample) {
          throw new Error(`Já existe uma amostra com o código de barras ${sampleData.barcode}`);
        }
      }

      sampleData.barcodeSymbologies = generateBarcodeSymbologies(sampleData.barcode);
      sampleData.barcodeIndustrial = await generateIndustrialBarcodeArtifacts(sampleData.barcode, {
        includePayload: false
      });

      // #492: live registration didn't compute RCS server-side at all —
      // mirrors import.service.js's CSV/XLSX branch (#383), which is the
      // only other place `sprec` -> RCS-GOV field mapping already exists.
      if (sampleData.sprec && typeof sampleData.sprec === 'object' && Object.keys(sampleData.sprec).length > 0) {
        const canonicalQualityAssessment = qualityDomain.resolveMethodologicalQuality({
          sprec: sampleData.sprec,
          // RF018 AC2 (#1320): the use context reaches the assessment only when sent.
          ...(sampleData.qualificationContext !== undefined ? { qualificationContext: sampleData.qualificationContext } : {}),
        });
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
      // #1192: the tenancy key comes only from the caller's server-built
      // options, never from sampleData, which a request body or import row fills.
      sample.organizationId = options.organizationId ? String(options.organizationId) : null;
      const createdQuantity = Number(sample.currentQuantity ?? sample.quantity ?? 0);

      const buildBirthMovement = (createMovementID) => SampleMovementModel.create({
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
      });
      const ledgerFailure = (ledgerError) => new Error(`Falha ao registrar cadeia de custódia no nascimento da amostra: ${ledgerError.message || ledgerError}`);

      // #474: storageLocation is no longer written directly onto the create
      // doc — the sample is inserted unallocated, then AllocateSampleUseCase
      // performs the atomic occupancyGrid write, storageLocation update, the
      // specimen's placement on the physical chain (#1374, in the create's
      // session) and audit/lineage trail (same use case
      // allocate-sample.controller.js and RegisterSampleUseCase reuse).
      const buildAllocateUseCase = () => new AllocateSampleUseCase({
        storageRepository: new MongoStorageRepository(db),
        auditRepository: new MongoAuditRepository(db),
        lineageRepository: new LineageRepository(db)
      });
      const allocationCommand = (insertedId) => ({
        specimenId: insertedId,
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
      const allocationFailure = (allocationError) => {
        const message = allocationError?.message || String(allocationError);
        const wrapped = new Error(`Falha ao alocar amostra na posição de armazenamento: ${message}`);
        wrapped.statusCode = message.includes('STORAGE_COLLISION') || message.includes('já está alocada') ? 409 : 422;
        return wrapped;
      };
      // #1378: the sample's code is issued as a LabelIdentifier (V2E-0169)
      // on the container the allocation has just loaded it into.
      // Sample.barcode (ELM-0116) is still written for read compatibility
      // until the migration window closes; the insert then drops it.
      const labelIssuedAt = new Date();
      const issueLabel = (insertedId, session) => issueSpecimenLabel(db, { ...sample, _id: insertedId }, {
        code: sample.barcode,
        actorId: options?.auditInfo?.userId || null,
        at: labelIssuedAt,
        session
      });
      const labelFailure = (labelError) => {
        const message = labelError?.message || String(labelError);
        const wrapped = new Error(`Falha ao emitir a etiqueta da amostra: ${message}`);
        wrapped.statusCode = labelError?.code === 'LABEL_EXISTS' ? 409 : 422;
        return wrapped;
      };
      const movementsCollection = await getCollection(db, 'sampleMovements');

      // RF023 AC3, RNF019 C1: on a deployment that runs transactions, the
      // sample insert, its birth movement, the allocation's writes with its
      // custody event, the label's issue (#1378), SPECIMEN_UPSERTED, a derivative's LINEAGE_REGISTERED
      // (#1368) and the caller's own in-transaction step
      // (options.onCreatedInTransaction, the register custody event) commit
      // or abort together: a failed append leaves no sample and no movement.
      // Without a transaction the writes run in sequence, each failure
      // deleting the inserted sample, and SPECIMEN_UPSERTED and
      // LINEAGE_REGISTERED are logged rather than thrown.
      const result = await withTransactionWhereSupported(db, async (session) => {
        if (!session) {
          const insertResult = await samplesCollection.insertOne(withoutLegacyBarcode(sample));

          const createMovementID = await SampleMovementModel.generateMovementID(db);
          try {
            await appendMovementWithHashChain(movementsCollection, buildBirthMovement(createMovementID));
          } catch (ledgerError) {
            await samplesCollection.deleteOne({ _id: insertResult.insertedId });
            throw ledgerFailure(ledgerError);
          }

          try {
            await buildAllocateUseCase().execute(allocationCommand(insertResult.insertedId));
          } catch (allocationError) {
            await samplesCollection.deleteOne({ _id: insertResult.insertedId });
            throw allocationFailure(allocationError);
          }

          try {
            await issueLabel(insertResult.insertedId, null);
          } catch (labelError) {
            await samplesCollection.deleteOne({ _id: insertResult.insertedId });
            throw labelFailure(labelError);
          }

          await recordSpecimenProjection(db, {
            specimenId: String(insertResult.insertedId),
            participantId: sample.participantId,
            sourceService: 'sample.service'
          });
          await recordLineageProjection(db, {
            specimenId: String(insertResult.insertedId),
            parentSpecimenIds: parentMongoIds,
            sourceService: 'sample.service'
          });
          return insertResult;
        }

        const insertResult = await samplesCollection.insertOne(withoutLegacyBarcode(sample), { session });

        const createMovementID = await SampleMovementModel.generateMovementID(db, session);
        try {
          await appendMovementWithHashChain(movementsCollection, buildBirthMovement(createMovementID), { session });
        } catch (ledgerError) {
          if (isTransientTransactionError(ledgerError)) throw ledgerError;
          throw ledgerFailure(ledgerError);
        }

        try {
          await buildAllocateUseCase().execute(allocationCommand(insertResult.insertedId), { session });
        } catch (allocationError) {
          if (isTransientTransactionError(allocationError)) throw allocationError;
          throw allocationFailure(allocationError);
        }

        try {
          await issueLabel(insertResult.insertedId, session);
        } catch (labelError) {
          if (isTransientTransactionError(labelError)) throw labelError;
          throw labelFailure(labelError);
        }

        await new GraphProjectionService().appendSpecimenEvent(db, {
          specimenId: String(insertResult.insertedId),
          participantId: sample.participantId,
          sourceService: 'sample.service'
        }, { session });
        await new GraphProjectionService().appendLineageEvents(db, {
          specimenId: String(insertResult.insertedId),
          parentSpecimenIds: parentMongoIds,
          sourceService: 'sample.service'
        }, { session });

        if (typeof options?.onCreatedInTransaction === 'function') {
          await options.onCreatedInTransaction({ _id: insertResult.insertedId, ...sample }, session);
        }
        return insertResult;
      });

      sample.storageLocation = { boxId, position: positionCode };

      // #510: expose the current placement findCurrentStorageAssignment reads
      // from the physical chain the allocation above just wrote (#1374),
      // alongside the legacy storageLocation snapshot — additive, same
      // precedent #507 set for findSampleById.
      sample.storageAssignment = await new MongoStorageRepository(db)
        .findCurrentStorageAssignment(result.insertedId);

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
        ...sample
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
      
      // Busca a amostra (suporta ObjectId ou barcode)
      let sample = await findSampleByAnyId(samplesCollection, specimenId);

      if (!sample) {
        // Tenta buscar por barcode se não encontrou por ID
        if (typeof specimenId === 'string' && !specimenId.match(/^[0-9a-fA-F]{24}$/)) {
          const result = await this.getSampleByBarcode(db, specimenId);
          sample = result.sample;
        }
      }

      if (!sample) {
        throw new Error('Amostra não encontrada');
      }

      // Validações de status (RF006 AC#4)
      const currentSpecimenStatus = SampleModel.resolveSpecimenStatus(sample);
      if (BLOCKED_SPECIMEN_STATUSES.includes(currentSpecimenStatus)) {
        throw new Error(`Amostra não está disponível para retirada (Status: ${currentSpecimenStatus})`);
      }
      // RF006 AC6: a legal hold blocks the withdrawal too, not only destruction.
      const holdRefusal = await legalHoldService.specimenHoldRefusal(db, sample);
      if (holdRefusal) {
        throw new Error(`Retirada bloqueada: ${holdRefusal}`);
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

      // #541, RF006 AC3: depletion is quantityStatus, not a specimenStatus,
      // so the status gate above does not see it. A depleted specimen has
      // nothing to withdraw; without this, withdrawQty floors at 0 and the
      // write "succeeds" with nothing actually withdrawn.
      if (availableQty <= 0 || SampleModel.resolveQuantityStatus(sample) === 'depleted') {
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

      // RF006 AC2/AC3: a withdrawal moves quantityStatus only; specimenStatus
      // is an operational state no quantity change moves.
      const quantityStatus = SampleModel.computeQuantityStatus(sample.initialQuantity || sample.quantity, newAvailableQty);

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
          quantityStatus,
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
        newStatus: currentSpecimenStatus,
        quantityStatus
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
      // drop their lifecycleStatus fallback). A v1.3.0 value reads folded
      // onto the v2 set, and quantityStatus is derived when absent.
      sample.specimenStatus = SampleModel.resolveSpecimenStatus(sample);
      sample.quantityStatus = SampleModel.resolveQuantityStatus(sample);
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

      // RF006 AC2/AC3: a v1.3.0 quantity value (partial, depleted) asked of
      // specimenStatus is a quantityStatus filter now.
      if (filters.specimenStatus) {
        const requested = String(filters.specimenStatus).trim().toLowerCase();
        if (requested === 'partial' || requested === 'depleted') {
          query.quantityStatus = requested;
        } else {
          query.specimenStatus = requested;
        }
      }

      if (filters.quantityStatus) {
        query.quantityStatus = String(filters.quantityStatus).trim().toLowerCase();
      }

      if (filters.sampleType) {
        query.sampleType = filters.sampleType;
      }

      // #340 (RF003 AC#3): org-scoped caller sees only samples whose
      // tenancy key (organizationId, falling back to collectionSite, #1192)
      // is one of their scoped organizations. No-op for a 'global'
      // (Administrador) scope. Caller must resolve+attach organizationScope
      // via rbac.js's requireOrganizationScope first.
      if (filters.organizationScope) {
        applySampleOrganizationScope(query, filters.organizationScope);
      }

      const limit = filters.limit || 50;
      const skip = filters.skip || 0;

      // #647 (same shape as #645's sensor-list bug): no sort meant Mongo's
      // natural (insertion) order decided which samples landed on the
      // default 50-item page -- once the collection passed that default
      // (e2e fixtures accumulate across sessions in the test stack's named
      // volumes), a freshly created sample silently never appeared in
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
        sample.quantityStatus = SampleModel.resolveQuantityStatus(sample);
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

      const previousStatus = SampleModel.resolveSpecimenStatus(existing);
      const requestedStatus = updateData.specimenStatus
        ? String(updateData.specimenStatus).trim().toLowerCase()
        : null;
      // RF006 AC3: quantityStatus is derived, never written by a client.
      if (Object.prototype.hasOwnProperty.call(updateData, 'quantityStatus')) {
        throw createStatusWriteRefusal('quantityStatus é derivado de initialQuantity e currentQuantity e não pode ser editado');
      }
      // RNF018 AC4: the RCS result is set only by certification.
      const rcsDerivedFields = findRcsDerivedFields(updateData);
      if (rcsDerivedFields.length > 0) {
        throw createRcsDerivedWriteRefusal(rcsDerivedFields);
      }
      // RNF018 AC1 (#1525): a negative or non-numeric quantity is refused.
      const invalidQuantityFields = findInvalidQuantityFields(updateData);
      if (invalidQuantityFields.length > 0) {
        throw createInvalidQuantityRefusal(invalidQuantityFields);
      }
      // #1378 (ELM-0116): after the migration window, barcode is not written.
      assertLegacyBarcodeWritable(updateData);
      // RNF007 AC4 (#1463): a written barcode carries no personal data.
      if (Object.prototype.hasOwnProperty.call(updateData, 'barcode') && String(updateData.barcode ?? '').trim()) {
        await assertCodeHasNoPersonalData(db, String(updateData.barcode).trim(), existing.participantId);
      }
      if (requestedStatus) {
        // RF026 AC7: closed only by POST /api/samples/:id/close (validated
        // total consumption) or an executed disposition, never by an edit.
        if (requestedStatus === 'closed') {
          throw createStatusWriteRefusal('specimenStatus closed só é atribuído por POST /api/samples/:id/close (consumo total validado) ou por uma destinação executada');
        }
        // RF006 AC2 (V2E-0544): the v1.3.0 values are not operational states.
        if (!SampleModel.validateSpecimenStatus(requestedStatus)) {
          throw createStatusWriteRefusal(`specimenStatus inválido: ${requestedStatus}. Aceitos: available, reserved, checked_out, quarantined, unavailable`);
        }
      }
      // RF026 AC7: closed is final; an edit does not reopen it.
      if (requestedStatus && SampleModel.isTerminalSpecimen(existing) && requestedStatus !== previousStatus) {
        throw createStatusWriteRefusal(`Amostra em ${previousStatus} não admite mudança de specimenStatus`);
      }
      // RF006 AC2: only an explicit request moves specimenStatus; quantity
      // moves quantityStatus alone.
      const specimenStatus = requestedStatus || previousStatus;
      const quantityStatus = SampleModel.computeQuantityStatus(nextOriginal, nextAvailable);

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
      // participantId, and sourceRecordId, the source system's id an
      // import recorded), the 5 status fields above (already handled/
      // recomputed), and _id/createdAt/updatedAt (this service owns
      // updatedAt below). Add a field to Sample.create() and this list
      // together.
      // 'notes' is not in Sample.js's field list but is pinned writable by
      // #540's test; whether it belongs in the model is #875's dict-02
      // flag, not this change's call.
      // parentSpecimenIds (ELM-0120, #1368) is set at creation, where its
      // LINEAGE_REGISTERED is appended, and is deliberately not updatable.
      const ALLOWED_UPDATE_FIELDS = [
        'sampleType', 'sampleOrigin', 'extractionProtocol', 'barcode',
        'barcodeSymbologies', 'barcodeIndustrial', 'registeredAt',
        'withdrawnAt', 'receivedAt', 'quantity', 'unit', 'quality',
        // RCS_DERIVED_FIELDS are refused above (RNF018 AC4).
        'externalQualityAssessment', 'locationID', 'linkedProject',
        'collectionSite', 'sprec', 'merkleRoot',
        'sealedSpecimenPreanalyticsId', 'consentTemplateId', 'clinicalData',
        'pharmacologyData', 'consentStatus', 'quarantineReason',
        'importBatchId', 'importedAt', 'importedBy', 'currentQuantity',
        'initialQuantity', 'totalWithdrawn', 'totalReturned',
        'accessionNumber', 'orderNumber', 'processingStatus',
        'protocolApplied', 'specimenCollection', 'studyId', 'protocolId',
        'collectionId', 'linkedFiles', 'qrCode', 'storageLocation',
        'notes'
      ];
      const restUpdateData = {};
      for (const key of ALLOWED_UPDATE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(updateData, key)) {
          restUpdateData[key] = updateData[key];
        }
      }

      // A document not yet migrated keeps its stored value unless the caller
      // asked for a status: the migration, not an unrelated edit, replaces
      // it and records its provenance.
      const payload = {
        ...restUpdateData,
        ...(requestedStatus ? { specimenStatus } : {}),
        quantityStatus,
        updatedAt: new Date()
      };

      const statusChanges = String(previousStatus || '').toLowerCase() !== String(specimenStatus || '').toLowerCase();
      const writeUpdate = async (session) => {
        const result = await samplesCollection.updateOne(
          { specimenId: existing.specimenId },
          { $set: payload },
          session ? { session } : undefined
        );
        // RF006 AC7: an edit that changes specimenStatus records the change,
        // append-only, with the write. The edit has no event of its own, so
        // the decision's trigger is an id minted for this update.
        if (result.matchedCount > 0 && statusChanges) {
          await operationalStateDecisionService.recordStatusChange(db, {
            specimenId: existing.specimenId || String(existing._id),
            previousStatus,
            newStatus: specimenStatus,
            triggerEventId: `sample-update:${crypto.randomUUID()}`,
            rulesApplied: ['manual_status_update'],
            reasonCodes: ['update'],
          }, { session });
        }
        return result;
      };
      const result = statusChanges
        ? await withTransactionWhereSupported(db, writeUpdate)
        : await writeUpdate(null);

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
      // #1216: a bare { specimenId } filter never matched the ObjectId the
      // route passed, so DELETE answered 404 for a sample that exists.
      const sample = await findSampleByAnyId(samplesCollection, specimenId);
      if (!sample) return false;
      const result = await samplesCollection.deleteOne({ _id: sample._id });
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
      
      // Tenta múltiplas estratégias de busca para garantir compatibilidade
      let sample = null;

      // 1. Busca exata (string)
      if (!sample) {
        sample = await samplesCollection.findOne({ barcode: barcodeStr });
      }
      if (sample) {
        logger.info(`Amostra encontrada (busca exata): ${sample._id}, barcode: ${sample.barcode}`);
      }
      
      // 2. Se não encontrou, tenta case-insensitive (normaliza para uppercase)
      if (!sample) {
        const barcodeUpper = barcodeStr.toUpperCase();
        sample = await samplesCollection.findOne({ 
          $or: [
            { barcode: barcodeUpper },
            { barcode: barcodeStr }
          ]
        });
        if (sample) {
          logger.info(`Amostra encontrada (case-insensitive): ${sample._id}, barcode: ${sample.barcode}`);
        }
      }
      
      // 3. Se não encontrou e é formato numérico, tenta como número (compatibilidade com dados antigos)
      if (!sample && /^\d+$/.test(barcodeStr)) {
        const barcodeNum = parseInt(barcodeStr, 10);
        if (!isNaN(barcodeNum)) {
          sample = await samplesCollection.findOne({ barcode: barcodeNum });
          if (sample) {
            logger.info(`Amostra encontrada (como número): ${sample._id}, barcode: ${sample.barcode}`);
          }
        }
      }
      
      // 4. Última tentativa: busca por regex (case-insensitive) para casos com formatação diferente
      if (!sample) {
        // Escapa caracteres especiais do regex
        const escapedBarcode = barcodeStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regexPattern = new RegExp(`^${escapedBarcode}$`, 'i');
        sample = await samplesCollection.findOne({ barcode: { $regex: regexPattern } });
        if (sample) {
          logger.info(`Amostra encontrada (regex): ${sample._id}, barcode: ${sample.barcode}`);
        }
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
          // #1386: the record number is the identity's (P1X-0355); a Patient's
          // own legacy recordNumber is not read.
          participant = {
            participantId: participant.participantId,
            patientName: anonymizeName(identity?.patientName),
            recordNumber: identity?.recordNumber ?? null
          };
        }
      }

      // See getSample's comment — same specimenStatus guarantee for barcode lookups.
      sample.specimenStatus = SampleModel.resolveSpecimenStatus(sample);
      sample.quantityStatus = SampleModel.resolveQuantityStatus(sample);

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
      
      // Busca a amostra (suporta ObjectId ou barcode)
      let sample = await findSampleByAnyId(samplesCollection, specimenId);

      if (!sample) {
        // Tenta buscar por barcode se não encontrou por ID
        if (typeof specimenId === 'string' && !specimenId.match(/^[0-9a-fA-F]{24}$/)) {
          const result = await this.getSampleByBarcode(db, specimenId);
          sample = result.sample;
        }
      }

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

      // RF006 AC2/AC3: a return moves quantityStatus only (a depleted
      // specimen becomes partial or full again); specimenStatus stays.
      const quantityStatus = SampleModel.computeQuantityStatus(sample.initialQuantity || sample.quantity, newAvailableQty);

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
          quantityStatus,
          updatedAt: new Date()
        };

        // Fully restored: the withdrawal it answered is over.
        if (quantityStatus === 'full') {
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
        newStatus: currentSpecimenStatus,
        quantityStatus
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

      // sampleID (route param) is the Mongo _id; movements store the
      // separate server-generated specimenId field (RF006, #288) — same
      // _id/specimenId mismatch class findSampleByAnyId already fixes
      // for getSample/withdrawSample/returnSample.
      const sample = await findSampleByAnyId(samplesCollection, specimenId);
      const specimenIdStr = sample
        ? sample.specimenId
        : (specimenId.toString ? specimenId.toString() : specimenId);

      const movements = await movementsCollection
        .find({
          $or: [
            { specimenId: specimenIdStr },
            { barcode: (sample && sample.barcode) || specimenIdStr },
            // #1220: legacy rows are keyed by the sample's _id.
            ...(sample ? [{ specimenId: String(sample._id) }] : [])
          ]
        })
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
      // #1219: handed the sample, the lookup matches its specimenId and the
      // _id every action recorded before #1219 carries.
      return await quarantineActionService.getActionsForSpecimen(
        db,
        sample || (specimenId.toString ? specimenId.toString() : specimenId)
      );
    } catch (error) {
      logger.error('Erro ao buscar ações de quarentena:', error.message);
      throw error;
    }
  }

  // RF006 AC7: a specimen's OperationalStateDecisions, oldest first. A legacy
  // sample with no specimenId has its decisions keyed by its stored _id.
  async getStateDecisions(db, specimenId) {
    const samplesCollection = await getCollection(db, 'samples');
    const sample = await findSampleByAnyId(samplesCollection, specimenId);
    if (!sample) return null;
    const keys = [...new Set([sample.specimenId, String(sample._id)].filter(Boolean))];
    const rows = (await Promise.all(keys.map((key) => operationalStateDecisionService.historyOf(db, key)))).flat();
    return rows.sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));
  }

  /**
   * Garante que amostras com status QUARANTINED não sejam retornadas para pesquisadores.
   */
  async findAvailableSamplesForResearch(db, query = {}) {
    const samplesCollection = await getCollection(db, 'samples');
    // Garante que só retorna amostras AVAILABLE. RF006 AC3: a depleted
    // specimen is available in state but has nothing to use.
    const finalQuery = { ...query, specimenStatus: 'available', quantityStatus: { $ne: 'depleted' } };
    return samplesCollection.find(finalQuery).toArray();
  }

  /**
   * RF026 AC7 (dictionary RULE-006): closes a specimen whose total
   * consumption is validated, i.e. its quantities derive quantityStatus
   * depleted. Refused (409) when it is not depleted or already closed.
   * The change appends an OperationalStateDecision with the write; the route
   * audits it. Returns null when the specimen does not exist.
   */
  async closeSpecimen(db, specimenId, { actorId = null } = {}) {
    const samplesCollection = await getCollection(db, 'samples');
    const sample = await findSampleByAnyId(samplesCollection, specimenId);
    if (!sample) return null;

    const previousStatus = SampleModel.resolveSpecimenStatus(sample);
    if (previousStatus === 'closed') {
      throw createSampleValidationError('Amostra já está encerrada (closed)', 409);
    }
    // Derived from the quantities themselves, not a stored quantityStatus a
    // stale document might carry.
    const { initial, current } = SampleModel.quantitiesOf(sample);
    const quantityStatus = SampleModel.computeQuantityStatus(initial, current);
    if (quantityStatus !== 'depleted') {
      throw createSampleValidationError(
        `Encerramento exige consumo total validado: quantityStatus é ${quantityStatus} (currentQuantity ${current ?? 0})`,
        409
      );
    }

    const canonicalId = sample.specimenId || String(sample._id);
    const triggerEventId = `sample-close:${crypto.randomUUID()}`;
    const now = new Date();
    const decision = await withTransactionWhereSupported(db, async (session) => {
      const result = await samplesCollection.updateOne(
        { _id: sample._id, specimenStatus: sample.specimenStatus ?? null },
        { $set: { specimenStatus: 'closed', quantityStatus, updatedAt: now } },
        session ? { session } : undefined
      );
      if (!result || result.matchedCount === 0) {
        throw createSampleValidationError('Amostra alterada concorrentemente; leia-a de novo', 409);
      }
      return operationalStateDecisionService.recordStatusChange(db, {
        specimenId: canonicalId,
        previousStatus,
        newStatus: 'closed',
        triggerEventId,
        rulesApplied: ['rf026_ac7_validated_consumption'],
        reasonCodes: ['total_consumption'],
      }, { session });
    });

    logger.info(`Amostra encerrada por consumo total: ${canonicalId}${actorId ? ` (por ${actorId})` : ''}`);
    return {
      specimenId: canonicalId,
      previousStatus,
      specimenStatus: 'closed',
      quantityStatus,
      operationalStateDecisionId: decision?.operationalStateDecisionId || null,
      triggerEventId,
    };
  }
}

module.exports = new SampleService();

