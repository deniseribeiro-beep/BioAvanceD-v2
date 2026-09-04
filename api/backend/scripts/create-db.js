require('dotenv').config();
const { connectNewDB, closeConnection } = require('../src/database/mongo');
const { CANONICAL_COLLECTIONS } = require('../src/config/collections');
const logger = require('../src/utils/logger');

const COLLECTIONS = [
  {
    name: 'users',
    indexes: [{ status: 1 }],
    description: 'Usuarios do sistema',
  },
  {
    name: CANONICAL_COLLECTIONS.patients,
    indexes: [{ participantId: 1 }, { createdAt: 1 }],
    description: 'Pacientes canonicos',
  },
  {
    name: CANONICAL_COLLECTIONS.samples,
    indexes: [{ specimenId: 1 }, { participantId: 1 }, { locationID: 1 }, { createdAt: 1 }],
    description: 'Amostras canonicas',
  },
  {
    // #983: {templateId:1} renamed to {consentTemplateId:1} -- PatientConsent.js
    // writes consentTemplateId; nothing writes templateId. Correction, not a typo.
    name: CANONICAL_COLLECTIONS.consents,
    indexes: [{ participantId: 1, status: 1 }, { consentTemplateId: 1 }, { createdAt: 1 }],
    description: 'Consentimentos de pacientes',
  },
  {
    name: CANONICAL_COLLECTIONS.consentTemplates,
    indexes: [{ active: 1 }, { version: 1 }, { createdAt: 1 }],
    description: 'Templates de TCLE',
  },
  {
    name: CANONICAL_COLLECTIONS.medicationDictionary,
    indexes: [{ name: 1 }],
    description: 'Dicionario essencial de medicamentos',
  },
  {
    // #983: {accessType:1} renamed to {roleCode:1} -- nothing persists
    // accessType on a role; rbac-catalog-seed.service.js upserts on
    // {roleCode}. Correction, not a typo.
    name: 'roles',
    indexes: [{ roleCode: 1 }],
    description: 'Roles e permissoes',
  },
  {
    name: 'terminologies',
    indexes: [{ sistema: 1, code: 1 }, { label: 1 }],
    description: 'Terminologias SPREC/HPO minimas',
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

// #983: six entries removed entirely -- every declaration in each duplicated
// a key already built elsewhere in NAMED, option-bearing form, or named a
// field no document ever carries. db.collection(name) is lazy, so an entry
// with an empty indexes array would only log a line; removing the entry is
// equivalent and shorter. Owners, for the next reader:
//   - sample_movements: src/utils/sampleMovementLedger.js (ensureSampleMovementIndexes)
//   - biomarker_observations: src/services/biomarker-observation.service.js (ensureIndexes)
//   - cids: src/services/cid.service.js (ensureIndexes)
//   - clinical_units: retired collection; migrateClinicalUnitOrganizations.js is the
//     only remaining reader, and unitID never existed on ClinicalUnit.js
//   - disease_dictionary: src/scripts/seedDiseaseValidationRules.js
//   - referenceSeedRuns: nothing in the tree writes to this collection; run
//     records now live on FoundationDataRun (src/models/FoundationDataRun.js)
// Two more entries survive but with keys dropped in favor of an outside owner:
//   - users: {email:1}/{username:1} dropped -- src/scripts/createFirstAdmin.js:45-46
//     builds both, unique:true. {accessType:1} dropped -- no longer persisted
//     on a user; the level is resolved per request from the role assignment.
//   - samples: {barcode:1} dropped -- src/utils/sampleIndexes.js builds
//     samples_barcode_unique_v1, unique with a partial filter.

async function createDatabase() {
  try {
    logger.info('Iniciando criacao/verificacao do banco canonico...');
    const db = await connectNewDB();

    // #1027: cada createIndex tem o seu proprio catch. Antes, um unico
    // indice em conflito derrubava o script inteiro pelo catch externo,
    // e como `users` e COLLECTIONS[0] e `email` e o seu primeiro indice,
    // isso acontecia na PRIMEIRA chamada em qualquer banco onde o
    // bootstrap de administrador ja tinha rodado -- ou seja, em todo
    // stack utilizavel. [ran it] mongo:7, com createFirstAdmin.js:45-46
    // aplicado antes: IndexKeySpecsConflict (86), exit 1, e NENHUMA das
    // 18 colecoes criada.
    //
    // A causa e que :107 chama createIndex com UM argumento, entao as 46
    // declaracoes deste arquivo sao todas SEM NOME -- e um indice sem nome
    // colide com qualquer outro dono que tambem nao nomeie o seu e declare
    // opcoes diferentes. `users.{email,username}` e o unico par nessas
    // condicoes hoje (os outros donos nomeiam os seus), mas o catch por
    // indice vale para a classe, nao so para esse par.
    //
    // Falhar um indice nao e fatal: o outro dono ja construiu uma versao
    // MAIS restritiva (unique). O que era inaceitavel era uma colecao
    // impedir as outras dezessete. Mesmo formato dos onze helpers
    // ensureIndexes escritos a mao deste repo, que registram e seguem.
    let indexesBuilt = 0;
    const indexFailures = [];

    for (const collectionConfig of COLLECTIONS) {
      const collection = db.collection(collectionConfig.name);
      for (const index of collectionConfig.indexes) {
        try {
          await collection.createIndex(index);
          indexesBuilt += 1;
        } catch (indexError) {
          indexFailures.push(`${collectionConfig.name} ${JSON.stringify(index)}: ${indexError.message}`);
          logger.warn(`Indice nao criado em ${collectionConfig.name} ${JSON.stringify(index)}: ${indexError.message}`);
        }
      }
      logger.info(`Colecao canonica verificada: ${collectionConfig.name} - ${collectionConfig.description}`);
    }

    logger.info(`Banco canonico verificado. Colecoes: ${COLLECTIONS.length}, indices criados: ${indexesBuilt}, ignorados: ${indexFailures.length}`);
    if (indexFailures.length > 0) {
      // Resumo no fim: os warns individuais ficam soterrados por 18 linhas
      // de "Colecao canonica verificada" e o operador nao os ve.
      logger.warn(`Indices ignorados (${indexFailures.length}): ${indexFailures.join(" | ")}`);
    }
    await closeConnection();
    process.exit(0);
  } catch (error) {
    logger.error('Erro ao criar/verificar banco canonico:', error.message);
    await closeConnection().catch(() => {});
    process.exit(1);
  }
}

createDatabase();
