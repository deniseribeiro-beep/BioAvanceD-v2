/**
 * Script de Migração (issue #347): resolve User.institution/institutionalScope
 * (texto livre) em referências a Organization (#346), e reescreve os
 * documentos de User com organizationId/organizationIds.
 *
 * Corte definitivo (sem produção implantada ainda, decisão do Dennis em #347):
 * institution/institutionalScope são removidos do documento após a reescrita,
 * não mantidos como alias legado.
 *
 * One-way: sem rollback. O run remove institution e institutionalScope
 * depois de reescrever (corte definitivo, já dito acima), e os textos livres
 * não são guardados no User: só sobrevivem como officialName de uma
 * Organization que o próprio run criou (aparado, só a primeira grafia de cada
 * nome normalizado; um nome que casou com Organization existente, ou um
 * vazio, não deixa rastro), e essas Organizations não se distinguem das
 * criadas depois. Desfazer é restaurar users e organizations de um backup.
 *
 * Uso: node backend/src/scripts/migrateUserOrganizations.js
 */

const { MongoClient } = require('mongodb');
const OrganizationModel = require('../models/Organization');
const { CANONICAL_COLLECTIONS } = require('../config/collections');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

async function migrateUserOrganizations() {
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
    const usersCollection = db.collection('users');
    const organizationsCollection = db.collection(CANONICAL_COLLECTIONS.organizations);

    const usersToMigrate = await usersCollection.find({
      $or: [
        { institution: { $exists: true, $ne: null } },
        { institutionalScope: { $exists: true, $ne: null } }
      ]
    }).toArray();

    console.log(`Encontrados ${usersToMigrate.length} usuários com institution/institutionalScope`);

    // Pré-carrega organizações já existentes para deduplicar por normalizedName.
    const normalizedNameToId = new Map();
    const existingOrganizations = await organizationsCollection.find({}).toArray();
    for (const org of existingOrganizations) {
      if (org.normalizedName) {
        normalizedNameToId.set(org.normalizedName, org.organizationId);
      }
    }

    let organizationsCreated = 0;

    async function resolveOrganization(rawName) {
      const trimmed = String(rawName || '').trim();
      if (!trimmed) {
        return null;
      }

      const normalizedName = OrganizationModel.normalizeName(trimmed);
      if (normalizedNameToId.has(normalizedName)) {
        return normalizedNameToId.get(normalizedName);
      }

      const organization = OrganizationModel.create({ officialName: trimmed, countryCode: 'BR' });
      await organizationsCollection.insertOne(organization);
      normalizedNameToId.set(normalizedName, organization.organizationId);
      organizationsCreated += 1;

      return organization.organizationId;
    }

    let usersUpdated = 0;

    for (const user of usersToMigrate) {
      const organizationId = user.institution ? await resolveOrganization(user.institution) : null;

      const organizationIds = [];
      if (Array.isArray(user.institutionalScope)) {
        for (const scopeName of user.institutionalScope) {
          const resolvedId = await resolveOrganization(scopeName);
          if (resolvedId && !organizationIds.includes(resolvedId)) {
            organizationIds.push(resolvedId);
          }
        }
      }

      await usersCollection.updateOne(
        { _id: user._id },
        {
          $set: { organizationId, organizationIds },
          $unset: { institution: '', institutionalScope: '' }
        }
      );

      usersUpdated += 1;
      console.log(`Migrado usuário ${user._id.toString()}: organizationId=${organizationId}, organizationIds=${organizationIds.length}`);
    }

    console.log(`\nMigração concluída! ${usersUpdated} usuários atualizados, ${organizationsCreated} organizações criadas.`);

    return { usersUpdated, organizationsCreated };
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
  migrateUserOrganizations()
    .then(() => {
      console.log('Migração finalizada com sucesso');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Erro na migração:', error);
      process.exit(1);
    });
}

module.exports = { migrateUserOrganizations };
