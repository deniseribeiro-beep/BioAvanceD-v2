/**
 * G13 — Product Terms/Privacy (≠ research TCLE).
 * Versioned documents + per-user acceptance records.
 */

const COLLECTION_DOCS = 'productLegalDocuments';
const COLLECTION_ACCEPTANCES = 'productLegalAcceptances';

const DOC_TYPES = ['terms', 'privacy'];
const DEFAULT_VERSION = '2.1.0';

const DEFAULT_CONTENT = {
  terms: {
    title: 'Termos de uso do BioAvanceD',
    body: [
      'Estes termos regem o uso operacional da plataforma BioAvanceD pelo seu tenant.',
      'O acesso é concedido por convite do administrador do tenant; credenciais são pessoais e intransferíveis.',
      'O operador deve utilizar o sistema conforme políticas internas de qualidade, LGPD e ética em pesquisa.',
      'O TCLE de pesquisa (consentimento de participante) é documento distinto, gerenciado no construtor de TCLE e nos fluxos de e-consent — não substitui estes Termos.',
      'O fornecedor pode publicar nova versão destes Termos; o aceite atualizado será solicitado no próximo login.',
    ].join('\n\n'),
  },
  privacy: {
    title: 'Política de privacidade e uso de dados',
    body: [
      'Esta política descreve como dados pessoais e operacionais são tratados na plataforma BioAvanceD.',
      'Dados de participantes de pesquisa seguem finalidade, base legal e retenção definidos na coleta e no TCLE correspondente.',
      'Logs de auditoria registram ações sensíveis (quem, quando, contexto) para conformidade e investigação.',
      'Credenciais, MFA e sessões são protegidas conforme configuração de segurança do tenant.',
      'Dúvidas ou solicitações LGPD devem ser encaminhadas ao administrador do tenant.',
    ].join('\n\n'),
  },
};

function resolveTenantId(user) {
  if (!user) return 'default';
  if (user.organizationId) return String(user.organizationId);
  if (Array.isArray(user.organizationIds) && user.organizationIds.length > 0) {
    return String(user.organizationIds[0]);
  }
  return 'default';
}

function normalizeDocType(value) {
  const docType = String(value || '').trim().toLowerCase();
  if (!DOC_TYPES.includes(docType)) {
    const error = new Error('docType inválido');
    error.status = 400;
    throw error;
  }
  return docType;
}

async function ensureIndexes(db) {
  await db.collection(COLLECTION_DOCS).createIndex({ docType: 1, docVersion: 1 }, { unique: true });
  await db.collection(COLLECTION_DOCS).createIndex({ docType: 1, publishedAt: -1 });
  await db.collection(COLLECTION_ACCEPTANCES).createIndex(
    { userId: 1, tenantId: 1, docType: 1, docVersion: 1 },
    { unique: true }
  );
  await db.collection(COLLECTION_ACCEPTANCES).createIndex({ userId: 1, tenantId: 1, docType: 1, acceptedAt: -1 });
}

async function seedDefaults(db) {
  const docs = db.collection(COLLECTION_DOCS);
  for (const docType of DOC_TYPES) {
    const existing = await docs.findOne({ docType, docVersion: DEFAULT_VERSION });
    if (existing) continue;
    const defaults = DEFAULT_CONTENT[docType];
    await docs.insertOne({
      docType,
      docVersion: DEFAULT_VERSION,
      title: defaults.title,
      body: defaults.body,
      publishedAt: new Date(),
      publishedBy: 'system',
    });
  }
}

async function getPublishedDocument(db, docType) {
  const normalized = normalizeDocType(docType);
  const doc = await db.collection(COLLECTION_DOCS).find({ docType: normalized }).sort({ publishedAt: -1 }).limit(1).next();
  return doc || null;
}

async function listPendingForUser(db, user, userId) {
  const tenantId = resolveTenantId(user);
  const pending = [];
  for (const docType of DOC_TYPES) {
    const published = await getPublishedDocument(db, docType);
    if (!published) continue;
    const accepted = await db.collection(COLLECTION_ACCEPTANCES).findOne({
      userId: String(userId),
      tenantId,
      docType,
      docVersion: published.docVersion,
    });
    if (!accepted) {
      pending.push({
        docType,
        docVersion: published.docVersion,
        title: published.title,
      });
    }
  }
  return { tenantId, pending };
}

async function recordAcceptance(db, { user, userId, docType, docVersion, ip, userAgent }) {
  const normalizedType = normalizeDocType(docType);
  const published = await getPublishedDocument(db, normalizedType);
  if (!published || published.docVersion !== String(docVersion)) {
    const error = new Error('Versão do documento não está publicada');
    error.status = 409;
    throw error;
  }

  const tenantId = resolveTenantId(user);
  const record = {
    userId: String(userId),
    tenantId,
    docType: normalizedType,
    docVersion: published.docVersion,
    timestamp: new Date(),
    acceptedAt: new Date(),
    ip: ip || null,
    userAgent: userAgent || null,
  };

  await db.collection(COLLECTION_ACCEPTANCES).updateOne(
    { userId: record.userId, tenantId, docType: normalizedType, docVersion: published.docVersion },
    { $set: record },
    { upsert: true }
  );

  return record;
}

async function publishDocument(db, { docType, docVersion, title, body, publishedBy }) {
  const normalizedType = normalizeDocType(docType);
  const version = String(docVersion || '').trim();
  if (!version) {
    const error = new Error('docVersion é obrigatório');
    error.status = 400;
    throw error;
  }
  const payload = {
    docType: normalizedType,
    docVersion: version,
    title: String(title || DEFAULT_CONTENT[normalizedType].title).trim(),
    body: String(body || '').trim() || DEFAULT_CONTENT[normalizedType].body,
    publishedAt: new Date(),
    publishedBy: publishedBy || 'admin',
  };

  await db.collection(COLLECTION_DOCS).updateOne(
    { docType: normalizedType, docVersion: version },
    { $set: payload },
    { upsert: true }
  );

  return payload;
}

module.exports = {
  COLLECTION_DOCS,
  COLLECTION_ACCEPTANCES,
  DOC_TYPES,
  DEFAULT_VERSION,
  ensureIndexes,
  seedDefaults,
  resolveTenantId,
  getPublishedDocument,
  listPendingForUser,
  recordAcceptance,
  publishDocument,
};