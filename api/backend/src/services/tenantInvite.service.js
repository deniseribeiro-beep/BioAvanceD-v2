/**
 * Tenant operator invite / activation (ADR 2026-11-26-access-tenant-only-identity).
 * Subsequent operators join via invite link — not direct password registration by admin.
 */
const crypto = require('crypto');
const authService = require('./auth.service');
const { hashToken } = require('../utils/tokenHash');
const rbacAssignment = require('./rbac-assignment.service');

const COLLECTION = 'tenant_invites';
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function inviteTtlMs() {
  const days = Number(process.env.TENANT_INVITE_TTL_DAYS || 7);
  if (!Number.isFinite(days) || days < 1 || days > 90) return DEFAULT_TTL_MS;
  return days * 24 * 60 * 60 * 1000;
}

async function ensureIndexes(db) {
  const col = db.collection(COLLECTION);
  await col.createIndex({ tokenHash: 1 }, { unique: true });
  await col.createIndex({ email: 1, status: 1 });
  await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { status: 'pending' } });
}

function generateRawToken() {
  return crypto.randomBytes(32).toString('hex');
}

function buildInviteLink(rawToken, req) {
  const header = (name) => (req && typeof req.get === 'function' ? req.get(name) : undefined);
  const forwardedHost = header('x-forwarded-host') || header('host');
  const forwardedProto = header('x-forwarded-proto') || (req && req.protocol) || 'http';
  const publicOrigin = forwardedHost
    ? `${String(forwardedProto).split(',')[0].trim()}://${String(forwardedHost).split(',')[0].trim()}`
    : (process.env.FRONTEND_URL || 'http://localhost:5173');
  return `${publicOrigin}/invite/accept?token=${encodeURIComponent(rawToken)}`;
}

function normalizeInvitePayload(body, organizationScope) {
  const email = String(body.email || '').trim().toLowerCase();
  const username = String(body.username || '').trim();
  const name = String(body.displayName || body.name || '').trim();
  let organizationId = body.organizationId;
  if (organizationId !== undefined && organizationId !== null) {
    organizationId = String(organizationId).trim() || null;
  }
  if (organizationScope && organizationScope.scope !== 'global') {
    organizationId = rbacAssignment.resolveOrganizationIdForCreate(organizationScope, organizationId);
  }
  let accessType = body.accessType;
  if (body.roleName && accessType === undefined) {
    accessType = authService.getAccessTypeForRole(body.roleName);
  }
  accessType = Number(accessType || 2);
  const roleName = body.roleName || null;
  let phone = body.phone;
  if (phone !== undefined && phone !== null && typeof phone === 'string') {
    const digits = phone.replace(/\D/g, '');
    phone = digits.length > 0 ? digits : null;
  } else {
    phone = null;
  }
  return { email, username, name, organizationId, accessType, roleName, phone };
}

/**
 * @param {import('mongodb').Db} db
 * @param {object} opts
 * @param {object} opts.payload - invite fields from admin form
 * @param {string} opts.createdBy - caller userID
 * @param {object} [opts.organizationScope]
 * @param {object} [opts.req] - for public invite link origin
 */
async function createInvite(db, { payload, createdBy, organizationScope, req }) {
  if (!createdBy) {
    const err = new Error('createdBy é obrigatório');
    err.statusCode = 500;
    throw err;
  }
  await ensureIndexes(db);

  const normalized = normalizeInvitePayload(payload, organizationScope);
  if (!normalized.email || !normalized.username || !normalized.name) {
    const err = new Error('name, email e username são obrigatórios para o convite');
    err.statusCode = 422;
    err.details = ['name, email e username são obrigatórios para o convite'];
    throw err;
  }
  if (!normalized.roleName && !payload.accessType) {
    const err = new Error('roleName ou accessType é obrigatório');
    err.statusCode = 422;
    throw err;
  }

  const callerLevel = await rbacAssignment.resolveUserHierarchyLevel(db, createdBy);
  if (Number(normalized.accessType) > Number(callerLevel || 0)) {
    const err = new Error('Não é possível convidar um usuário com nível de acesso superior ao seu.');
    err.statusCode = 403;
    throw err;
  }

  if (normalized.organizationId) {
    const organization = await db.collection('organizations').findOne({ organizationId: String(normalized.organizationId) });
    if (!organization) {
      throw new Error(`organizationId ${normalized.organizationId} não encontrado`);
    }
  }

  const users = db.collection('users');
  const existingUser = await users.findOne({
    $or: [{ email: normalized.email }, { username: normalized.username }],
  });
  if (existingUser) {
    const err = new Error('Email ou username já cadastrado');
    err.statusCode = 409;
    throw err;
  }

  const invites = db.collection(COLLECTION);
  const pendingDup = await invites.findOne({ email: normalized.email, status: 'pending' });
  if (pendingDup) {
    const err = new Error('Já existe um convite pendente para este e-mail');
    err.statusCode = 409;
    throw err;
  }

  const rawToken = generateRawToken();
  const now = new Date();
  const doc = {
    tokenHash: hashToken(rawToken),
    email: normalized.email,
    username: normalized.username,
    displayName: normalized.name,
    phone: normalized.phone,
    organizationId: normalized.organizationId,
    accessType: normalized.accessType,
    roleName: normalized.roleName,
    status: 'pending',
    createdBy,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + inviteTtlMs()),
    redeemedAt: null,
    redeemedUserId: null,
  };

  const result = await invites.insertOne(doc);
  const inviteLink = buildInviteLink(rawToken, req);

  const exposeSecret =
    process.env.NODE_ENV !== 'production'
    || process.env.ALLOW_TENANT_INVITE_LINK_IN_RESPONSE === 'true'
    || process.env.ALLOW_TENANT_INVITE_LINK_IN_RESPONSE === '1';

  return {
    inviteId: result.insertedId.toString(),
    email: doc.email,
    expiresAt: doc.expiresAt,
    inviteLink: exposeSecret ? inviteLink : undefined,
  };
}

async function findPendingInviteByToken(db, rawToken) {
  if (!rawToken) return null;
  const invites = db.collection(COLLECTION);
  const invite = await invites.findOne({ tokenHash: hashToken(rawToken), status: 'pending' });
  if (!invite) return null;
  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    return null;
  }
  return invite;
}

async function previewInvite(db, rawToken) {
  const invite = await findPendingInviteByToken(db, rawToken);
  if (!invite) {
    const err = new Error('Convite inválido ou expirado');
    err.statusCode = 404;
    throw err;
  }
  return {
    email: invite.email,
    username: invite.username,
    displayName: invite.displayName,
    organizationId: invite.organizationId,
    roleName: invite.roleName,
    expiresAt: invite.expiresAt,
  };
}

/**
 * Redeem invite: create active user with chosen password (activation).
 */
async function acceptInvite(db, rawToken, { password, username: usernameOverride }) {
  const invite = await findPendingInviteByToken(db, rawToken);
  if (!invite) {
    const err = new Error('Convite inválido ou expirado');
    err.statusCode = 404;
    throw err;
  }

  const username = String(usernameOverride || invite.username || '').trim();
  if (!password) {
    const err = new Error('Senha é obrigatória');
    err.statusCode = 422;
    throw err;
  }
  if (username !== invite.username) {
    const taken = await db.collection('users').findOne({ username });
    if (taken) {
      const err = new Error('Username já cadastrado');
      err.statusCode = 409;
      throw err;
    }
  }

  const userData = {
    name: invite.displayName,
    email: invite.email,
    username,
    phone: invite.phone,
    organizationId: invite.organizationId,
    roleName: invite.roleName,
    accessType: invite.accessType,
    password,
    status: 'active',
    forcePasswordReset: false,
  };

  const user = await authService.registerUser(db, userData, invite.createdBy);

  // Claim only while still pending so a concurrent accept cannot double-redeem.
  const claim = await db.collection(COLLECTION).updateOne(
    { _id: invite._id, status: 'pending' },
    {
      $set: {
        status: 'redeemed',
        redeemedAt: new Date(),
        redeemedUserId: user._id.toString(),
        updatedAt: new Date(),
      },
    }
  );
  if (!claim.matchedCount) {
    const err = new Error('Convite inválido ou expirado');
    err.statusCode = 409;
    throw err;
  }

  return { userId: user._id.toString(), email: invite.email };
}

module.exports = {
  COLLECTION,
  ensureIndexes,
  createInvite,
  previewInvite,
  acceptInvite,
  buildInviteLink,
};