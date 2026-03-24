const fhirSyncService = require('../../src/services/fhir-sync.service');
const PatientFHIR = require('../../src/models/fhir/Patient.fhir.model');
const SampleFHIR = require('../../src/models/fhir/Sample.fhir.model');
const patientService = require('../../src/services/patient.service');
const { encryptValue, decryptValue } = require('../../src/utils/fieldEncryption');
const mqttSignatureService = require('../../src/services/mqtt-signature.service');
const { generateIndustrialBarcodeArtifacts, parseScannedBarcode } = require('../../src/utils/barcodeSymbology');
const AllocateSampleUseCase = require('../../src/core/use-cases/AllocateSampleUseCase');
const ReleaseSampleUseCase = require('../../src/core/use-cases/ReleaseSampleUseCase');

describe('Compliance Gate - HL7 FHIR R4', () => {
  it('valida contrato FHIR R4 para payload de Patient', () => {
    const payload = fhirSyncService.buildPatientFhirPayload({
      patientID: '12345678',
      patientName: 'Paciente Compliance',
      email: 'compliance@bioavanced.local',
      phone: '11999990000',
      sex: 'F',
      birthDate: '1990-01-20',
      recordNumber: 'REC-001',
      unitAcronym: 'GEN',
      clinicalUnit: 'GENETICA',
      alphaGal: 2.5,
      lysoGb3: 1.2,
      diagnosticHypothesis: 'Hipótese',
      icdCode: 'E75.2'
    });

    const serialized = fhirSyncService.validateAndSerialize(PatientFHIR, payload);

    expect(serialized.resourceType).toBe('Patient');
    expect(serialized.patientID).toBe('12345678');
    expect(Array.isArray(serialized.identifier)).toBe(true);
    expect(serialized.identifier.length).toBeGreaterThan(0);
    expect(serialized.gender).toBe('female');
    expect(serialized.clinicalProfile.alphaGal).toBe(2.5);
    expect(serialized.clinicalProfile.lysoGb3).toBe(1.2);
  });

  it('valida contrato FHIR R4 para payload de Specimen', () => {
    const payload = fhirSyncService.buildSampleFhirPayload({
      _id: '507f1f77bcf86cd799439011',
      sampleID: 'SMP-001',
      barcode: 'BR-001',
      patientID: '12345678',
      sampleType: 'Sangue',
      sampleOrigin: 'Coleta',
      extractionProtocol: 'Protocolo A',
      linkedProject: 'Projeto Compliance',
      quality: 1,
      quantity: 3,
      unit: 'µL',
      registerDate: new Date().toISOString(),
      currentStatus: 'Available'
    });

    const serialized = fhirSyncService.validateAndSerialize(SampleFHIR, payload);

    expect(serialized.resourceType).toBe('Specimen');
    expect(serialized.patientID).toBe('12345678');
    expect(serialized.status).toBe('available');
    expect(serialized.type?.text).toBe('Sangue');
    expect(serialized.quantity?.value).toBe(3);
    expect(serialized.semanticPointers?.lineageManagedInNeo4j).toBe(true);
  });
});

describe('Compliance Gate - LGPD AES-256-GCM', () => {
  it('garante criptografia ativa para campos PII sensíveis definidos no domínio', () => {
    const piiFieldMap = patientService.getEncryptedFieldMap();
    const expectedSensitiveFields = ['alphaGal', 'lysoGb3', 'representativeCpf'];

    expect(Object.keys(piiFieldMap).sort()).toEqual(expectedSensitiveFields.sort());

    const encrypted = patientService.encryptSensitivePatientFields({
      alphaGal: 1.8,
      lysoGb3: 0.9,
      representativeCpf: '12345678901'
    });

    expectedSensitiveFields.forEach((field) => {
      const encryptedField = piiFieldMap[field];
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

  it('mantém retrocompatibilidade para payload legado sem keyId', () => {
    const plaintext = { value: 'legacy-compatible' };
    const encrypted = encryptValue(plaintext);

    expect(encrypted).toBeTruthy();
    expect(typeof encrypted.keyId).toBe('string');

    const legacyPayload = {
      ...encrypted
    };
    delete legacyPayload.keyId;

    const decrypted = decryptValue(legacyPayload);
    expect(decrypted).toEqual(plaintext);
  });
});

describe('Compliance Gate - ISO 20387 Custody Logs', () => {
  it('exige actorId e reason em eventos de custódia (allocate e release)', async () => {
    const sampleFixture = {
      _id: 'sample-1',
      barcode: 'BR-ISO-001',
      storageLocation: { boxId: 'BOX-01', position: 'A1' }
    };

    const storageRepository = {
      findSampleById: vi.fn().mockImplementation(async () => ({
        ...sampleFixture,
        storageLocation: { ...sampleFixture.storageLocation }
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
      sampleId: 'sample-1',
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
      sampleId: 'sample-1',
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

  it('gera artefatos PNG industriais para Code128 e DataMatrix', async () => {
    const artifacts = await generateIndustrialBarcodeArtifacts('BR-2026-001', {
      includePayload: true
    });

    expect(artifacts.canonicalValue).toBe('BR-2026-001');
    expect(artifacts.code128.renderer).toBe('bwip-js');
    expect(artifacts.dataMatrix.renderer).toBe('bwip-js');

    expectValidPngAsset(artifacts.code128.imagePng);
    expectValidPngAsset(artifacts.dataMatrix.imagePng);
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