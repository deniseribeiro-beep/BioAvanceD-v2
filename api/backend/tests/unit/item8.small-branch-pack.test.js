import { afterEach, describe, expect, it, vi } from 'vitest';

const UserModel = require('../../src/models/User');
const LogModel = require('../../src/models/Log');
const NonconformanceModel = require('../../src/models/Nonconformance');
const UserRoleAssignmentModel = require('../../src/models/UserRoleAssignment');
const {
  parseScannedBarcode,
  generateDataMatrixDescriptor,
} = require('../../src/utils/barcodeSymbology');
const {
  generateAnonId,
  getUserAnonId,
  anonymizeLogUser,
  anonymizeLogs,
  maskUser,
  sanitizePayload,
  sanitizeMessage,
} = require('../../src/utils/userAnonymization');
const AllocateSampleUseCase = require('../../src/core/use-cases/AllocateSampleUseCase');
const ReleaseSampleUseCase = require('../../src/core/use-cases/ReleaseSampleUseCase');
const env = require('../../src/config/env');

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_LINEAGE_MODE = env.LINEAGE_MODE;

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
  env.LINEAGE_MODE = ORIGINAL_LINEAGE_MODE;
});

describe('item 8 compact legitimate branch pack', () => {
  it('covers UserModel optional validation failures and accepted explicit values', () => {
    const base = { _id: 'existing', name: 'Ana', email: 'ana@example.test', username: 'ana' };

    expect(UserModel.validate({ ...base, passwordHistory: 'bad' }).errors)
      .toContain('passwordHistory deve ser um array');
    expect(UserModel.validate({ ...base, lastPasswordChange: 'not-a-date' }).errors)
      .toContain('lastPasswordChange deve ser uma data válida');
    expect(UserModel.validate({ ...base, forceReset: 'yes' }).errors)
      .toContain('forceReset deve ser booleano');
    expect(UserModel.validate({ ...base, failedLoginAttempts: '1' }).errors)
      .toContain('failedLoginAttempts deve ser número');
    expect(UserModel.validate({ ...base, accountLockedUntil: 'bad-date' }).errors)
      .toContain('accountLockedUntil deve ser uma data válida');
    expect(UserModel.validate({ ...base, roleValidFrom: 'bad-date' }).errors)
      .toContain('roleValidFrom deve ser uma data válida');
    expect(UserModel.validate({ ...base, roleValidUntil: 'bad-date' }).errors)
      .toContain('roleValidUntil deve ser uma data válida');
    expect(UserModel.validate({
      ...base,
      roleValidFrom: '2026-09-02T00:00:00Z',
      roleValidUntil: '2026-09-01T00:00:00Z',
    }).errors).toContain('roleValidUntil deve ser posterior a roleValidFrom');
    expect(UserModel.validate({ ...base, organizationIds: ['ORG-1', 2] }).errors)
      .toContain('organizationIds deve ser um array de strings');

    const created = UserModel.create({
      ...base,
      phone: '',
      organizationId: '',
      status: 'Suspenso',
      mfaEnabled: true,
      mfaFailedAttempts: 2,
      mfaLocked: true,
      forceReset: true,
      failedLoginAttempts: 3,
      accountLockedUntil: '2026-09-03T00:00:00Z',
      roleValidFrom: '2026-09-01T00:00:00Z',
      roleValidUntil: '2026-10-01T00:00:00Z',
      organizationIds: ['ORG-1'],
    });
    expect(created).toMatchObject({
      status: 'suspended',
      mfaEnabled: true,
      mfaFailedAttempts: 2,
      mfaLocked: true,
      forceReset: true,
      failedLoginAttempts: 3,
      organizationIds: ['ORG-1'],
    });
    expect(UserModel.translateStatus('Suspenso')).toBe('Suspenso');
    expect(UserModel.normalizeStatus('unknown')).toBe('active');
    expect(UserModel.translateStatus('unknown')).toBe('Ativo');
  });

  it('covers UserModel secret stripping for scalars, arrays and non-objects', () => {
    expect(UserModel.stripSecrets(null)).toBeNull();
    expect(UserModel.stripSecrets('x')).toBe('x');
    expect(UserModel.stripSecrets([{
      name: 'Ana',
      password: 'secret',
      mfaSecret: 'seed',
      mfaSecretCiphertext: { data: 'x' },
      passwordHistory: ['hash'],
      passwordResetTokenHash: 'token-hash',
    }])).toEqual([{ name: 'Ana' }]);
  });

  it('covers LogModel canonical aliases, ID rejection and request IP fallbacks', () => {
    expect(LogModel.validate({
      userId: 'u1',
      action: 'READ',
      entityType: '507f1f77bcf86cd799439011',
    }).errors[0]).toContain('entity não pode ser um ID');

    expect(LogModel.validate({
      userId: 'u1',
      action: 'READ',
      resourceType: '12345678',
    }).errors[0]).toContain('entity não pode ser um ID');

    expect(LogModel.validate({
      userId: 'u1',
      action: 'READ',
      entity: 'Sample',
      severity: 'debug',
    }).errors).toContain('severity deve ser: info, warning, error ou critical');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const occurredAt = new Date('2026-09-21T12:00:00Z');
    const created = LogModel.create({
      logID: 7,
      occurredAt,
      userID: 'u1',
      action: 'READ',
      entityType: '507f1f77bcf86cd799439011',
      entityId: 'R1',
      result: 'failure',
      origin: 'worker',
    }, {
      headers: {},
      connection: { remoteAddress: '10.0.0.1' },
    });

    expect(created).toMatchObject({
      logId: 7,
      resourceType: 'Sistema',
      resourceId: 'R1',
      status: 'failure',
      result: 'failure',
      source: 'worker',
      ipSource: '10.0.0.1',
    });
    expect(warn).toHaveBeenCalled();

    const fromAliases = LogModel.create({
      dateTime: occurredAt,
      userId: 'u2',
      action: 'UPDATE',
      entity: 'Patient',
      entityID: 'P1',
      status: 'warning',
      sourceIP: '192.0.2.1',
    });
    expect(fromAliases).toMatchObject({
      userId: 'u2',
      resourceType: 'Patient',
      entityID: 'P1',
      status: 'warning',
      ipSource: '192.0.2.1',
    });
  });

  it('covers Nonconformance optional validation and creation branches', () => {
    const base = {
      nonconformanceType: 'temperature',
      detectedAt: '2026-09-21T00:00:00Z',
      detectedBy: 'u1',
      description: 'Synthetic',
      affectedEntityIds: ['S1'],
    };
    expect(NonconformanceModel.validate({ ...base, affectedEntityIds: [''] }).errors)
      .toContain('affectedEntityIds deve conter apenas strings não vazias');
    expect(NonconformanceModel.validate({ ...base, immediateActions: 'x' }).errors)
      .toContain('immediateActions deve ser um array');
    expect(NonconformanceModel.validate({ ...base, rootCause: 1 }).errors)
      .toContain('rootCause deve ser string');

    const created = NonconformanceModel.create({
      ...base,
      nonconformanceId: 'NC-1',
      immediateActions: ['isolate'],
      rootCause: 'sensor',
    });
    expect(created).toMatchObject({
      nonconformanceId: 'NC-1',
      immediateActions: ['isolate'],
      rootCause: 'sensor',
      status: 'open',
    });

    expect(NonconformanceModel.validateCorrectiveAction({
      description: 'fix',
      responsible: 'u2',
      dueDate: 'bad-date',
    }).errors).toContain('dueDate deve ser uma data válida quando informada');

    expect(NonconformanceModel.validateEffectivenessVerification({
      verifiedBy: 'u3',
      outcome: 'effective',
      notes: 2,
    }).errors).toContain('notes deve ser string');
  });

  it('covers UserRoleAssignment defaults, explicit dates and all validation guards', () => {
    expect(() => UserRoleAssignmentModel.create({ roleId: 'r', grantedBy: 'g' }))
      .toThrow(/userAccountId/);
    expect(() => UserRoleAssignmentModel.create({ userAccountId: 'u', grantedBy: 'g' }))
      .toThrow(/roleId/);
    expect(() => UserRoleAssignmentModel.create({
      userAccountId: 'u', roleId: 'r', grantedBy: 'g', scopeType: 'bad',
    })).toThrow(/scopeType inválido/);
    expect(() => UserRoleAssignmentModel.create({
      userAccountId: 'u', roleId: 'r', grantedBy: 'g', assignmentStatus: 'bad',
    })).toThrow(/assignmentStatus inválido/);
    expect(() => UserRoleAssignmentModel.create({ userAccountId: 'u', roleId: 'r' }))
      .toThrow(/grantedBy/);

    const explicit = UserRoleAssignmentModel.create({
      assignmentId: 'A1',
      userAccountId: ' u ',
      roleId: ' r ',
      scopeType: 'organization',
      scopeId: 'ORG-1',
      validFrom: '2026-09-02T00:00:00Z',
      validUntil: '2026-10-01T00:00:00Z',
      assignmentStatus: 'suspended',
      grantedBy: ' admin ',
      grantedAt: '2026-09-01T00:00:00Z',
      revokedBy: 'admin',
      revokedAt: '2026-11-01T00:00:00Z',
      revocationReason: 'test',
    });
    expect(explicit).toMatchObject({
      assignmentId: 'A1',
      userAccountId: 'u',
      roleId: 'r',
      scopeType: 'organization',
      assignmentStatus: 'suspended',
      grantedBy: 'admin',
    });

    const defaults = UserRoleAssignmentModel.fieldsOf({
      userAccountId: 'u', roleId: 'r', grantedBy: 'g',
    });
    expect(defaults).toMatchObject({
      scopeType: null,
      scopeId: null,
      assignmentStatus: 'active',
      revokedBy: null,
      revocationReason: null,
    });
  });

  it('covers scanner symbology prefixes and canonical barcode checksum output', () => {
    expect(parseScannedBarcode(']d2 BIO-DM ')).toMatchObject({
      scannerSymbology: 'DataMatrix', normalizedValue: 'BIO-DM', isValid: true,
    });
    expect(parseScannedBarcode(']Q3BIO-QR')).toMatchObject({
      scannerSymbology: 'UNSUPPORTED', normalizedValue: ']Q3BIO-QR', isValid: false,
    });
    expect(parseScannedBarcode(']C1BIO-C128')).toMatchObject({
      scannerSymbology: 'UNSUPPORTED', normalizedValue: ']C1BIO-C128', isValid: false,
    });
    expect(parseScannedBarcode(' BIO-RAW ')).toMatchObject({
      scannerSymbology: 'UNKNOWN', normalizedValue: 'BIO-RAW', isValid: true,
    });
    const generated = generateDataMatrixDescriptor(' BIO-001 ');
    expect(generated.symbology).toBe('data_matrix');
    expect(generated.scannerPrefix).toBe(']d2');
    expect(generated.checksumHint).toHaveLength(8);
  });

  it('covers user anonymization database, stored-id and sanitization branches', async () => {
    process.env.USER_ANON_SALT = 'synthetic-secret-salt';
    expect(generateAnonId(null)).toBe('USR-SYSTEM');
    expect(await getUserAnonId(null)).toBe('USR-SYSTEM');
    expect(await getUserAnonId({ name: 'no-id' })).toBe('USR-SYSTEM');
    expect(await getUserAnonId({ _id: 'u1', anonId: 'USR-STORED' })).toBe('USR-STORED');

    const db = {
      collection: vi.fn(() => ({
        findOne: vi.fn().mockResolvedValue({ anonId: 'USR-DB' }),
      })),
    };
    expect(await getUserAnonId({ _id: 'u2' }, db)).toBe('USR-DB');

    const failingDb = {
      collection: vi.fn(() => ({
        findOne: vi.fn().mockRejectedValue(new Error('db down')),
      })),
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await getUserAnonId({ _id: 'u3' }, failingDb)).toMatch(/^USR-/);
    expect(warn).toHaveBeenCalled();

    const sanitizedPayload = sanitizePayload({
      email: 'secret@example.test',
      nested: { patientName: 'Secret', keep: 1 },
      arr: [{ phone: '11999999999', keep: 2 }, 'x'],
    });
    expect(sanitizedPayload).toEqual({ nested: { keep: 1 }, arr: [{ keep: 2 }, 'x'] });
    expect(sanitizePayload('x')).toBe('x');

    const sanitizedMessage = sanitizeMessage('Usuário Ana Silva email ana@example.test CPF 123.456.789-09 telefone 11 99999-9999');
    expect(sanitizedMessage).not.toContain('ana@example.test');
    expect(sanitizedMessage).toContain('[CPF]');
    expect(sanitizeMessage(null)).toBeNull();

    const log = await anonymizeLogUser({
      userID: 'u4',
      userName: 'Ana',
      metadata: { user: { userName: 'Ana', userRole: 'Curador' } },
      payload: { email: 'ana@example.test', keep: true },
      message: 'user Ana ana@example.test',
    });
    expect(log.userID).toMatch(/^USR-/);
    expect(log.metadata.user).toEqual({ userID: log.userID, userRole: 'Curador' });
    expect(log.payload).toEqual({ keep: true });
    expect(log.message).toContain('[email]');

    const system = await anonymizeLogUser({ userID: 'system', metadata: { user: {} } });
    expect(system).toMatchObject({ userID: 'system', userId: 'system', userName: 'USR-SYSTEM' });
    expect(await anonymizeLogs('not-array')).toBe('not-array');
    expect((await anonymizeLogs([{ userID: 'system' }]))[0].userName).toBe('USR-SYSTEM');

    expect(maskUser(null)).toBe('USR-SYSTEM');
    expect(maskUser({ anonId: 'USR-CACHED' })).toBe('USR-CACHED');
    expect(maskUser({ name: 'no-id' })).toBe('USR-SYSTEM');
    expect(maskUser({ id: 'u5' })).toMatch(/^USR-/);
  });

  it('covers AllocateSampleUseCase fail-open lineage and optional placement/actor branches', async () => {
    env.LINEAGE_MODE = 'fail-open';
    const auditRepository = { appendImmutableAudit: vi.fn().mockResolvedValue(undefined) };
    const sample = { _id: 'S1', barcode: '', currentStoragePlacement: null };
    const storageRepository = {
      findSampleById: vi.fn().mockResolvedValue(sample),
      withTransaction: vi.fn(async (fn) => fn('session')),
      allocateSamplePosition: vi.fn().mockResolvedValue({ boxId: 'B1', positionCode: 'A1' }),
    };

    const withoutLineage = new AllocateSampleUseCase({
      storageRepository, auditRepository, lineageRepository: null,
    });
    const result = await withoutLineage.execute({
      specimenId: 'S1', boxId: 'B1', position: ' a1 ', actor: null,
    });
    expect(result).toMatchObject({
      success: true,
      lineageValidated: false,
      lineagePersisted: false,
      lineageQueued: false,
      lineageEventId: null,
    });

    expect(() => withoutLineage.validateCommand({ specimenId: 'S1' })).toThrow(/obrigatórios/);
  });

  it('covers AllocateSampleUseCase lineage queued=false and fail-open/fail-closed errors', async () => {
    const auditRepository = { appendImmutableAudit: vi.fn().mockResolvedValue(undefined) };
    const sample = {
      _id: 'S1',
      barcode: 'BC',
      currentStoragePlacement: { boxId: null, positionCode: null },
    };
    const storageRepository = {
      findSampleById: vi.fn().mockResolvedValue(sample),
      withTransaction: vi.fn(async (fn) => fn('session')),
      allocateSamplePosition: vi.fn().mockResolvedValue({ boxId: 'B2', positionCode: 'B2' }),
    };
    const lineageRepository = {
      validateBeforePersistence: vi.fn().mockResolvedValue(undefined),
      recordCustodyEvent: vi.fn().mockResolvedValue({ queued: false }),
    };

    env.LINEAGE_MODE = 'fail-open';
    const useCase = new AllocateSampleUseCase({ storageRepository, auditRepository, lineageRepository });
    await expect(useCase.execute({
      specimenId: 'S1', boxId: 'B2', position: 'b2', actor: {},
    })).resolves.toMatchObject({ lineageQueued: false, lineageEventId: null });

    lineageRepository.validateBeforePersistence.mockRejectedValueOnce(new Error('outbox refused'));
    await expect(useCase.persistLineageInTransaction({}, 'session')).resolves.toMatchObject({
      lineageValidated: false, lineagePersisted: false,
    });

    env.LINEAGE_MODE = 'fail-closed';
    lineageRepository.validateBeforePersistence.mockRejectedValueOnce(new Error('outbox refused hard'));
    await expect(useCase.persistLineageInTransaction({}, 'session'))
      .rejects.toThrow('RF023_LINEAGE_VALIDATION_FAILED');
    const noLineage = new AllocateSampleUseCase({ storageRepository, auditRepository, lineageRepository: null });
    await expect(noLineage.persistLineageInTransaction({}, 'session'))
      .rejects.toThrow('Repositório canônico de linhagem ausente');
  });

  it('covers ReleaseSampleUseCase validation, fail-open lineage and persisted queued=false', async () => {
    env.LINEAGE_MODE = 'fail-open';
    const auditRepository = { appendImmutableAudit: vi.fn().mockResolvedValue(undefined) };
    const storageRepository = {
      findSampleById: vi.fn(),
      withTransaction: vi.fn(async (fn) => fn('session')),
      releaseSamplePosition: vi.fn().mockResolvedValue({ from: { boxId: 'B1', position: 'A1' } }),
    };

    const noLineage = new ReleaseSampleUseCase({ storageRepository, auditRepository, lineageRepository: null });
    await expect(noLineage.execute({})).rejects.toThrow('specimenId é obrigatório');

    storageRepository.findSampleById.mockResolvedValueOnce(null);
    await expect(noLineage.execute({ specimenId: 'S1' })).rejects.toThrow('Amostra não encontrada');

    storageRepository.findSampleById.mockResolvedValueOnce({ _id: 'S1', currentStoragePlacement: null });
    await expect(noLineage.execute({ specimenId: 'S1' }))
      .rejects.toThrow('Amostra não possui posicionamento físico ativo');

    const sample = { _id: 'S1', barcode: '', currentStoragePlacement: { boxId: 'B1', positionCode: 'a1' } };
    storageRepository.findSampleById.mockResolvedValue(sample);
    const result = await noLineage.execute({ specimenId: 'S1', actor: null });
    expect(result).toMatchObject({ lineageValidated: false, lineageEventId: null });

    const lineageRepository = {
      validateBeforePersistence: vi.fn().mockResolvedValue(undefined),
      recordCustodyEvent: vi.fn().mockResolvedValue({ queued: false }),
    };
    const withLineage = new ReleaseSampleUseCase({ storageRepository, auditRepository, lineageRepository });
    await expect(withLineage.execute({ specimenId: 'S1', actor: {} }))
      .resolves.toMatchObject({ lineageValidated: true, lineagePersisted: true, lineageQueued: false, lineageEventId: null });

    lineageRepository.validateBeforePersistence.mockRejectedValueOnce(new Error('bad lineage'));
    await expect(withLineage.persistLineageInTransaction({}, 'session')).resolves.toMatchObject({
      lineageValidated: false, lineagePersisted: false,
    });

    env.LINEAGE_MODE = 'fail-closed';
    lineageRepository.validateBeforePersistence.mockRejectedValueOnce(new Error('bad lineage hard'));
    await expect(withLineage.persistLineageInTransaction({}, 'session'))
      .rejects.toThrow('RF023_LINEAGE_VALIDATION_FAILED');
  });
});
