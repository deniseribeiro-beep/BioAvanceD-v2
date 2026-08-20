process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
process.env.ENCRYPTION_KEY_ID = process.env.ENCRYPTION_KEY_ID || 'vitest-key-001';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import patientService from '../../src/services/patient.service';
import { encryptValue } from '../../src/utils/fieldEncryption';
import mqttSignatureService from '../../src/services/mqtt-signature.service';
import { generateIndustrialBarcodeArtifacts, parseScannedBarcode } from '../../src/utils/barcodeSymbology';
import AllocateSampleUseCase from '../../src/core/use-cases/AllocateSampleUseCase';
import ReleaseSampleUseCase from '../../src/core/use-cases/ReleaseSampleUseCase';

// The HL7 FHIR R4 boundary compliance gate previously tested here relied
// on fhir-sync.service.js, deleted in e2549bee (FHIR is now a pure
// serialization boundary with no persistence path — see
// docs/architecture/canonical-data-cleanup.md). The "no operational FHIR
// collections" property is enforced statically by
// tests/architecture/fhir-boundary.arch.test.js instead.

describe('Compliance Gate - LGPD AES-256-GCM', () => {
  it('garante criptografia ativa para campos sensíveis definidos no domínio atual', () => {
    const sensitiveFieldMap = patientService.getEncryptedFieldMap();
    const fields = Object.keys(sensitiveFieldMap);

    expect(fields.length).toBeGreaterThan(0);

    const input = fields.reduce((acc, field) => {
      acc[field] = field.toLowerCase().includes('cpf') ? '12345678901' : 1.8;
      return acc;
    }, {});

    const encrypted = patientService.encryptSensitivePatientFields(input);

    fields.forEach((field) => {
      const encryptedField = sensitiveFieldMap[field];
      expect(encrypted[field]).toBeNull();
      expect(encrypted[encryptedField]).toBeTruthy();
      expect(encrypted[encryptedField].alg).toBe('aes-256-gcm');
      expect(typeof encrypted[encryptedField].keyId).toBe('string');
      expect(encrypted[encryptedField].keyId.length).toBeGreaterThan(0);
      expect(typeof encrypted[encryptedField].iv).toBe('string');
      expect(typeof encrypted[encryptedField].tag).toBe('string');
      expect(typeof encrypted[encryptedField].data).toBe('string');
    });
  });

  it('produz envelopes criptográficos versionados', () => {
    const encrypted = encryptValue({ value: 'canonical' });

    expect(encrypted).toBeTruthy();
    expect(encrypted.alg).toBe('aes-256-gcm');
    expect(encrypted.keyId).toBeTruthy();
  });
});

describe('Compliance Gate - ISO 20387 Custody Logs', () => {
  it('exige actorId e reason em eventos de custódia (allocate e release)', async () => {
    // #534: ReleaseSampleUseCase/AllocateSampleUseCase read the canonical
    // storageAssignment.boxId/.positionCode (#508's consumer migration,
    // see docs/architecture/canonical-data-contract-v1.md) — the fixture
    // used to provide the legacy storageLocation.boxId/.position shape
    // and never got updated when that migration landed.
    const sampleFixture = {
      _id: 'sample-1',
      barcode: 'BR-ISO-001',
      storageAssignment: { boxId: 'BOX-01', positionCode: 'A1' }
    };

    const storageRepository = {
      findSampleById: vi.fn().mockImplementation(async () => ({
        ...sampleFixture,
        storageAssignment: { ...sampleFixture.storageAssignment }
      })),
      withTransaction: vi.fn(async (cb) => cb({})),
      allocateSamplePosition: vi.fn().mockResolvedValue(undefined),
      releaseSamplePosition: vi.fn().mockResolvedValue({
        from: { boxId: 'BOX-01', position: 'A1' }
      })
    };

    const auditRepository = {
      appendImmutableAudit: vi.fn().mockResolvedValue({ movementID: 1 })
    };

    const lineageRepository = {
      validateBeforePersistence: vi.fn().mockResolvedValue(true),
      recordCustodyEvent: vi.fn().mockResolvedValue({ eventId: 'evt-iso-1' }),
      compensateCustodyEvent: vi.fn().mockResolvedValue({ compensated: true })
    };

    const actor = {
      userId: 'actor-iso-01',
      userName: 'Auditor ISO',
      userRole: 'Coordenador'
    };

    const allocateUseCase = new AllocateSampleUseCase({
      storageRepository,
      auditRepository,
      lineageRepository
    });

    await allocateUseCase.execute({
      specimenId: 'sample-1',
      boxId: 'BOX-02',
      position: 'B2',
      actor
    });

    const releaseUseCase = new ReleaseSampleUseCase({
      storageRepository,
      auditRepository,
      lineageRepository
    });

    await releaseUseCase.execute({
      specimenId: 'sample-1',
      actor
    });

    const recordCalls = lineageRepository.recordCustodyEvent.mock.calls.map((call) => call[0]);
    expect(recordCalls.length).toBeGreaterThanOrEqual(2);

    const reasons = recordCalls.map((payload) => payload.reason);
    const actorIds = recordCalls.map((payload) => payload.actorId);

    expect(reasons).toContain('allocate');
    expect(reasons).toContain('release');
    actorIds.forEach((actorId) => {
      expect(actorId).toBe(actor.userId);
    });

    const auditCalls = auditRepository.appendImmutableAudit.mock.calls.map((call) => call[0]);
    expect(auditCalls.length).toBeGreaterThanOrEqual(2);
    auditCalls.forEach((entry) => {
      expect(entry.context.reason).toBeTruthy();
      expect(entry.context.actor.userId).toBe(actor.userId);
    });
  });
});

describe('Compliance Gate - MQTT Signed Ingestion Trail', () => {
  const originalSecret = process.env.MQTT_SIGNING_SECRET;

  beforeEach(() => {
    process.env.MQTT_SIGNING_SECRET = 'mq-secret-compliance-test';
  });

  afterEach(() => {
    process.env.MQTT_SIGNING_SECRET = originalSecret;
  });

  it('valida hash e assinatura HMAC de payload MQTT', () => {
    const payload = JSON.stringify({ sensorId: 'S-1', temperatureValue: 2.5, timestamp: '2026-03-19T13:00:00.000Z' });

    const payloadHash = mqttSignatureService.hashPayload(payload);
    expect(typeof payloadHash).toBe('string');
    expect(payloadHash.length).toBe(64);

    const signature = mqttSignatureService.computeHmac(payload);
    expect(typeof signature).toBe('string');
    expect(signature.length).toBe(64);
    expect(mqttSignatureService.verifyHmac(payload, signature)).toBe(true);
  });

  it('rejeita assinatura HMAC inválida', () => {
    const payload = JSON.stringify({ sensorId: 'S-1', temperatureValue: 2.5 });
    const invalidSignature = 'a'.repeat(64);

    expect(mqttSignatureService.verifyHmac(payload, invalidSignature)).toBe(false);
  });
});

describe('Compliance Gate - DataMatrix/Code128 Industrial Layer', () => {
  const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

  function expectValidPngAsset(asset) {
    expect(asset).toBeTruthy();
    expect(asset.mimeType).toBe('image/png');
    expect(typeof asset.sha256).toBe('string');
    expect(asset.sha256.length).toBe(64);
    expect(asset.bytes).toBeGreaterThan(64);
    expect(typeof asset.base64).toBe('string');

    const pngBuffer = Buffer.from(asset.base64, 'base64');
    expect(pngBuffer.length).toBe(asset.bytes);
    expect(Array.from(pngBuffer.subarray(0, 8))).toEqual(PNG_SIGNATURE);
  }

  it('gera artefatos PNG industriais para Code128, DataMatrix e QR', async () => {
    const artifacts = await generateIndustrialBarcodeArtifacts('BR-2026-001', {
      includePayload: true
    });

    expect(artifacts.canonicalValue).toBe('BR-2026-001');
    expect(artifacts.code128.renderer).toBe('bwip-js');
    expect(artifacts.dataMatrix.renderer).toBe('bwip-js');
    expect(artifacts.qr.renderer).toBe('bwip-js');

    expectValidPngAsset(artifacts.code128.imagePng);
    expectValidPngAsset(artifacts.dataMatrix.imagePng);
    expectValidPngAsset(artifacts.qr.imagePng);
  });

  it('normaliza leitura com prefixos industriais de scanner', () => {
    const code128Scan = parseScannedBarcode(']C1BR-2026-001');
    expect(code128Scan.isValid).toBe(true);
    expect(code128Scan.scannerSymbology).toBe('Code128');
    expect(code128Scan.normalizedValue).toBe('BR-2026-001');

    const dataMatrixScan = parseScannedBarcode(']d2BR-2026-001');
    expect(dataMatrixScan.isValid).toBe(true);
    expect(dataMatrixScan.scannerSymbology).toBe('DataMatrix');
    expect(dataMatrixScan.normalizedValue).toBe('BR-2026-001');
  });
});
