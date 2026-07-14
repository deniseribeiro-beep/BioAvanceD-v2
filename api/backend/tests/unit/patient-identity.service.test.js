import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const patientIdentityService = require('../../src/services/PatientIdentityService');

describe('PatientIdentityService - Heuristic Patient Matching', () => {
  let db;
  let patientsCollection;

  beforeEach(() => {
    patientsCollection = {
      findOne: vi.fn(),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      insertOne: vi.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439011' }),
    };

    db = {
      listCollections: () => ({
        toArray: async () => ([{ name: 'patients' }]),
      }),
      collection: () => patientsCollection,
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

      // First call returns existing patient (matched by name + birthDate)
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
      patientsCollection.findOne.mockResolvedValueOnce(null);
      patientsCollection.insertOne.mockResolvedValueOnce({ insertedId: '999f1f77bcf86cd799439999' });

      const result = await patientIdentityService.matchOrUpsertParticipant(db, {
        patientName: 'Novo Paciente',
        birthDate: '20/01/2000',
        sex: 'F',
        cpf: '98765432100',
      });

      expect(result.created).toBe(true);
      expect(patientsCollection.insertOne).toHaveBeenCalled();
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

      // Mock: primeiro encontra o paciente existente
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

      // Mock: segunda vez, encontra o mesmo paciente
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
    it('deve normalizar nomes com acentuação', async () => {
      const patterns = [
        { input: 'José Peña', expected: 'jose pena' },
        { input: 'ANDRÉ MÜLLER', expected: 'andre muller' },
        { input: 'Francçois Côté', expected: 'franccois cote' },
      ];

      for (const pattern of patterns) {
        patientsCollection.findOne.mockResolvedValueOnce(null);
        patientsCollection.insertOne.mockResolvedValueOnce({ insertedId: '999f1f77bcf86cd799439999' });

        const result = await patientIdentityService.matchOrUpsertParticipant(db, {
          patientName: pattern.input,
          birthDate: '01/01/1990',
        });

        expect(result.patient.patientNameNormalized).toBe(pattern.expected);
      }
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
    });
  });
});
