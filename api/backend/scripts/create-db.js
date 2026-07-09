require('dotenv').config();
const { connectNewDB, closeConnection } = require('../src/database/mongo');
const { CANONICAL_COLLECTIONS } = require('../src/config/collections');
const logger = require('../src/utils/logger');

const COLLECTIONS = [
  {
    name: 'users',
    indexes: [{ email: 1 }, { username: 1 }, { accessType: 1 }, { status: 1 }],
    description: 'Usuarios do sistema',
  },
  {
    name: CANONICAL_COLLECTIONS.patients,
    indexes: [{ participantId: 1 }, { patientNameNormalized: 1, birthDateKey: 1 }, { createdAt: 1 }],
    description: 'Pacientes canonicos',
  },
  {
    name: CANONICAL_COLLECTIONS.samples,
    indexes: [{ specimenId: 1 }, { participantId: 1 }, { barcode: 1 }, { locationID: 1 }, { createdAt: 1 }],
    description: 'Amostras canonicas',
  },
  {
    name: CANONICAL_COLLECTIONS.consents,
    indexes: [{ participantId: 1, status: 1 }, { templateId: 1 }, { createdAt: 1 }],
    description: 'Consentimentos de pacientes',
  },
  {
    name: CANONICAL_COLLECTIONS.consentTemplates,
    indexes: [{ active: 1 }, { version: 1 }, { createdAt: 1 }],
    description: 'Templates de TCLE',
  },
  {
    name: CANONICAL_COLLECTIONS.sampleMovements,
    indexes: [{ specimenId: 1, timestamp: -1 }, { barcode: 1, timestamp: -1 }, { movementID: 1 }],
    description: 'Ledger de movimentacoes de amostras',
  },
  {
    name: CANONICAL_COLLECTIONS.biomarkerObservations,
    indexes: [{ participantId: 1, biomarkerType: 1, collectedAt: -1 }, { idempotencyKey: 1 }],
    description: 'Observacoes de biomarcadores',
  },
  {
    name: CANONICAL_COLLECTIONS.cids,
    indexes: [{ code: 1 }, { codigo: 1 }, { descricao: 1 }],
    description: 'CID/terminologias clinicas',
  },
  {
    name: CANONICAL_COLLECTIONS.clinicalUnits,
    indexes: [{ unitID: 1 }, { name: 1 }, { active: 1 }],
    description: 'Unidades clinicas',
  },
  {
    name: CANONICAL_COLLECTIONS.diseaseDictionary,
    indexes: [{ orpha_code: 1 }, { disease_category: 1 }, { active: 1 }],
    description: 'Regras essenciais de doencas',
  },
  {
    name: CANONICAL_COLLECTIONS.medicationDictionary,
    indexes: [{ atc_code: 1 }, { name: 1 }, { disease_categories: 1 }],
    description: 'Dicionario essencial de medicamentos',
  },
  {
    name: 'roles',
    indexes: [{ accessType: 1 }],
    description: 'Roles e permissoes',
  },
  {
    name: 'terminologies',
    indexes: [{ sistema: 1, codigo: 1 }, { label: 1 }],
    description: 'Terminologias SPREC/HPO minimas',
  },
  {
    name: 'referenceSeedRuns',
    indexes: [{ key: 1 }, { version: 1 }, { executedAt: -1 }, { checksum: 1 }],
    description: 'Execucoes do seed essencial de referencia',
  },
  {
    name: 'sampleTypes',
    indexes: [{ id: 1 }],
    description: 'MIABIS sample types',
  },
  {
    name: 'sampleOrigins',
    indexes: [{ id: 1 }],
    description: 'MIABIS sample origins',
  },
  {
    name: 'extractionProtocols',
    indexes: [{ id: 1 }],
    description: 'MIABIS extraction protocols',
  },
  {
    name: 'qualityDescriptions',
    indexes: [{ id: 1 }],
    description: 'MIABIS quality descriptions',
  },
];

async function createDatabase() {
  try {
    logger.info('Iniciando criacao/verificacao do banco canonico...');
    const db = await connectNewDB();

    for (const collectionConfig of COLLECTIONS) {
      const collection = db.collection(collectionConfig.name);
      for (const index of collectionConfig.indexes) {
        await collection.createIndex(index);
      }
      logger.info(`Colecao canonica verificada: ${collectionConfig.name} - ${collectionConfig.description}`);
    }

    logger.info(`Banco canonico verificado com sucesso. Colecoes: ${COLLECTIONS.length}`);
    await closeConnection();
    process.exit(0);
  } catch (error) {
    logger.error('Erro ao criar/verificar banco canonico:', error.message);
    await closeConnection().catch(() => {});
    process.exit(1);
  }
}

createDatabase();
