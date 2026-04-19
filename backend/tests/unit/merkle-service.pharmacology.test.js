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
      patientID: '12345678',
      patient_identity: {
        patient_id: '12345678',
        patient_name: 'Paciente Teste',
      },
      sprec: {
        specimen_type: 'PLASMA',
        collection_date: '2024-01-15',
      },
      clinical_data: {
        orphaCode: 'ORPHA:324',
        cid: 'E75.2',
        biomarkers_values: {
          'Lyso-Gb3': '4.2',
          'Atividade de Alfa-galactosidase A': '2.1',
        },
      },
      pharmacology_data: {
        treatment_status: 'ON_TREATMENT',
        drug_name: 'Migalastat',
        atc_code: 'A16AX27',
        atc_level_1: 'A',
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

    it('deve incluir todos os campos de pharmacology_data no hash', () => {
      const hash1 = generateSampleHash(validSample);

      // Altere cada campo de pharmacology_data individualmente
      const tamperedSamples = [
        { ...validSample, pharmacology_data: { ...validSample.pharmacology_data, treatment_status: 'NAIVE' } },
        { ...validSample, pharmacology_data: { ...validSample.pharmacology_data, drug_name: 'Ataluren' } },
        { ...validSample, pharmacology_data: { ...validSample.pharmacology_data, atc_code: 'C01BD01' } },
        { ...validSample, pharmacology_data: { ...validSample.pharmacology_data, atc_level_1: 'C' } },
      ];

      tamperedSamples.forEach((tampered) => {
        const hash = generateSampleHash(tampered);
        expect(hash).not.toBe(hash1);
      });
    });

    it('deve ser sensível a alterações no atc_code', () => {
      const hash1 = generateSampleHash(validSample);

      const tampered = {
        ...validSample,
        pharmacology_data: {
          ...validSample.pharmacology_data,
          atc_code: 'A16AX28', // Mudança de 1 dígito
        },
      };

      const hash2 = generateSampleHash(tampered);
      expect(hash2).not.toBe(hash1);
    });

    it('deve ser sensível a alterações no drug_name', () => {
      const hash1 = generateSampleHash(validSample);

      const tampered = {
        ...validSample,
        pharmacology_data: {
          ...validSample.pharmacology_data,
          drug_name: 'Migalastat Hydrochloride', // Nome alterado
        },
      };

      const hash2 = generateSampleHash(tampered);
      expect(hash2).not.toBe(hash1);
    });

    it('deve normalizar ATC codes removendo prefixo "ATC:"', () => {
      const sample1 = {
        ...validSample,
        pharmacology_data: {
          ...validSample.pharmacology_data,
          atc_code: 'A16AX27',
        },
      };

      const sample2 = {
        ...validSample,
        pharmacology_data: {
          ...validSample.pharmacology_data,
          atc_code: 'ATC:A16AX27', // Com prefixo
        },
      };

      const hash1 = generateSampleHash(sample1);
      const hash2 = generateSampleHash(sample2);

      expect(hash1).toBe(hash2); // Devem ser idênticos após normalização
    });
  });

  describe('Tampering detection scenarios', () => {
    it('Cenário: Alterar um valor de atc_code diretamente no mock - deve quebrar Merkle Root', () => {
      const originalHash = generateSampleHash(validSample);

      // Simular tampering no banco de dados
      const tamperedSample = JSON.parse(JSON.stringify(validSample));
      tamperedSample.pharmacology_data.atc_code = 'C01AA01'; // Valor completamente diferente

      const tamperedHash = generateSampleHash(tamperedSample);

      // Verificar que o hash foi alterado
      expect(originalHash).not.toBe(tamperedHash);

      // Em um cenário real de verifyIntegrity(), isso causaria falha
      expect(originalHash).toMatch(/^[a-f0-9]{64}$/);
      expect(tamperedHash).toMatch(/^[a-f0-9]{64}$/);
      expect(originalHash).not.toEqual(tamperedHash);
    });

    it('deve detectar adição de novo campo em pharmacology_data', () => {
      const hash1 = generateSampleHash(validSample);

      const withNewField = {
        ...validSample,
        pharmacology_data: {
          ...validSample.pharmacology_data,
          custom_field: 'malicious_value',
        },
      };

      const hash2 = generateSampleHash(withNewField);
      expect(hash2).not.toBe(hash1);
    });

    it('deve detectar remoção de campo em pharmacology_data', () => {
      const hash1 = generateSampleHash(validSample);

      const withoutField = {
        ...validSample,
        pharmacology_data: {
          treatment_status: validSample.pharmacology_data.treatment_status,
          drug_name: validSample.pharmacology_data.drug_name,
          // Faltando atc_code e atc_level_1
        },
      };

      const hash2 = generateSampleHash(withoutField);
      expect(hash2).not.toBe(hash1);
    });

    it('deve detectar alteração em clinical_data que afeta hash geral', () => {
      const hash1 = generateSampleHash(validSample);

      const tamperedClinical = {
        ...validSample,
        clinical_data: {
          ...validSample.clinical_data,
          'Lyso-Gb3': '999.9', // Valor suspeito alterado
        },
      };

      const hash2 = generateSampleHash(tamperedClinical);
      expect(hash2).not.toBe(hash1);
    });

    it('deve detectar alteração em patient_identity', () => {
      const hash1 = generateSampleHash(validSample);

      const tamperedIdentity = {
        ...validSample,
        patient_identity: {
          patient_id: '99999999', // Paciente alterado
          patient_name: 'Outro Paciente',
        },
      };

      const hash2 = generateSampleHash(tamperedIdentity);
      expect(hash2).not.toBe(hash1);
    });
  });

  describe('Stable serialization & determinism', () => {
    it('deve serializar de forma determinística independente da ordem das chaves', () => {
      const sample1 = {
        sampleID: 'S-1',
        patientID: '12345678',
        pharmacology_data: {
          atc_code: 'A16AX27',
          drug_name: 'Migalastat',
          treatment_status: 'ON_TREATMENT',
          atc_level_1: 'A',
        },
      };

      const sample2 = {
        patientID: '12345678',
        pharmacology_data: {
          drug_name: 'Migalastat',
          atc_level_1: 'A',
          atc_code: 'A16AX27',
          treatment_status: 'ON_TREATMENT',
        },
        sampleID: 'S-1',
      };

      expect(generateSampleHash(sample1)).toBe(generateSampleHash(sample2));
    });

    it('deve gerar hash diferente se tratamento_status muda de ordem (order-sensitive para valores)', () => {
      const sample1 = JSON.parse(JSON.stringify(validSample));
      const sample2 = JSON.parse(JSON.stringify(validSample));

      // Se mudar o tratamento para um diferente
      sample2.pharmacology_data.treatment_status = 'TREATED';

      expect(generateSampleHash(sample1)).not.toBe(generateSampleHash(sample2));
    });
  });

  describe('Clinical + Pharmacology combined hash', () => {
    it('buildClinicalPharmacologyHash deve ser equivalente a generateSampleHash', () => {
      const hash1 = generateSampleHash(validSample);
      const hash2 = buildClinicalPharmacologyHash(validSample);

      expect(hash1).toBe(hash2);
    });

    it('deve falhar integridade se clinical_data OU pharmacology_data for alterada', () => {
      const originalHash = buildClinicalPharmacologyHash(validSample);

      // Alterar clinical_data
      const clinicalTampered = {
        ...validSample,
        clinical_data: {
          ...validSample.clinical_data,
          cid: 'E75.9', // Código alterado
        },
      };
      expect(buildClinicalPharmacologyHash(clinicalTampered)).not.toBe(originalHash);

      // Alterar pharmacology_data
      const pharmacoTampered = {
        ...validSample,
        pharmacology_data: {
          ...validSample.pharmacology_data,
          atc_code: 'C01AA01', // Código alterado
        },
      };
      expect(buildClinicalPharmacologyHash(pharmacoTampered)).not.toBe(originalHash);
    });
  });

  describe('Edge cases', () => {
    it('deve lidar com null/undefined em pharmacology_data', () => {
      const sample1 = {
        ...validSample,
        pharmacology_data: null,
      };

      const sample2 = {
        ...validSample,
        pharmacology_data: undefined,
      };

      const sample3 = {
        ...validSample,
        pharmacology_data: {},
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
