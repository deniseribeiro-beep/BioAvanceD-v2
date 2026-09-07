import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const patientIdentityService = require('../../src/services/PatientIdentityService');

describe('PatientIdentityService - Heuristic Patient Matching', () => {
  let db;
  let patientsCollection;
  let identitiesCollection;

  // #561: name+birthDate matching resolves against ParticipantIdentity, not
  // Patient's own patientNameNormalized/birthDateKey fields — seed
  // identitiesCollection.find() with the candidates that used to live on
  // patientsCollection.findOne().
  function identityCandidates(docs = []) {
    identitiesCollection.find.mockReturnValue({ toArray: vi.fn().mockResolvedValue(docs) });
  }

  beforeEach(() => {
    patientsCollection = {
      findOne: vi.fn(),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      insertOne: vi.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439011' }),
    };

    identitiesCollection = {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };

    db = {
      listCollections: () => ({
        toArray: async () => ([{ name: 'patients' }, { name: 'participantIdentities' }]),
      }),
      collection: (name) => (name === 'participantIdentities' ? identitiesCollection : patientsCollection),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Scenario 1: Patient with participantId - should find by ID', () => {
    it('deve encontrar paciente existente pelo participantId', async () => {
      const existingPatient = {
        _id: '507f1f77bcf86cd799439011',
        participantId: '12345678',
        patientName: 'Paciente Existente',
        birthDate: new Date('1990-01-20'),
      };

      patientsCollection.findOne.mockResolvedValueOnce(existingPatient);
      patientsCollection.updateOne.mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 });

      const result = await patientIdentityService.matchOrUpsertParticipant(db, {
        participantId: '12345678',
        patientName: 'Paciente Existente Updated',
        email: 'updated@test.com',
      });

      expect(result.created).toBe(false);
      expect(result.patient.participantId).toBe('12345678');
      expect(patientsCollection.findOne).toHaveBeenCalledWith({ participantId: '12345678' });
      expect(patientsCollection.updateOne).toHaveBeenCalled();
    });
  });

  describe('Scenario 2: Patient without participantId but with Name + BirthDate - should find or create', () => {
    it('deve deduplicar pacientes com o mesmo nome normalizado e data de nascimento', async () => {
      const existingPatient = {
        _id: '507f1f77bcf86cd799439011',
        participantId: '87654321',
        patientName: 'João Silva Santos',
        patientNameNormalized: 'joao silva santos',
        birthDate: new Date('1990-05-15'),
        birthDateKey: '1990-05-15',
      };

      // First, ParticipantIdentity resolves the match by name + birthDate;
      // then Patient is looked up by the resolved participantId.
      identityCandidates([{ participantId: '87654321', patientName: 'João Silva Santos', birthDate: new Date('1990-05-15') }]);
      patientsCollection.findOne.mockResolvedValueOnce(existingPatient);
      patientsCollection.updateOne.mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 });

      const result = await patientIdentityService.matchOrUpsertParticipant(db, {
        patientName: 'Joao Silva Santos', // Sem acento
        birthDate: '15/05/1990', // Formato diferente
        sex: 'M',
        cpf: '12345678900',
      });

      expect(result.created).toBe(false);
      expect(result.patient.participantId).toBe('87654321');
      expect(patientsCollection.updateOne).toHaveBeenCalled();
    });

    it('deve criar novo paciente se nome + data de nascimento não encontrados', async () => {
      identityCandidates([]);
      patientsCollection.insertOne.mockResolvedValueOnce({ insertedId: '999f1f77bcf86cd799439999' });

      const result = await patientIdentityService.matchOrUpsertParticipant(db, {
        patientName: 'Novo Paciente',
        birthDate: '20/01/2000',
        email: 'novo.paciente@test.com',
        phone: '+5511988887777',
        sex: 'F',
        cpf: '98765432100',
      });

      expect(result.created).toBe(true);
      expect(patientsCollection.insertOne).toHaveBeenCalled();
      const insertedDoc = patientsCollection.insertOne.mock.calls[0][0];
      expect(insertedDoc.email).toBe('novo.paciente@test.com');
      expect(insertedDoc.phone).toBe('+5511988887777');
      expect(insertedDoc.sex).toBe('F');
      expect(insertedDoc.cpf).toBe('98765432100');

      // RF005/RNF007 (#575): civil identity never lands on Patient.
      expect(insertedDoc).not.toHaveProperty('patientName');
      expect(insertedDoc).not.toHaveProperty('patientNameNormalized');
      expect(insertedDoc).not.toHaveProperty('birthDate');
      expect(insertedDoc).not.toHaveProperty('birthDateKey');
      expect(insertedDoc).not.toHaveProperty('identityDocument');

      const identityDoc = identitiesCollection.updateOne.mock.calls[0][1].$set;
      expect(identityDoc.patientName).toBe('Novo Paciente');
      expect(identityDoc.birthDate).toBeInstanceOf(Date);
    });
  });

  describe('RF005/RNF007 (#574): matches a ciphertext-only ParticipantIdentity candidate', () => {
    it('decrypts patientName before comparing, and queries via $or including birthDateHash', async () => {
      const participantIdentityService = require('../../src/services/participantIdentity.service');
      // Local-time components (not an ISO date-only string, which parses as
      // UTC and could shift a day depending on the test runner's timezone)
      // -- matches parseBirthDate's own DD/MM/YYYY -> new Date(y, m, d) path.
      const birthDate = new Date(1990, 4, 15);
      const encrypted = participantIdentityService.encryptIdentityFields({
        participantId: '87654321',
        patientName: 'João Silva Santos',
        birthDate,
      });
      const ciphertextOnlyCandidate = { ...encrypted, patientName: null, birthDate: null };

      let capturedFindQuery = null;
      identitiesCollection.find = vi.fn((query) => {
        capturedFindQuery = query;
        return { toArray: vi.fn().mockResolvedValue([ciphertextOnlyCandidate]) };
      });
      patientsCollection.findOne.mockResolvedValueOnce({ _id: 'x', participantId: '87654321' });
      patientsCollection.updateOne.mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 });

      const result = await patientIdentityService.matchOrUpsertParticipant(db, {
        patientName: 'Joao Silva Santos',
        birthDate: '15/05/1990',
      });

      expect(result.created).toBe(false);
      expect(result.patient.participantId).toBe('87654321');
      const expectedHash = participantIdentityService.computeBlindIndex('birthDate', birthDate);
      expect(capturedFindQuery.$or).toEqual(
        // #1099: matched under every registered key, via $in.
        expect.arrayContaining([{ birthDateHash: { $in: expect.arrayContaining([expectedHash]) } }])
      );
    });
  });

  describe('Scenario 3: Duplicate patient detection across samples', () => {
    it('Cenário: Tentar cadastrar dois pacientes com mesmo nome e data, IDs diferentes - deve retornar existente', async () => {
      const existingPatient = {
        _id: '507f1f77bcf86cd799439011',
        participantId: '11111111',
        patientName: 'Maria Silva',
        patientNameNormalized: 'maria silva',
        birthDate: new Date('1985-03-10'),
        birthDateKey: '1985-03-10',
        email: 'maria.silva@test.com',
      };

      // Mock: primeiro encontra a identidade existente (por nome+data), depois o paciente
      identityCandidates([{ participantId: '11111111', patientName: 'Maria Silva', birthDate: new Date('1985-03-10') }]);
      patientsCollection.findOne.mockResolvedValueOnce(existingPatient);
      patientsCollection.updateOne.mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 });

      // Tentativa 1 com novo participantId (diferente, simulando tentativa de criar novo)
      const result1 = await patientIdentityService.matchOrUpsertParticipant(db, {
        patientName: 'Maria Silva',
        birthDate: '10/03/1985',
        sex: 'F',
        cpf: '55555555555',
      });

      expect(result1.created).toBe(false);
      expect(result1.patient.participantId).toBe('11111111'); // Deve retornar ID existente, não criar novo

      // Reset mocks
      patientsCollection.findOne.mockClear();
      patientsCollection.updateOne.mockClear();

      // Mock: segunda vez, encontra a mesma identidade e o mesmo paciente
      identityCandidates([{ participantId: '11111111', patientName: 'Maria Silva', birthDate: new Date('1985-03-10') }]);
      patientsCollection.findOne.mockResolvedValueOnce(existingPatient);
      patientsCollection.updateOne.mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 });

      // Tentativa 2 mesmo paciente, mesmo resultado
      const result2 = await patientIdentityService.matchOrUpsertParticipant(db, {
        patientName: 'Maria Silva',
        birthDate: '10/03/1985',
        sex: 'F',
        phone: '+5511999999999',
      });

      expect(result2.created).toBe(false);
      expect(result2.patient.participantId).toBe('11111111'); // Mesmo ID
      expect(patientsCollection.insertOne).not.toHaveBeenCalled(); // Não deve inserir novo
    });
  });

  describe('Scenario 4: Name normalization (remove accents, case-insensitive)', () => {
    it('deve casar contra ParticipantIdentity ignorando acentuação e caixa', async () => {
      const patterns = [
        { stored: 'José Peña', incoming: 'JOSE PENA' },
        { stored: 'ANDRÉ MÜLLER', incoming: 'andre muller' },
        { stored: 'Francçois Côté', incoming: 'FRANCCOIS COTE' },
      ];

      for (const pattern of patterns) {
        identityCandidates([{ participantId: 'PID-NORM', patientName: pattern.stored, birthDate: new Date('1990-01-01') }]);
        patientsCollection.findOne.mockResolvedValueOnce({ _id: 'x', participantId: 'PID-NORM' });
        patientsCollection.updateOne.mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 });

        const result = await patientIdentityService.matchOrUpsertParticipant(db, {
          patientName: pattern.incoming,
          birthDate: '01/01/1990',
        });

        expect(result.created).toBe(false);
        expect(result.patient.participantId).toBe('PID-NORM');
      }
    });
  });

  describe('RF005/RNF007 (#640): encrypts identity fields on write', () => {
    it('writes ciphertext/hash siblings when updating an existing identity', async () => {
      const existingPatient = {
        _id: '507f1f77bcf86cd799439011',
        participantId: '33333333',
        patientName: 'Ana Costa',
        birthDate: new Date('1988-02-10'),
      };

      patientsCollection.findOne.mockResolvedValueOnce(existingPatient);
      patientsCollection.updateOne.mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 });

      await patientIdentityService.matchOrUpsertParticipant(db, {
        participantId: '33333333',
        patientName: 'Ana Costa',
        birthDate: '10/02/1988',
        identityDocument: '111.222.333-44',
      });

      const identitySet = identitiesCollection.updateOne.mock.calls[0][1].$set;
      expect(identitySet.patientNameEncrypted).toBeTruthy();
      expect(identitySet.birthDateEncrypted).toBeTruthy();
      expect(identitySet.identityDocumentEncrypted).toBeTruthy();
      expect(identitySet.identityDocumentHash).toBeTruthy();
      expect(identitySet.birthDateHash).toBeTruthy();
    });

    it('writes ciphertext/hash siblings when inserting a new identity', async () => {
      identityCandidates([]);
      patientsCollection.insertOne.mockResolvedValueOnce({ insertedId: '888f1f77bcf86cd799439888' });

      await patientIdentityService.matchOrUpsertParticipant(db, {
        patientName: 'Bruno Rocha',
        birthDate: '05/06/1975',
        identityDocument: '555.666.777-88',
      });

      const identitySet = identitiesCollection.updateOne.mock.calls[0][1].$set;
      expect(identitySet.patientNameEncrypted).toBeTruthy();
      expect(identitySet.birthDateEncrypted).toBeTruthy();
      expect(identitySet.identityDocumentEncrypted).toBeTruthy();
      expect(identitySet.identityDocumentHash).toBeTruthy();
      expect(identitySet.birthDateHash).toBeTruthy();
    });
  });

  describe('#703: invalid-format participantId (e.g. wizard placeholder) must not be treated as a literal id', () => {
    it('generates a real participantId and does not insert the placeholder literally', async () => {
      identityCandidates([]);
      patientsCollection.insertOne.mockResolvedValueOnce({ insertedId: '111f1f77bcf86cd799439111' });

      const result = await patientIdentityService.matchOrUpsertParticipant(db, {
        participantId: 'placeholder',
        patientName: 'Novo Paciente Wizard',
        birthDate: '20/01/2000',
      });

      expect(result.created).toBe(true);
      expect(patientsCollection.findOne).not.toHaveBeenCalledWith({ participantId: 'placeholder' });
      const insertedDoc = patientsCollection.insertOne.mock.calls[0][0];
      expect(insertedDoc.participantId).not.toBe('placeholder');
      expect(insertedDoc.participantId).toMatch(/^\d{8}$/);
      expect(result.patient.participantId).toMatch(/^\d{8}$/);
    });

    it('still matches an existing patient by name+birthDate when the supplied participantId is a placeholder', async () => {
      const existingPatient = {
        _id: '507f1f77bcf86cd799439011',
        participantId: '87654321',
        patientName: 'Paciente Repetido',
        birthDate: new Date('1990-05-15'),
      };
      identityCandidates([{ participantId: '87654321', patientName: 'Paciente Repetido', birthDate: new Date('1990-05-15') }]);
      patientsCollection.findOne.mockResolvedValueOnce(existingPatient);
      patientsCollection.updateOne.mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 });

      const result = await patientIdentityService.matchOrUpsertParticipant(db, {
        participantId: 'placeholder',
        patientName: 'Paciente Repetido',
        birthDate: '15/05/1990',
      });

      expect(result.created).toBe(false);
      expect(result.patient.participantId).toBe('87654321');
      expect(patientsCollection.findOne).toHaveBeenCalledWith({ participantId: '87654321' });
    });
  });

  describe('Error handling', () => {
    it('deve lançar erro se não houver participantId e nem (patientName + birthDate)', async () => {
      await expect(
        patientIdentityService.matchOrUpsertParticipant(db, {
          sex: 'M',
          cpf: '12345678900',
          // Sem participantId, patientName ou birthDate
        })
      ).rejects.toThrow('Identificação insuficiente');
    });
  });

  describe('Field updates', () => {
    it('deve atualizar campos demográficos permitidos no upsert', async () => {
      const existingPatient = {
        _id: '507f1f77bcf86cd799439011',
        participantId: '22222222',
        patientName: 'John Doe',
      };

      patientsCollection.findOne.mockResolvedValueOnce(existingPatient);

      await patientIdentityService.matchOrUpsertParticipant(db, {
        participantId: '22222222',
        email: 'john@test.com',
        phone: '+5511987654321',
        sex: 'M',
        cpf: '12345678900',
      });

      const updateCall = patientsCollection.updateOne.mock.calls[0][1];
      expect(updateCall.$set).toMatchObject({
        email: 'john@test.com',
        phone: '+5511987654321',
        sex: 'M',
        cpf: '12345678900',
      });

      // RF005/RNF007 (#575): civil identity never lands on Patient, even
      // when carried on `existing` from pre-#575 data.
      expect(updateCall.$set).not.toHaveProperty('patientName');
      expect(updateCall.$set).not.toHaveProperty('birthDate');
      expect(updateCall.$set).not.toHaveProperty('identityDocument');
    });
  });
});
