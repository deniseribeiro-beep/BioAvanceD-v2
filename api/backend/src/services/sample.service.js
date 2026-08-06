const { SampleModel, BLOCKED_SPECIMEN_STATUSES } = require('../models/Sample');
const SampleMovementModel = require('../models/SampleMovement');
const StorageAssignmentModel = require('../models/StorageAssignment');
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
const { withMongoTransaction } = require('../utils/mongoTransaction');
const rcsAssessmentService = require('./rcs-assessment.service');
const specimenPreanalyticsService = require('./specimen-preanalytics.service');
const quarantineActionService = require('./quarantine-action.service');
const { ObjectId } = require('mongodb');

const LOCATION_REQUIRED_MESSAGE = 'Localização física obrigatória para cadastro de amostra';
const CRITICAL_SENSOR_STATUSES = ['maintenance', 'calibration', 'error', 'offline'];
// #470: mirrors intakeWizard.js's BLOCKED_EQUIPMENT_STATUSES — the
// equipment-readiness half of RF004's gate, missing here until now.
const BLOCKED_EQUIPMENT_STATUSES = ['maintenance', 'inactive', 'needs calibration', 'error', 'retired'];

/**
 * Every caller (sample.routes.js) passes an already-cast ObjectId as
 * `specimenId` — but that field on Sample is a separate, server-generated
 * string (see sampleIDGenerator.js), so a bare `{ specimenId }` query never
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
      sampleData.storageLocation = { boxId, position: positionCode };

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
      }

      if (sampleData.protocolId !== undefined && sampleData.protocolId !== null && sampleData.protocolId !== '') {
        const protocol = await db.collection('protocols').findOne({ protocolId: String(sampleData.protocolId) });
        if (!protocol) {
          throw createSampleValidationError(`protocolId ${sampleData.protocolId} não encontrado`, 404);
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
      if (equipmentStatus && BLOCKED_EQUIPMENT_STATUSES.includes(equipmentStatus)) {
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
        sampleData.barcode = await generateUniqueBarcode(db, 'samples');
        logger.info(`Código de barras gerado automaticamente: ${sampleData.barcode}`);
      } else {
        // Converte para string se necessário
        sampleData.barcode = String(sampleData.barcode).trim();
        
        // RF004 - Verifica duplicidade por barcode (se fornecido)
        const existingSample = await samplesCollection.findOne({ barcode: sampleData.barcode });
        if (existingSample) {
          throw new Error(`Já existe uma amostra com o código de barras ${sampleData.barcode}`);
        }
      }

      sampleData.barcodeSymbologies = generateBarcodeSymbologies(sampleData.barcode);
      sampleData.barcodeIndustrial = await generateIndustrialBarcodeArtifacts(sampleData.barcode, {
        includePayload: false
      });

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
          destination: sample.storageLocation?.boxId
            ? `storage:${sample.storageLocation.boxId}:${sample.storageLocation.position}`
            : null,
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

      // #462: dict-02 StorageAssignment (ELM-0167-0178) — open the
      // placement-history record for the specimen's stay at boxId/positionCode,
      // same convention the #461 backfill script uses (equipmentId = the
      // FREEZER StorageContainer's _id, not its containerID).
      const storageAssignmentsCollection = db.collection('storageAssignments');
      await storageAssignmentsCollection.insertOne(StorageAssignmentModel.open({
        specimenId: result.insertedId,
        boxId,
        positionCode,
        equipmentId: freezer._id,
        shelfId: shelf?._id || null,
        rackId: rack?._id || null,
        placedAt: sample.registeredAt
      }));

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

      const limit = filters.limit || 50;
      const skip = filters.skip || 0;

      const samples = await samplesCollection
        .find(query)
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

      // lifecycleStatus/availabilityStatus/quarantineStatus are retired
      // (#408) — specimenStatus is the sole source of truth, so any caller
      // still sending the legacy fields on the wire is silently ignored
      // rather than persisted.
      const { lifecycleStatus, availabilityStatus, quarantineStatus, ...restUpdateData } = updateData;

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
          const anonymizeName = (name) => {
            if (!name) return '***';
            const parts = name.trim().split(' ');
            if (parts.length === 1) return parts[0].charAt(0) + '***';
            return parts[0].charAt(0) + '. ' + parts[parts.length - 1].charAt(0) + '.';
          };
          participant = {
            participantId: participant.participantId,
            patientName: anonymizeName(participant.patientName),
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
            { barcode: (sample && sample.barcode) || specimenIdStr }
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

