#!/usr/bin/env node

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');
const { connectDB, closeConnection } = require('../src/database/mongo');
const { connectNeo4j, closeNeo4jConnection } = require('../src/infrastructure/database/neo4j/connection');
const redisModule = require('../src/config/redis');
const fhirSyncService = require('../src/services/fhir-sync.service');
const logger = require('../src/utils/logger');

function parseArgs(argv) {
  const args = {
    records: 10000,
    batchSize: 1000,
    clean: false,
    skipFhir: false,
    skipNeo4j: false,
    skipRedis: false,
    includeLegacyAliases: true,
    edgePercent: 15,
    negativePercent: 5,
    enableCoverageReport: true
  };

  for (const token of argv) {
    if (token.startsWith('--records=')) args.records = Math.max(1, Number(token.split('=')[1]) || 10000);
    if (token.startsWith('--batch-size=')) args.batchSize = Math.max(100, Number(token.split('=')[1]) || 1000);
    if (token === '--clean') args.clean = true;
    if (token === '--skip-fhir') args.skipFhir = true;
    if (token === '--skip-neo4j') args.skipNeo4j = true;
    if (token === '--skip-redis') args.skipRedis = true;
    if (token === '--no-legacy-aliases') args.includeLegacyAliases = false;
    if (token.startsWith('--edge-percent=')) args.edgePercent = Math.max(0, Math.min(100, Number(token.split('=')[1]) || 15));
    if (token.startsWith('--negative-percent=')) args.negativePercent = Math.max(0, Math.min(100, Number(token.split('=')[1]) || 5));
    if (token === '--no-coverage-report') args.enableCoverageReport = false;
  }

  if (args.edgePercent + args.negativePercent > 100) {
    const total = args.edgePercent + args.negativePercent;
    args.edgePercent = Number(((args.edgePercent / total) * 100).toFixed(2));
    args.negativePercent = Number((100 - args.edgePercent).toFixed(2));
  }

  return args;
}

function profileForIndex(index, total, edgePercent, negativePercent) {
  const normalized = (index % total) / total;
  const negativeThreshold = negativePercent / 100;
  const edgeThreshold = (negativePercent + edgePercent) / 100;

  if (normalized < negativeThreshold) return 'negative';
  if (normalized < edgeThreshold) return 'edge';
  return 'baseline';
}

function pick(arr, index) {
  return arr[index % arr.length];
}

function fmt2(n) {
  return String(n).padStart(2, '0');
}

function patientIdFromIndex(index) {
  return String(10000000 + index).padStart(8, '0').slice(0, 8);
}

function nowIsoSafe() {
  return new Date().toISOString().replace(/[.:]/g, '-');
}

function computeCollectionCoverage(docs) {
  if (!Array.isArray(docs) || docs.length === 0) {
    return { totalDocuments: 0, fields: [] };
  }

  const fieldStats = new Map();

  for (const doc of docs) {
    const keys = Object.keys(doc || {});
    for (const key of keys) {
      if (!fieldStats.has(key)) {
        fieldStats.set(key, { present: 0, nonNull: 0, nullish: 0, nonEmptyString: 0 });
      }

      const stat = fieldStats.get(key);
      stat.present += 1;
      const value = doc[key];
      const isNullish = value === null || value === undefined;
      if (isNullish) {
        stat.nullish += 1;
      } else {
        stat.nonNull += 1;
        if (typeof value === 'string' && value.trim().length > 0) {
          stat.nonEmptyString += 1;
        }
      }
    }
  }

  const total = docs.length;
  const fields = Array.from(fieldStats.entries())
    .map(([field, stat]) => ({
      field,
      present: stat.present,
      presentRate: Number(((stat.present / total) * 100).toFixed(2)),
      nonNull: stat.nonNull,
      nonNullRate: Number(((stat.nonNull / total) * 100).toFixed(2)),
      nullish: stat.nullish,
      nullishRate: Number(((stat.nullish / total) * 100).toFixed(2)),
      nonEmptyString: stat.nonEmptyString,
      nonEmptyStringRate: Number(((stat.nonEmptyString / total) * 100).toFixed(2))
    }))
    .sort((a, b) => a.field.localeCompare(b.field));

  return {
    totalDocuments: total,
    fields
  };
}

async function listExistingCollectionNames(db) {
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  return new Set(collections.map((item) => item.name));
}

function resolveCollectionName(existing, primary, aliases = [], includeLegacyAliases = true) {
  if (existing.has(primary)) return primary;
  if (includeLegacyAliases) {
    for (const alias of aliases) {
      if (existing.has(alias)) return alias;
    }
  }
  return primary;
}

async function insertManyBatched(collection, docs, batchSize) {
  for (let i = 0; i < docs.length; i += batchSize) {
    const chunk = docs.slice(i, i + batchSize);
    if (chunk.length > 0) {
      await collection.insertMany(chunk, { ordered: false });
    }
  }
}

async function clearCollections(db, names) {
  for (const name of names) {
    try {
      await db.collection(name).deleteMany({});
    } catch (_) {
      await db.collection(name).deleteMany({});
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date();

  const reportDir = path.join(__dirname, '..', '..', 'reports', 'system-audit');
  fs.mkdirSync(reportDir, { recursive: true });

  const summary = {
    startedAt: startedAt.toISOString(),
    params: args,
    mongo: {},
    fhir: null,
    neo4j: null,
    redis: null,
    profileDistribution: {
      baseline: 0,
      edge: 0,
      negative: 0
    },
    coverage: null,
    finishedAt: null,
    durationMs: null
  };

  const sampleTypesCatalog = ['Sangue', 'Urina', 'Saliva', 'Tecido', 'DNA', 'RNA', 'Plasma', 'Soro', 'Líquido Cefalorraquidiano'];
  const sampleOriginsCatalog = ['Coleta', 'Transferência', 'Doação', 'Pesquisa'];
  const extractionProtocolsCatalog = ['Protocolo A', 'Protocolo B', 'Protocolo C', 'QIAGEN', 'Phenol-Chloroform', 'Automated'];
  const projectsCatalog = ['Projeto Genoma Raro', 'Projeto OncoMap', 'Projeto Metabólico', 'Projeto NeuroTrace'];
  const unitsCatalog = ['Cardiologia', 'Oncologia', 'Genética', 'Neurologia', 'Endocrinologia'];

  let db;
  try {
    db = await connectDB();
    const existing = await listExistingCollectionNames(db);

    const names = {
      users: resolveCollectionName(existing, 'users'),
      patients: resolveCollectionName(existing, 'patients', ['pacientes'], args.includeLegacyAliases),
      samples: resolveCollectionName(existing, 'samples', ['amostras'], args.includeLegacyAliases),
      consents: resolveCollectionName(existing, 'patientConsents', ['patient_consents'], args.includeLegacyAliases),
      consentTemplates: resolveCollectionName(existing, 'consent_templates', ['consentTemplates'], args.includeLegacyAliases),
      sampleMovements: resolveCollectionName(existing, 'sample_movements'),
      withdrawals: resolveCollectionName(existing, 'withdrawals'),
      locations: resolveCollectionName(existing, 'locations'),
      storageContainers: resolveCollectionName(existing, 'storageContainers'),
      storageBoxes: resolveCollectionName(existing, 'storageBoxes'),
      storagePaths: resolveCollectionName(existing, 'storagePaths'),
      policies: resolveCollectionName(existing, 'policies'),
      sensors: resolveCollectionName(existing, 'sensors'),
      temperatures: resolveCollectionName(existing, 'temperatures'),
      results: resolveCollectionName(existing, 'results'),
      reports: resolveCollectionName(existing, 'reports'),
      access: resolveCollectionName(existing, 'access'),
      logs: resolveCollectionName(existing, 'logs'),
      sessions: resolveCollectionName(existing, 'sessions'),
      sampleTypes: resolveCollectionName(existing, 'sampleTypes'),
      sampleOrigins: resolveCollectionName(existing, 'sampleOrigins'),
      extractionProtocols: resolveCollectionName(existing, 'extractionProtocols'),
      measurementUnits: resolveCollectionName(existing, 'measurementUnits'),
      qualityDescriptions: resolveCollectionName(existing, 'qualityDescriptions'),
      equipment: resolveCollectionName(existing, 'equipment'),
      alerts: resolveCollectionName(existing, 'alerts'),
      intelligentAssistant: resolveCollectionName(existing, 'intelligentAssistant')
    };

    if (args.clean) {
      await clearCollections(db, Object.values(names));
      await clearCollections(db, ['patients_fhir', 'samples_fhir', 'consents_fhir']);
    }

    const measurementUnits = [
      { unitID: 1, description: 'Microlitro', abbreviation: 'µL', createdAt: new Date(), updatedAt: new Date() },
      { unitID: 2, description: 'Mililitro', abbreviation: 'mL', createdAt: new Date(), updatedAt: new Date() },
      { unitID: 3, description: 'Litro', abbreviation: 'L', createdAt: new Date(), updatedAt: new Date() },
      { unitID: 4, description: 'Miligrama', abbreviation: 'mg', createdAt: new Date(), updatedAt: new Date() }
    ];

    const qualityDescriptions = [
      { qualityID: 0, description: 'Não avaliada', qualityLevel: 'N/A', createdAt: new Date(), updatedAt: new Date() },
      { qualityID: 1, description: 'Adequada', qualityLevel: 'A', createdAt: new Date(), updatedAt: new Date() },
      { qualityID: 2, description: 'Inadequada', qualityLevel: 'C', createdAt: new Date(), updatedAt: new Date() }
    ];

    const sampleTypes = sampleTypesCatalog.map((description, index) => ({
      sampleTypeID: index + 1,
      description,
      code: `ST-${index + 1}`,
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    const sampleOrigins = sampleOriginsCatalog.map((description, index) => ({
      originID: index + 1,
      description,
      code: `SO-${index + 1}`,
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    const extractionProtocols = extractionProtocolsCatalog.map((description, index) => ({
      protocolID: index + 1,
      description,
      code: `EP-${index + 1}`,
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    await db.collection(names.measurementUnits).insertMany(measurementUnits, { ordered: false });
    await db.collection(names.qualityDescriptions).insertMany(qualityDescriptions, { ordered: false });
    await db.collection(names.sampleTypes).insertMany(sampleTypes, { ordered: false });
    await db.collection(names.sampleOrigins).insertMany(sampleOrigins, { ordered: false });
    await db.collection(names.extractionProtocols).insertMany(extractionProtocols, { ordered: false });

    const equipmentDocs = [
      { equipmentID: 1, name: 'Ultra Freezer A', type: 'FREEZER', status: 'OPERATIONAL', createdAt: new Date() },
      { equipmentID: 2, name: 'Ultra Freezer B', type: 'FREEZER', status: 'OPERATIONAL', createdAt: new Date() }
    ];
    await db.collection(names.equipment).insertMany(equipmentDocs, { ordered: false });

    const locationCount = Math.max(200, Math.ceil(args.records / 20));
    const locations = Array.from({ length: locationCount }).map((_, idx) => ({
      locationID: idx + 1,
      equipmentType: 1,
      equipmentID: (idx % 2) + 1,
      block: Math.floor(idx / 50) + 1,
      rack: (idx % 10) + 1,
      drawer: (idx % 5) + 1,
      box: (idx % 25) + 1,
      wellPosition: `${String.fromCharCode(65 + (idx % 9))}${(idx % 9) + 1}`,
      createdAt: new Date(),
      updatedAt: new Date()
    }));
    await insertManyBatched(db.collection(names.locations), locations, args.batchSize);

    const freezers = [
      { _id: new ObjectId(), containerID: 1, name: 'FREEZER_01', containerType: 'FREEZER', parent_id: null, temperature: -80, temperatureUnit: 'CELSIUS', capacity: 10, status: 'OPERATIONAL', createdAt: new Date(), updatedAt: new Date() },
      { _id: new ObjectId(), containerID: 2, name: 'FREEZER_02', containerType: 'FREEZER', parent_id: null, temperature: -20, temperatureUnit: 'CELSIUS', capacity: 10, status: 'OPERATIONAL', createdAt: new Date(), updatedAt: new Date() }
    ];

    const shelves = [];
    const racks = [];
    const boxes = [];
    const paths = [];

    let containerId = 10;
    let boxId = 100;

    for (const freezer of freezers) {
      for (let shelfN = 1; shelfN <= 3; shelfN += 1) {
        const shelf = {
          _id: new ObjectId(),
          containerID: containerId++,
          name: `${freezer.name}_SHELF_${shelfN}`,
          containerType: 'SHELF',
          parent_id: freezer._id,
          temperature: null,
          capacity: 8,
          status: 'OPERATIONAL',
          createdAt: new Date(),
          updatedAt: new Date()
        };
        shelves.push(shelf);

        for (let rackN = 1; rackN <= 3; rackN += 1) {
          const rack = {
            _id: new ObjectId(),
            containerID: containerId++,
            name: `${shelf.name}_RACK_${rackN}`,
            containerType: 'RACK',
            parent_id: shelf._id,
            temperature: null,
            capacity: 20,
            status: 'OPERATIONAL',
            createdAt: new Date(),
            updatedAt: new Date()
          };
          racks.push(rack);

          for (let boxN = 1; boxN <= 4; boxN += 1) {
            const box = {
              _id: new ObjectId(),
              boxID: boxId++,
              name: `${rack.name}_BOX_${boxN}`,
              description: 'Box seed full',
              parent_id: rack._id,
              dimension: { rows: 9, cols: 9 },
              occupancyGrid: {},
              capacity: 81,
              currentOccupancy: 0,
              status: 'ACTIVE',
              createdAt: new Date(),
              updatedAt: new Date(),
              lastModified: new Date()
            };
            boxes.push(box);

            paths.push({
              boxId: box._id,
              rackId: rack._id,
              shelfId: shelf._id,
              freezerId: freezer._id,
              path: `${freezer.name}/${shelf.name}/${rack.name}/${box.name}`,
              createdAt: new Date()
            });
          }
        }
      }
    }

    await db.collection(names.storageContainers).insertMany([...freezers, ...shelves, ...racks], { ordered: false });
    await db.collection(names.storageBoxes).insertMany(boxes, { ordered: false });
    await db.collection(names.storagePaths).insertMany(paths, { ordered: false });

    const policies = [
      { policyId: 1, minThreshold: -90, maxThreshold: -70, targetTemperature: -80, hysteresis: 0.5, alertDelayMin: 5, temperatureUnit: '°C', validFrom: new Date(), validTo: null, createdAt: new Date(), updatedAt: new Date() },
      { policyId: 2, minThreshold: -30, maxThreshold: -10, targetTemperature: -20, hysteresis: 0.5, alertDelayMin: 5, temperatureUnit: '°C', validFrom: new Date(), validTo: null, createdAt: new Date(), updatedAt: new Date() }
    ];
    await db.collection(names.policies).insertMany(policies, { ordered: false });

    const passwordHash = await bcrypt.hash('SenhaForte@123', 10);
    const users = [];
    for (let i = 1; i <= 30; i += 1) {
      const accessType = ((i - 1) % 4) + 1;
      users.push({
        name: `Usuário Seed ${i}`,
        email: `seed.user.${i}@bioavanced.local`,
        phone: `1199999${fmt2(i)}`,
        institution: 'BioAvanceD Seed Lab',
        username: `seed_user_${i}`,
        password: passwordHash,
        accessType,
        roleName: accessType === 4 ? 'Administrador' : accessType === 3 ? 'Coordenador' : accessType === 2 ? 'Técnico' : 'Usuário Externo',
        status: 'active',
        mfaEnabled: accessType !== 4,
        mfaSecret: null,
        mfaActivationDate: null,
        mfaFailedAttempts: 0,
        mfaLocked: false,
        anonId: `USR-SEED-${String(i).padStart(5, '0')}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastLogin: null,
        passwordHistory: [],
        lastPasswordChange: new Date(),
        forceReset: false,
        failedLoginAttempts: 0
      });
    }
    await db.collection(names.users).insertMany(users, { ordered: false });
    const insertedUsers = await db.collection(names.users).find({}, { projection: { _id: 1, username: 1, accessType: 1 } }).toArray();

    const consentTemplateDoc = {
      title: 'Termo de Consentimento Dinâmico - Seed',
      content: '<p>Consentimento para uso de dados e amostras para pesquisa.</p>',
      htmlContent: '<p>Consentimento para uso de dados e amostras para pesquisa.</p>',
      version: '1.0.0-seed',
      active: true,
      permissions: [
        { key: 'uso_pesquisa', label: 'Uso em pesquisa', required: true },
        { key: 'uso_comercial', label: 'Uso comercial', required: false },
        { key: 'compartilhamento_anonimo', label: 'Compartilhamento anonimizado', required: true }
      ],
      createdAt: new Date()
    };
    const consentTemplateInsert = await db.collection(names.consentTemplates).insertOne(consentTemplateDoc);

    const patients = [];
    const samples = [];
    const sampleMovements = [];
    const withdrawals = [];
    const results = [];
    const consents = [];
    const logs = [];
    const reports = [];
    const accessDocs = [];
    const sessions = [];

    for (let i = 1; i <= args.records; i += 1) {
      const profile = profileForIndex(i, args.records, args.edgePercent, args.negativePercent);
      summary.profileDistribution[profile] += 1;

      const patientID = patientIdFromIndex(i);
      const unit = pick(unitsCatalog, i);
      const user = pick(insertedUsers, i);
      const project = pick(projectsCatalog, i);
      const box = pick(boxes, i);
      const location = pick(locations, i);
      const sampleObjectId = new ObjectId();
      const movementId = i;

      const birthDate = profile === 'edge'
        ? new Date(1920 + (i % 80), i % 12, ((i % 27) + 1))
        : new Date(1970 + (i % 30), i % 12, (i % 27) + 1);
      const sex = i % 3 === 0 ? 'M' : i % 3 === 1 ? 'F' : 'O';
      const clinicalStatus = profile === 'negative' ? 'INACTIVE' : 'ACTIVE';
      const notes = profile === 'edge'
        ? 'Paciente sintético EDGE com campos estendidos para limites de UI e persistência'
        : profile === 'negative'
          ? 'Paciente sintético NEGATIVE para cenários de fluxos bloqueados'
          : 'Paciente sintético para teste E2E/integração';

      patients.push({
        _id: new ObjectId(),
        patientID,
        patientName: `Paciente Seed ${String(i).padStart(5, '0')}`,
        birthDate,
        sex,
        weight: 45 + (i % 50),
        heightCm: 145 + (i % 45),
        recordNumber: `REC-${String(i).padStart(7, '0')}`,
        cpf: `${String(10000000000 + i).slice(0, 11)}`,
        clinicalUnit: unit,
        unitAcronym: unit.substring(0, 3).toUpperCase(),
        diagnosticHypothesis: i % 7 === 0 ? 'Doença de Fabry' : 'Triagem genética',
        icdCode: i % 7 === 0 ? 'E75.21' : 'Z13.7',
        hypertension: i % 2 === 0,
        obesity: i % 5 === 0,
        diabetesType1: i % 13 === 0,
        diabetesType2: i % 6 === 0,
        copd: i % 17 === 0,
        ckd: i % 11 === 0,
        smoking: i % 4 === 0,
        alcoholUse: i % 3 === 0,
        asthma: i % 9 === 0,
        antibioticUse: i % 10 === 0,
        insulinUse: i % 8 === 0,
        antiviralUse: i % 12 === 0,
        geneticVariant: i % 7 === 0 ? 'GLA337T>C, p.Ala143Thr' : null,
        alphaGal: i % 7 === 0 ? Number((Math.random() * 0.5).toFixed(3)) : null,
        lysoGb3: i % 7 === 0 ? Number((Math.random() * 12).toFixed(2)) : null,
        notes,
        status: clinicalStatus,
        consentToken: crypto.randomBytes(12).toString('hex'),
        consentTokenCreatedAt: new Date(),
        consentTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        consentNotifiedAt: new Date(),
        consentAcceptedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const quantityBase = profile === 'edge' ? 5000 + (i % 2000) : 200 + (i % 500);
      const quantity = Number((quantityBase + Math.random()).toFixed(2));
      const availableQuantity = profile === 'negative'
        ? Number((quantity * 0.05).toFixed(2))
        : i % 10 === 0
          ? Number((quantity * 0.4).toFixed(2))
          : quantity;
      const sampleStatus = availableQuantity < quantity ? 'PARTIAL' : 'AVAILABLE';
      const currentStatus = availableQuantity < quantity ? 'PartiallyWithdrawn' : 'Available';
      const sampleID = `SMP-${String(i).padStart(8, '0')}`;
      const barcode = `BR-${new Date().getFullYear()}-${String(i).padStart(8, '0')}`;

      samples.push({
        _id: sampleObjectId,
        patientID,
        sampleID,
        sampleType: pick(sampleTypesCatalog, i),
        sampleOrigin: pick(sampleOriginsCatalog, i),
        extractionProtocol: pick(extractionProtocolsCatalog, i),
        barcode,
        registrationDate: new Date(),
        registerDate: new Date(),
        withdrawalDate: null,
        quantity,
        unit: 'µL',
        quality: i % 3,
        locationID: location.locationID,
        location: {
          freezer: location.block,
          rack: location.rack,
          box: location.box,
          position: `${String.fromCharCode(65 + (i % 9))}${(i % 9) + 1}`,
          status: 'Occupied'
        },
        linkedProject: project,
        withdrawalType: null,
        withdrawalResponsible: null,
        sampleDestination: null,
        currentStatus,
        availableQuantity,
        originalQuantity: quantity,
        status: sampleStatus,
        totalWithdrawn: Number((quantity - availableQuantity).toFixed(2)),
        totalReturned: 0,
        accessionNumber: `ACC-${String(i).padStart(8, '0')}`,
        orderNumber: `ORD-${String(i).padStart(8, '0')}`,
        receivedTime: new Date(),
        processingStatus: profile === 'negative' ? 'failed' : i % 15 === 0 ? 'processing' : 'completed',
        protocolApplied: pick(extractionProtocolsCatalog, i),
        specimenCollection: {
          collector: `Coletor ${i % 20}`,
          collectedDateTime: new Date().toISOString(),
          bodySite: 'veia periférica'
        },
        linkedFiles: [`result_${sampleID}.pdf`],
        qrCode: `QR-${sampleID}`,
        storageLocation: {
          boxId: box._id,
          position: `${String.fromCharCode(65 + (i % 9))}${(i % 9) + 1}`
        },
        createdAt: new Date(),
        updatedAt: new Date()
      });

      consents.push({
        patientId: patientID,
        templateId: String(consentTemplateInsert.insertedId),
        signedAt: new Date(),
        status: 'ACTIVE',
        revokedAt: null,
        ipAddress: `10.0.${i % 255}.${(i * 7) % 255}`,
        userAgent: 'BioAvanceD/SeedRunner',
        signatureName: `Responsável ${i}`,
        signatureImageBase64: null,
        signatureMimeType: null,
        signatureHash: crypto.createHash('sha256').update(`${patientID}:${i}`).digest('hex'),
        responses: {
          uso_pesquisa: true,
          uso_comercial: profile === 'edge' ? true : i % 4 === 0,
          compartilhamento_anonimo: profile !== 'negative'
        },
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const moved = i % 10 === 0 || profile === 'negative';
      if (moved) {
        sampleMovements.push({
          movementID: movementId,
          sampleID: sampleObjectId.toString(),
          barcode,
          type: 'withdraw',
          quantity: Number(Math.max(0.01, (quantity - availableQuantity)).toFixed(2)),
          unit: 'µL',
          responsible: `Técnico ${i % 25}`,
          destination: 'Laboratório de análise',
          purpose: 'Análise molecular',
          linkedProject: project,
          condition: null,
          relatedWithdrawalID: null,
          observations: 'Retirada parcial automática do seed',
          userId: user._id?.toString?.() || null,
          userName: user.username,
          userRole: user.accessType,
          ipAddress: `10.10.${i % 255}.${(i * 3) % 255}`,
          userAgent: 'SeedRunner',
          previousQuantity: quantity,
          newQuantity: availableQuantity,
          timestamp: new Date(),
          createdAt: new Date(),
          immutable: true
        });

        withdrawals.push({
          withdrawalID: movementId,
          sampleID: sampleObjectId.toString(),
          withdrawalType: 'Parcial',
          withdrawalResponsible: `Técnico ${i % 25} Silva`,
          withdrawalDate: new Date(),
          sampleDestination: 'Laboratório de análise',
          linkedProject: project,
          quantity: Number((quantity - availableQuantity).toFixed(2)),
          notes: 'Registro automático full-seed',
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }

      results.push({
        resultID: i,
        sampleID,
        fileType: i % 4 === 0 ? 'PDF' : i % 4 === 1 ? 'CSV' : i % 4 === 2 ? 'ZIP' : 'RAW',
        resultFilePath: `/storage/results/${sampleID}.${i % 4 === 0 ? 'pdf' : i % 4 === 1 ? 'csv' : i % 4 === 2 ? 'zip' : 'raw'}`,
        filePath: `/storage/results/${sampleID}`,
        description: 'Resultado sintético para validação funcional',
        analysisType: profile === 'edge' ? 'metabolomic' : 'genomic',
        method: 'Sequenciamento NGS',
        responsibleResearcher: `Pesquisador ${i % 40}`,
        equipmentID: (i % 2) + 1,
        equipmentName: (i % 2) + 1 === 1 ? 'Ultra Freezer A' : 'Ultra Freezer B',
        fileSize: 1024 + i,
        uploadedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      });

      if (i <= 200) {
        reports.push({
          reportID: i,
          reportType: i % 2 === 0 ? 'samples' : 'patients',
          reportData: { sampleID, patientID },
          filters: { project },
          generatedAt: new Date(),
          generatedBy: user._id?.toString?.() || null,
          status: 'completed',
          filePath: `/reports/generated/report_${i}.pdf`,
          createdAt: new Date(),
          updatedAt: new Date()
        });

        accessDocs.push({
          accessID: i,
          reportID: i,
          reportType: i % 2 === 0 ? 'samples' : 'patients',
          accessType: user.accessType,
          userId: user._id?.toString?.() || null,
          grantedAt: new Date(),
          expiresAt: null,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }

      if (i <= 300) {
        sessions.push({
          sessionID: `SESS-${String(i).padStart(6, '0')}`,
          userID: user._id?.toString?.() || null,
          token: crypto.randomBytes(24).toString('hex'),
          lastActivity: new Date(),
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
          inactiveTimeout: 30 * 60 * 1000,
          isActive: true
        });
      }

      if (i <= 1000) {
        logs.push({
          logId: i,
          dateTime: new Date(),
          timestamp: new Date(),
          timestampISO: new Date().toISOString(),
          timestampFormatted: new Date().toLocaleString('pt-BR'),
          userId: user._id?.toString?.() || 'system',
          userName: user.username,
          action: i % 2 === 0 ? 'CREATE' : 'READ',
          entity: i % 2 === 0 ? 'Sample' : 'Patient',
          entityID: i % 2 === 0 ? sampleID : patientID,
          result: 'success',
          severity: profile === 'negative' ? 'warning' : 'info',
          source: 'seed',
          ipSource: `172.16.${i % 255}.${(i * 11) % 255}`,
          module: i % 2 === 0 ? 'Amostras' : 'Pacientes',
          message: 'Evento sintético de auditoria',
          payload: { patientID, sampleID },
          metadata: { run: 'full-seed' },
          createdAt: new Date()
        });
      }
    }

    await insertManyBatched(db.collection(names.patients), patients, args.batchSize);
    await insertManyBatched(db.collection(names.samples), samples, args.batchSize);
    await insertManyBatched(db.collection(names.consents), consents, args.batchSize);
    if (sampleMovements.length) await insertManyBatched(db.collection(names.sampleMovements), sampleMovements, args.batchSize);
    if (withdrawals.length) await insertManyBatched(db.collection(names.withdrawals), withdrawals, args.batchSize);
    await insertManyBatched(db.collection(names.results), results, args.batchSize);
    if (reports.length) await insertManyBatched(db.collection(names.reports), reports, args.batchSize);
    if (accessDocs.length) await insertManyBatched(db.collection(names.access), accessDocs, args.batchSize);
    if (sessions.length) await insertManyBatched(db.collection(names.sessions), sessions, args.batchSize);
    if (logs.length) await insertManyBatched(db.collection(names.logs), logs, args.batchSize);

    const sensors = Array.from({ length: 30 }).map((_, i) => ({
      sensorId: `SNS-${String(i + 1).padStart(4, '0')}`,
      sensorType: i % 2 === 0 ? 'thermocouple' : 'RTD',
      sensorModel: i % 2 === 0 ? 'HX-THERMO' : 'PT100',
      maintenanceStatus: i % 10 === 0 ? 'maintenance' : 'operational',
      lastCalibration: new Date(Date.now() - (i + 10) * 24 * 60 * 60 * 1000),
      nextCalibration: new Date(Date.now() + (90 - i) * 24 * 60 * 60 * 1000),
      calibrationCertificate: `CAL-${String(i + 1).padStart(5, '0')}`,
      locationId: pick(locations, i).locationID,
      policyId: pick(policies, i).policyId,
      createdAt: new Date(),
      updatedAt: new Date()
    }));
    await db.collection(names.sensors).insertMany(sensors, { ordered: false });

    const temperatures = Array.from({ length: args.records }).map((_, i) => {
      const sensor = pick(sensors, i);
      const policy = policies.find((p) => p.policyId === sensor.policyId) || policies[0];
      const temperatureValue = Number((policy.targetTemperature + ((i % 15) - 7) * 0.15).toFixed(2));
      return {
        logId: `TMP-${String(i + 1).padStart(8, '0')}`,
        timestamp: new Date(Date.now() - (i * 1000)),
        sensorId: sensor.sensorId,
        sensorName: sensor.sensorId,
        sensorModel: sensor.sensorModel,
        sensorType: sensor.sensorType,
        locationId: sensor.locationId,
        locationName: `Local-${sensor.locationId}`,
        facility: 'BioAvanceD Facility',
        zone: `Z${(i % 8) + 1}`,
        temperatureValue,
        temperatureUnit: '°C',
        precision: 0.1,
        minThreshold: policy.minThreshold,
        maxThreshold: policy.maxThreshold,
        targetTemperature: policy.targetTemperature,
        hysteresis: policy.hysteresis,
        alertDelay: policy.alertDelayMin,
        readingStatus: 'valid',
        sensorStatus: 'normal',
        signalQuality: 'good',
        batteryLevel: 85 - (i % 20),
        errorCode: null,
        errorMessage: null,
        lastCalibration: sensor.lastCalibration,
        nextCalibration: sensor.nextCalibration,
        calibrationCertificate: sensor.calibrationCertificate,
        maintenanceStatus: i % 50 === 0 ? 'pending' : 'ok',
        dataQualityScore: 0.98,
        operatorId: `OP-${String((i % 15) + 1).padStart(3, '0')}`,
        createdAt: new Date()
      };
    });
    await insertManyBatched(db.collection(names.temperatures), temperatures, args.batchSize);

    const alerts = Array.from({ length: 60 }).map((_, i) => ({
      alertID: i + 1,
      sensorId: pick(sensors, i).sensorId,
      status: i % 4 === 0 ? 'open' : 'resolved',
      severity: i % 5 === 0 ? 'critical' : 'warning',
      timestamp: new Date(Date.now() - i * 60000),
      message: 'Alerta sintético de temperatura',
      createdAt: new Date()
    }));
    await db.collection(names.alerts).insertMany(alerts, { ordered: false });

    const assistantDocs = Array.from({ length: 50 }).map((_, i) => ({
      assistantID: `AST-${String(i + 1).padStart(4, '0')}`,
      contextScope: i % 2 === 0 ? 'operational' : 'research',
      lastInteraction: new Date(Date.now() - i * 120000),
      prompt: 'Consulta sintética',
      response: 'Resposta sintética',
      createdAt: new Date()
    }));
    await db.collection(names.intelligentAssistant).insertMany(assistantDocs, { ordered: false });

    summary.mongo = {
      collections: names,
      inserted: {
        measurementUnits: measurementUnits.length,
        qualityDescriptions: qualityDescriptions.length,
        sampleTypes: sampleTypes.length,
        sampleOrigins: sampleOrigins.length,
        extractionProtocols: extractionProtocols.length,
        equipment: equipmentDocs.length,
        locations: locations.length,
        storageContainers: freezers.length + shelves.length + racks.length,
        storageBoxes: boxes.length,
        storagePaths: paths.length,
        policies: policies.length,
        users: users.length,
        consentTemplates: 1,
        patients: patients.length,
        samples: samples.length,
        patientConsents: consents.length,
        sampleMovements: sampleMovements.length,
        withdrawals: withdrawals.length,
        results: results.length,
        reports: reports.length,
        access: accessDocs.length,
        sessions: sessions.length,
        logs: logs.length,
        sensors: sensors.length,
        temperatures: temperatures.length,
        alerts: alerts.length,
        intelligentAssistant: assistantDocs.length
      }
    };

    if (args.enableCoverageReport) {
      const coverage = {
        patients: computeCollectionCoverage(patients),
        samples: computeCollectionCoverage(samples),
        patientConsents: computeCollectionCoverage(consents),
        sampleMovements: computeCollectionCoverage(sampleMovements),
        withdrawals: computeCollectionCoverage(withdrawals),
        results: computeCollectionCoverage(results),
        temperatures: computeCollectionCoverage(temperatures),
        sensors: computeCollectionCoverage(sensors),
        reports: computeCollectionCoverage(reports),
        access: computeCollectionCoverage(accessDocs),
        logs: computeCollectionCoverage(logs)
      };
      summary.coverage = coverage;
    }

    if (!args.skipFhir) {
      summary.fhir = await fhirSyncService.syncAllLegacyData(db, { limit: 0 });
    }

    if (!args.skipNeo4j) {
      try {
        const neoDriver = await connectNeo4j();
        const session = neoDriver.session();
        try {
          await session.run('CREATE CONSTRAINT sample_id_unique IF NOT EXISTS FOR (s:Sample) REQUIRE s.sampleID IS UNIQUE');
          await session.run('CREATE CONSTRAINT patient_id_unique IF NOT EXISTS FOR (p:Patient) REQUIRE p.patientID IS UNIQUE');

          const neoRows = samples.map((sample) => ({
            sampleID: sample.sampleID,
            patientID: sample.patientID,
            barcode: sample.barcode,
            currentStatus: sample.currentStatus,
            linkedProject: sample.linkedProject
          }));

          for (let i = 0; i < neoRows.length; i += args.batchSize) {
            const chunk = neoRows.slice(i, i + args.batchSize);
            await session.run(
              `UNWIND $rows AS row
               MERGE (p:Patient {patientID: row.patientID})
               ON CREATE SET p.createdAt = datetime()
               MERGE (s:Sample {sampleID: row.sampleID})
               SET s.barcode = row.barcode,
                   s.currentStatus = row.currentStatus,
                   s.linkedProject = row.linkedProject,
                   s.updatedAt = datetime()
               MERGE (p)-[:HAS_SAMPLE]->(s)
               MERGE (s)-[:CUSTODY_EVENT {type: 'seeded'}]->(:CustodyEvent {eventId: row.sampleID + '-seed'})`,
              { rows: chunk }
            );
          }

          summary.neo4j = { syncedSamples: samples.length, status: 'ok' };
        } finally {
          await session.close();
        }
      } catch (error) {
        summary.neo4j = { status: 'skipped_or_failed', message: error.message };
        logger.warn(`[full-seed] Neo4j não inicializado: ${error.message}`);
      }
    }

    if (!args.skipRedis) {
      try {
        const redis = redisModule.getRedisInstance ? redisModule.getRedisInstance() : redisModule;
        const redisPayload = {
          generatedAt: new Date().toISOString(),
          records: args.records,
          patients: patients.length,
          samples: samples.length,
          movements: sampleMovements.length,
          temperatures: temperatures.length
        };

        await redis.set('bioavanced:seed:last-run', JSON.stringify(redisPayload));
        await redis.hset('bioavanced:seed:counters', {
          patients: String(patients.length),
          samples: String(samples.length),
          movements: String(sampleMovements.length),
          temperatures: String(temperatures.length)
        });
        await redis.del('topology:quarantine:seed');
        await redis.rpush('topology:quarantine:seed', ...samples.slice(0, Math.min(100, samples.length)).map((s) => JSON.stringify({ sampleID: s.sampleID, barcode: s.barcode })));
        await redis.expire('topology:quarantine:seed', 3600);

        summary.redis = { status: 'ok', keys: ['bioavanced:seed:last-run', 'bioavanced:seed:counters', 'topology:quarantine:seed'] };
      } catch (error) {
        summary.redis = { status: 'skipped_or_failed', message: error.message };
        logger.warn(`[full-seed] Redis não inicializado: ${error.message}`);
      }
    }
  } finally {
    try {
      if (redisModule.closeRedisConnection) {
        await redisModule.closeRedisConnection();
      }
    } catch (_) {}

    try {
      await closeNeo4jConnection();
    } catch (_) {}

    try {
      await closeConnection();
    } catch (_) {}
  }

  summary.finishedAt = new Date().toISOString();
  summary.durationMs = new Date(summary.finishedAt).getTime() - new Date(summary.startedAt).getTime();

  const summaryPath = path.join(reportDir, `FULL_SEED_SUMMARY_${nowIsoSafe()}.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

  if (args.enableCoverageReport && summary.coverage) {
    const coveragePath = path.join(reportDir, `FULL_SEED_COVERAGE_${nowIsoSafe()}.json`);
    fs.writeFileSync(coveragePath, JSON.stringify(summary.coverage, null, 2), 'utf8');

    const mdLines = [];
    mdLines.push('# Full Seed Coverage Report');
    mdLines.push('');
    mdLines.push(`- GeneratedAt: ${new Date().toISOString()}`);
    mdLines.push(`- Records: ${args.records}`);
    mdLines.push(`- Profiles: baseline=${summary.profileDistribution.baseline}, edge=${summary.profileDistribution.edge}, negative=${summary.profileDistribution.negative}`);
    mdLines.push('');

    for (const [collection, payload] of Object.entries(summary.coverage)) {
      mdLines.push(`## ${collection}`);
      mdLines.push(`- totalDocuments: ${payload.totalDocuments}`);
      const topFields = (payload.fields || []).slice(0, 20);
      mdLines.push('| field | nonNullRate | nullishRate |');
      mdLines.push('|---|---:|---:|');
      for (const field of topFields) {
        mdLines.push(`| ${field.field} | ${field.nonNullRate}% | ${field.nullishRate}% |`);
      }
      mdLines.push('');
    }

    const coverageMdPath = path.join(reportDir, `FULL_SEED_COVERAGE_${nowIsoSafe()}.md`);
    fs.writeFileSync(coverageMdPath, mdLines.join('\n'), 'utf8');
    summary.coverageArtifacts = { coveragePath, coverageMdPath };
  }

  logger.info(`[full-seed] Seed concluído. Resumo: ${summaryPath}`);
  console.log(JSON.stringify({ ok: true, summaryPath, summary }, null, 2));
}

main().catch((error) => {
  logger.error(`[full-seed] Falha: ${error.message}`);
  console.error(error);
  process.exit(1);
});
