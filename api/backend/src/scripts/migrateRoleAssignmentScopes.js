/**
 * Script de Migração (issue #615): backfills existing UserRoleAssignment
 * docs created before this slice, which all carry scopeType:'global'
 * (rbac-assignment.service.js's grant paths hardcoded it) regardless of
 * role. Non-Administrador (hierarchyLevel !== 4) assignments should be
 * scopeType:'organization', scoped to the assigned user's organizationId
 * (falling back to organizationIds[0], same precedence as
 * migrateUserOrganizations.js's output fields).
 *
 * Idempotent via the query filter: once an assignment's scopeType flips to
 * 'organization' it no longer matches the candidate query, so a rerun is a
 * no-op for it — same convention as migrateUserOrganizations.js's
 * $unset-driven idempotency, no explicit "already migrated" flag.
 *
 * One-way: no rollback. The run sets scopeType 'organization' and a scopeId
 * on each non-Administrador assignment that was global, without storing that
 * it was global (the console line per assignmentId is not kept), so an
 * assignment granted organization-scoped since cannot be told apart, and
 * setting them back to global would widen each user's access to every
 * organization. Undo is restoring userRoleAssignments from a backup.
 *
 * Uso: node backend/src/scripts/migrateRoleAssignmentScopes.js
 */

const { MongoClient, ObjectId } = require('mongodb');
const { CANONICAL_COLLECTIONS } = require('../config/collections');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

async function migrateRoleAssignmentScopes() {
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
    const rolesCollection = db.collection(CANONICAL_COLLECTIONS.roles);
    const assignmentsCollection = db.collection(CANONICAL_COLLECTIONS.userRoleAssignments);
    const organizationsCollection = db.collection(CANONICAL_COLLECTIONS.organizations);

    const roleDocs = await rolesCollection.find({}).toArray();
    const nonAdminRoleIds = roleDocs.filter((role) => Number(role.hierarchyLevel) !== 4).map((role) => role.roleId);

    // No assignmentStatus filter — also corrects historical
    // revoked/expired/suspended docs for data hygiene; resolveUserOrganizationScope
    // only ever reads active ones, so this isn't required for correctness.
    const candidates = await assignmentsCollection.find({
      scopeType: 'global',
      roleId: { $in: nonAdminRoleIds },
    }).toArray();

    console.log(`Encontradas ${candidates.length} assignments não-admin com scopeType 'global'`);

    let assignmentsUpdated = 0;
    let assignmentsWithNullScope = 0;
    let assignmentsWithInvalidOrganizationId = 0;
    let usersNotFound = 0;

    for (const assignment of candidates) {
      const rawUserAccountId = String(assignment.userAccountId || '');
      let user = null;
      if (ObjectId.isValid(rawUserAccountId)) {
        user = await usersCollection.findOne({ _id: new ObjectId(rawUserAccountId) });
      }
      if (!user) {
        user = await usersCollection.findOne({ _id: rawUserAccountId });
      }

      if (!user) {
        usersNotFound += 1;
        console.log(`Assignment ${assignment.assignmentId}: usuário ${rawUserAccountId} não encontrado, pulando.`);
        continue;
      }

      let scopeId = user.organizationId
        || (Array.isArray(user.organizationIds) ? user.organizationIds[0] : null)
        || null;

      // #627: this script writes scopeId via raw Mongo, bypassing
      // rbac-assignment.service.js's #622 validateOrganizationId check
      // entirely — same referential check inlined here so a stale/typo'd
      // organizationId on the user doc doesn't get carried into scopeId.
      if (scopeId) {
        const organization = await organizationsCollection.findOne({ organizationId: scopeId });
        if (!organization) {
          console.log(`Assignment ${assignment.assignmentId}: organizationId ${scopeId} não corresponde a uma Organization real, gravando scopeId null.`);
          assignmentsWithInvalidOrganizationId += 1;
          scopeId = null;
        }
      }

      if (!scopeId) {
        assignmentsWithNullScope += 1;
      }

      await assignmentsCollection.updateOne(
        { assignmentId: assignment.assignmentId },
        { $set: { scopeType: 'organization', scopeId } }
      );
      assignmentsUpdated += 1;
      console.log(`Assignment ${assignment.assignmentId} (usuário ${rawUserAccountId}): scopeType=organization, scopeId=${scopeId}`);
    }

    console.log(`\nMigração concluída! ${assignmentsUpdated} assignments atualizadas, ${assignmentsWithNullScope} sem organizationId resolvível (${assignmentsWithInvalidOrganizationId} por organizationId inválido), ${usersNotFound} usuários não encontrados.`);

    return { assignmentsUpdated, assignmentsWithNullScope, assignmentsWithInvalidOrganizationId, usersNotFound };
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
  migrateRoleAssignmentScopes()
    .then(() => {
      console.log('Migração finalizada com sucesso');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Erro na migração:', error);
      process.exit(1);
    });
}

module.exports = { migrateRoleAssignmentScopes };
