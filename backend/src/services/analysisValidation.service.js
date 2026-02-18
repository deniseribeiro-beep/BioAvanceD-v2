const logger = require('../utils/logger');
const { ObjectId } = require('mongodb');

/**
 * Service para validar amostras e consentimento de pacientes antes de upload de análise
 * Garante que:
 * 1. A amostra existe no banco de dados
 * 2. O paciente da amostra tem consentimento assinado
 */
class AnalysisValidationService {
  /**
   * Valida se a amostra existe
   * Suporta: ObjectId, sampleID (ex: "00001"), barcode (ex: "BR-2025-001")
   */
  async validateSampleExists(db, sampleIdentifier) {
    try {
      const samplesCollection = db.collection('amostras');
      let sample = null;

      // Tenta buscar por ObjectId
      if (ObjectId.isValid(sampleIdentifier)) {
        sample = await samplesCollection.findOne({ _id: new ObjectId(sampleIdentifier) });
        if (sample) return { success: true, sample };
      }

      // Tenta buscar por sampleID (ex: "00001")
      sample = await samplesCollection.findOne({ sampleID: sampleIdentifier });
      if (sample) return { success: true, sample };

      // Tenta buscar por barcode (ex: "BR-2025-001")
      sample = await samplesCollection.findOne({ barcode: sampleIdentifier });
      if (sample) return { success: true, sample };

      return {
        success: false,
        error: `Amostra "${sampleIdentifier}" não encontrada. Verifique o ID ou código de barras.`
      };
    } catch (error) {
      logger.error('Erro ao validar existência da amostra:', error.message);
      return {
        success: false,
        error: 'Erro ao validar amostra no banco de dados'
      };
    }
  }

  /**
   * Valida se o paciente da amostra tem consentimento assinado
   */
  async validatePatientConsent(db, sample) {
    try {
      if (!sample.patientID) {
        return {
          success: false,
          error: 'Amostra não possui ID de paciente associado'
        };
      }

      const patientsCollection = db.collection('pacientes');
      
      // Busca o paciente e verifica status de consentimento
      const patient = await patientsCollection.findOne({ 
        patientID: sample.patientID 
      });

      if (!patient) {
        return {
          success: false,
          error: `Paciente ${sample.patientID} não encontrado no sistema`
        };
      }

      // Valida status de consentimento
      if (!patient.status || patient.status !== 'ACCEPTED_CONSENT') {
        const status = patient.status || 'NÃO DEFINIDO';
        return {
          success: false,
          error: `Consentimento não assinado. Status: ${status}. O paciente deve aceitar o termo de consentimento antes de uploads.`,
          patientStatus: status
        };
      }

      // Verifica se o consentimento tem data de aceitação
      if (!patient.consentAcceptedAt) {
        return {
          success: false,
          error: 'Consentimento aceito mas data de aceitação não registrada. Contate o suporte.'
        };
      }

      return {
        success: true,
        patient: {
          patientID: patient.patientID,
          consentStatus: patient.status,
          consentAcceptedAt: patient.consentAcceptedAt
        }
      };
    } catch (error) {
      logger.error('Erro ao validar consentimento do paciente:', error.message);
      return {
        success: false,
        error: 'Erro ao validar consentimento do paciente'
      };
    }
  }

  /**
   * Validação completa: amostra existe + paciente tem consentimento
   */
  async validateUploadEligibility(db, sampleIdentifier) {
    try {
      // 1. Valida existência da amostra
      const sampleValidation = await this.validateSampleExists(db, sampleIdentifier);
      if (!sampleValidation.success) {
        return sampleValidation;
      }

      const sample = sampleValidation.sample;

      // 2. Valida consentimento do paciente
      const consentValidation = await this.validatePatientConsent(db, sample);
      if (!consentValidation.success) {
        return consentValidation;
      }

      return {
        success: true,
        eligible: true,
        sample: {
          _id: sample._id.toString(),
          sampleID: sample.sampleID,
          barcode: sample.barcode,
          patientID: sample.patientID,
          sampleType: sample.sampleType,
          currentStatus: sample.currentStatus
        },
        patient: consentValidation.patient
      };
    } catch (error) {
      logger.error('Erro na validação completa de elegibilidade:', error.message);
      return {
        success: false,
        error: 'Erro ao validar elegibilidade para upload'
      };
    }
  }
}

module.exports = new AnalysisValidationService();
