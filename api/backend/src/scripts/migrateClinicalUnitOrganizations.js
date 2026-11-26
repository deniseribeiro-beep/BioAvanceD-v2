/**
 * Script de Migração (issue #352, split from #351): resolve Patient.clinicalUnit/
 * clinicalUnitId (texto livre, ou ObjectId legado contra a coleção clinicalUnits)
 * em referências a Organization (P1X-0356), e reescreve os documentos de Patient
 * com clinicalUnitId apontando para Organization.organizationId.
 *
 * Pré-requisito para retirar a coleção/rotas legadas de clinicalUnits (#352):
 * enquanto houver dados de produção referenciando clinicalUnits por ObjectId,
 * a coleção não pode ser removida. Este script não altera nenhum código de
 * runtime (service/controller/routes) — apenas os dados.
 *
 * One-way: sem rollback. Sobrescreve `clinicalUnitId`, `clinicalUnit` e
 * `unitAcronym` do Patient sem guardar o valor anterior: o ObjectId de
 * clinicalUnits se perde, e o texto livre só sobrevive como `officialName` de
 * uma Organization que o próprio run criou (aparado, e só a primeira grafia de
 * cada nome normalizado; um nome que casou com Organization existente não
 * deixa rastro). As Organizations que cria não se distinguem das criadas
 * depois. Desfazer é restaurar patients e organizations de um backup.
 *
 * Uso: node backend/src/scripts/migrateClinicalUnitOrganizations.js
 */

const { MongoClient, ObjectId } = require('mongodb');
const OrganizationModel = require('../models/Organization');
const ClinicalUnitModel = require('../models/ClinicalUnit');
const { CANONICAL_COLLECTIONS } = require('../config/collections');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

async function migrateClinicalUnitOrganizations() {
  let client;

  try {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    const dbName = process.env.MONGODB_DB_NAME || process.env.MONGO_DB || process.env.MONGO_DB_NOVO || 'bioadvanced';

    if (!mongoUri) {
      console.error('Variáveis de ambiente disponíveis:', Object.keys(process.env).filter(k => k.includes('MONGO')));
      throw new Error('MONGODB_URI ou MONGO_URI não encontrada nas variáveis de ambiente. Verifique o arquivo .env');
    }

    console.log(`Conectando ao MongoDB: ${mongoUri.replace(/\/\/.*@/, '//***:***@')} (${dbName})`);

    client = new MongoClient(mongoUri);
    await client.connect();
    console.log('Conectado ao MongoDB');

    const db = client.db(dbName);
    const patientsCollection = db.collection(CANONICAL_COLLECTIONS.patients);
    const clinicalUnitsCollection = db.collection(CANONICAL_COLLECTIONS.clinicalUnits);
    const organizationsCollection = db.collection(CANONICAL_COLLECTIONS.organizations);

    const patientsToMigrate = await patientsCollection.find({
      $or: [
        { clinicalUnitId: { $exists: true, $ne: null } },
        { clinicalUnit: { $exists: true, $ne: null } }
      ]
    }).toArray();

    console.log(`Encontrados ${patientsToMigrate.length} pacientes com clinicalUnitId/clinicalUnit`);

    // Pré-carrega organizações já existentes para deduplicar por normalizedName,
    // e um índice por organizationId para detectar registros já migrados.
    const normalizedNameToOrg = new Map();
    const organizationIdSet = new Set();
    const existingOrganizations = await organizationsCollection.find({}).toArray();
    for (const org of existingOrganizations) {
      if (org.normalizedName) {
        normalizedNameToOrg.set(org.normalizedName, org);
      }
      organizationIdSet.add(org.organizationId);
    }

    // Pré-carrega clinicalUnits legadas para resolver o ObjectId original.
    const legacyUnitsById = new Map();
    const legacyUnits = await clinicalUnitsCollection.find({}).toArray();
    for (const unit of legacyUnits) {
      legacyUnitsById.set(unit._id.toString(), unit);
    }

    let organizationsCreated = 0;

    async function resolveOrganizationByName(rawName, acronymHint) {
      const trimmed = String(rawName || '').trim();
      if (!trimmed) {
        return null;
      }

      const normalizedName = OrganizationModel.normalizeName(trimmed);
      const existing = normalizedNameToOrg.get(normalizedName);
      if (existing) {
        return existing;
      }

      const organization = OrganizationModel.create({
        officialName: trimmed,
        countryCode: 'BR',
        acronym: acronymHint || ClinicalUnitModel.fillAcronym(trimmed)
      });
      await organizationsCollection.insertOne(organization);
      normalizedNameToOrg.set(normalizedName, organization);
      organizationIdSet.add(organization.organizationId);
      organizationsCreated += 1;

      return organization;
    }

    let patientsUpdated = 0;

    for (const patient of patientsToMigrate) {
      const rawClinicalUnitId = patient.clinicalUnitId;
      const rawClinicalUnitName = patient.clinicalUnit;

      // Já migrado: clinicalUnitId aponta para uma Organization existente.
      if (rawClinicalUnitId && organizationIdSet.has(rawClinicalUnitId)) {
        continue;
      }

      let organization = null;

      if (rawClinicalUnitId && ObjectId.isValid(String(rawClinicalUnitId))) {
        const legacyUnit = legacyUnitsById.get(String(rawClinicalUnitId));
        if (legacyUnit) {
          organization = await resolveOrganizationByName(legacyUnit.name, legacyUnit.acronym);
        }
      }

      if (!organization && rawClinicalUnitName) {
        organization = await resolveOrganizationByName(rawClinicalUnitName);
      }

      if (!organization) {
        continue;
      }

      await patientsCollection.updateOne(
        { _id: patient._id },
        {
          $set: {
            clinicalUnitId: organization.organizationId,
            clinicalUnit: organization.officialName,
            unitAcronym: organization.acronym
          }
        }
      );

      patientsUpdated += 1;
      console.log(`Migrado paciente ${patient._id.toString()}: clinicalUnitId=${organization.organizationId}`);
    }

    console.log(`\nMigração concluída! ${patientsUpdated} pacientes atualizados, ${organizationsCreated} organizações criadas.`);

    return { patientsUpdated, organizationsCreated };
  } catch (error) {
    console.error('Erro na migração:', error);
    throw error;
  } finally {
    if (client) {
      await client.close();
      console.log('Conexão fechada');
    }
  }
}

if (require.main === module) {
  migrateClinicalUnitOrganizations()
    .then(() => {
      console.log('Migração finalizada com sucesso');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Erro na migração:', error);
      process.exit(1);
    });
}

module.exports = { migrateClinicalUnitOrganizations };
