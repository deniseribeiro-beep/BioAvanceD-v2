import { describe, it, expect, beforeEach } from 'vitest';

const {
  generateSampleHash,
  stableSerialize,
  deepSort,
  buildClinicalPharmacologyHash,
} = require('../../src/services/MerkleService');

describe('MerkleService - Pharmacology Integrity & Tampering Detection', () => {
  let validSample;

  beforeEach(() => {
    validSample = {
      sampleID: 'S-1001',
      participantId: '12345678',
      participantName: 'Paciente Teste',
      sprec: {
        specimen_type: 'PLASMA',
        collection_date: '2024-01-15',
      },
      clinicalData: {
        orphaCode: 'ORPHA:324',
        cid: 'E75.2',
        biomarkers_values: {
          'Lyso-Gb3': '4.2',
          'Atividade de Alfa-galactosidase A': '2.1',
        },
      },
      pharmacologyData: {
        treatmentStatus: 'ON_TREATMENT',
        medicationName: 'Migalastat',
        atcCode: 'A16AX27',
        atcClass: 'A',
      },
    };
  });

  describe('Hash consistency for pharmacology data', () => {
    it('deve gerar hash SHA256 consistente para o mesmo sample', () => {
      const hash1 = generateSampleHash(validSample);
      const hash2 = generateSampleHash(validSample);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/); // 64-char hex SHA256
    });

    it('deve incluir todos os campos de pharmacologyData no hash', () => {
      const hash1 = generateSampleHash(validSample);

      // Altere cada campo de pharmacologyData individualmente
      const tamperedSamples = [
        { ...validSample, pharmacologyData: { ...validSample.pharmacologyData, treatmentStatus: 'NAIVE' } },
        { ...validSample, pharmacologyData: { ...validSample.pharmacologyData, medicationName: 'Ataluren' } },
        { ...validSample, pharmacologyData: { ...validSample.pharmacologyData, atcCode: 'C01BD01' } },
        { ...validSample, pharmacologyData: { ...validSample.pharmacologyData, atcClass: 'C' } },
      ];

      tamperedSamples.forEach((tampered) => {
        const hash = generateSampleHash(tampered);
        expect(hash).not.toBe(hash1);
      });
    });

    it('deve ser sensível a alterações no atcCode', () => {
      const hash1 = generateSampleHash(validSample);

      const tampered = {
        ...validSample,
        pharmacologyData: {
          ...validSample.pharmacologyData,
          atcCode: 'A16AX28', // Mudança de 1 dígito
        },
      };

      const hash2 = generateSampleHash(tampered);
      expect(hash2).not.toBe(hash1);
    });

    it('deve ser sensível a alterações no medicationName', () => {
      const hash1 = generateSampleHash(validSample);

      const tampered = {
        ...validSample,
        pharmacologyData: {
          ...validSample.pharmacologyData,
          medicationName: 'Migalastat Hydrochloride', // Nome alterado
        },
      };

      const hash2 = generateSampleHash(tampered);
      expect(hash2).not.toBe(hash1);
    });

    it('deve normalizar ATC codes removendo prefixo "ATC:"', () => {
      const sample1 = {
        ...validSample,
        pharmacologyData: {
          ...validSample.pharmacologyData,
          atcCode: 'A16AX27',
        },
      };

      const sample2 = {
        ...validSample,
        pharmacologyData: {
          ...validSample.pharmacologyData,
          atcCode: 'ATC:A16AX27', // Com prefixo
        },
      };

      const hash1 = generateSampleHash(sample1);
      const hash2 = generateSampleHash(sample2);

      expect(hash1).toBe(hash2); // Devem ser idênticos após normalização
    });
  });

  describe('Tampering detection scenarios', () => {
    it('Cenário: Alterar um valor de atcCode diretamente no mock - deve quebrar Merkle Root', () => {
      const originalHash = generateSampleHash(validSample);

      // Simular tampering no banco de dados
      const tamperedSample = JSON.parse(JSON.stringify(validSample));
      tamperedSample.pharmacologyData.atcCode = 'C01AA01'; // Valor completamente diferente

      const tamperedHash = generateSampleHash(tamperedSample);

      // Verificar que o hash foi alterado
      expect(originalHash).not.toBe(tamperedHash);

      // Em um cenário real de verifyIntegrity(), isso causaria falha
      expect(originalHash).toMatch(/^[a-f0-9]{64}$/);
      expect(tamperedHash).toMatch(/^[a-f0-9]{64}$/);
      expect(originalHash).not.toEqual(tamperedHash);
    });

    it('deve detectar adição de novo campo em pharmacologyData', () => {
      const hash1 = generateSampleHash(validSample);

      const withNewField = {
        ...validSample,
        pharmacologyData: {
          ...validSample.pharmacologyData,
          custom_field: 'malicious_value',
        },
      };

      const hash2 = generateSampleHash(withNewField);
      expect(hash2).not.toBe(hash1);
    });

    it('deve detectar remoção de campo em pharmacologyData', () => {
      const hash1 = generateSampleHash(validSample);

      const withoutField = {
        ...validSample,
        pharmacologyData: {
          treatmentStatus: validSample.pharmacologyData.treatmentStatus,
          medicationName: validSample.pharmacologyData.medicationName,
          // Faltando atcCode e atcClass
        },
      };

      const hash2 = generateSampleHash(withoutField);
      expect(hash2).not.toBe(hash1);
    });

    it('deve detectar alteração em clinicalData que afeta hash geral', () => {
      const hash1 = generateSampleHash(validSample);

      const tamperedClinical = {
        ...validSample,
        clinicalData: {
          ...validSample.clinicalData,
          'Lyso-Gb3': '999.9', // Valor suspeito alterado
        },
      };

      const hash2 = generateSampleHash(tamperedClinical);
      expect(hash2).not.toBe(hash1);
    });

    it('deve detectar alteração em participant identity', () => {
      const hash1 = generateSampleHash(validSample);

      const tamperedIdentity = {
        ...validSample,
        participantId: '99999999', // Paciente alterado
        participantName: 'Outro Paciente',
      };

      const hash2 = generateSampleHash(tamperedIdentity);
      expect(hash2).not.toBe(hash1);
    });
  });

  describe('Stable serialization & determinism', () => {
    it('deve serializar de forma determinística independente da ordem das chaves', () => {
      const sample1 = {
        sampleID: 'S-1',
        participantId: '12345678',
        pharmacologyData: {
          atcCode: 'A16AX27',
          medicationName: 'Migalastat',
          treatmentStatus: 'ON_TREATMENT',
          atcClass: 'A',
        },
      };

      const sample2 = {
        participantId: '12345678',
        pharmacologyData: {
          medicationName: 'Migalastat',
          atcClass: 'A',
          atcCode: 'A16AX27',
          treatmentStatus: 'ON_TREATMENT',
        },
        sampleID: 'S-1',
      };

      expect(generateSampleHash(sample1)).toBe(generateSampleHash(sample2));
    });

    it('deve gerar hash diferente se tratamento_status muda de ordem (order-sensitive para valores)', () => {
      const sample1 = JSON.parse(JSON.stringify(validSample));
      const sample2 = JSON.parse(JSON.stringify(validSample));

      // Se mudar o tratamento para um diferente
      sample2.pharmacologyData.treatmentStatus = 'TREATED';

      expect(generateSampleHash(sample1)).not.toBe(generateSampleHash(sample2));
    });
  });

  describe('Clinical + Pharmacology combined hash', () => {
    it('buildClinicalPharmacologyHash deve ser equivalente a generateSampleHash', () => {
      const hash1 = generateSampleHash(validSample);
      const hash2 = buildClinicalPharmacologyHash(validSample);

      expect(hash1).toBe(hash2);
    });

    it('deve falhar integridade se clinicalData OU pharmacologyData for alterada', () => {
      const originalHash = buildClinicalPharmacologyHash(validSample);

      // Alterar clinicalData
      const clinicalTampered = {
        ...validSample,
        clinicalData: {
          ...validSample.clinicalData,
          cid: 'E75.9', // Código alterado
        },
      };
      expect(buildClinicalPharmacologyHash(clinicalTampered)).not.toBe(originalHash);

      // Alterar pharmacologyData
      const pharmacoTampered = {
        ...validSample,
        pharmacologyData: {
          ...validSample.pharmacologyData,
          atcCode: 'C01AA01', // Código alterado
        },
      };
      expect(buildClinicalPharmacologyHash(pharmacoTampered)).not.toBe(originalHash);
    });
  });

  describe('Edge cases', () => {
    it('deve lidar com null/undefined em pharmacologyData', () => {
      const sample1 = {
        ...validSample,
        pharmacologyData: null,
      };

      const sample2 = {
        ...validSample,
        pharmacologyData: undefined,
      };

      const sample3 = {
        ...validSample,
        pharmacologyData: {},
      };

      const hash1 = generateSampleHash(sample1);
      const hash2 = generateSampleHash(sample2);
      const hash3 = generateSampleHash(sample3);

      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
      expect(hash2).toMatch(/^[a-f0-9]{64}$/);
      expect(hash3).toMatch(/^[a-f0-9]{64}$/);
      // Null e undefined devem ser tratados como equivalentes
      expect(hash1).toBe(hash2);
    });

    it('deve lidar com sample vazio', () => {
      const emptyHash = generateSampleHash({});
      expect(emptyHash).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
