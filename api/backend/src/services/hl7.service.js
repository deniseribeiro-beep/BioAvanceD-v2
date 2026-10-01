const logger = require('../utils/logger');
const { ObjectId } = require('mongodb');
const { SPECIMEN_TYPES } = require('../config/constants/specimen.constants');

/**
 * Service de Geração HL7
 * Health Level Seven - Padrão de interoperabilidade em saúde
 * 
 * Suporta:
 * - HL7 v2.x (mensagens pipe-delimited)
 * - FHIR R4 (JSON)
 * - CDA (Clinical Document Architecture - XML)
 */
class HL7Service {
  /**
   * Formata data/hora no formato HL7 v2.x (YYYYMMDDHHMMSS)
   */
  formatHL7DateTime(date) {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    
    return `${year}${month}${day}${hours}${minutes}${seconds}`;
  }

  /**
   * Formata data no formato HL7 v2.x (YYYYMMDD)
   */
  formatHL7Date(date) {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    
    return `${year}${month}${day}`;
  }

  /**
   * Gera mensagem HL7 v2.x para arquivo de análise
   * Formato: Pipe-delimited (|)
   * 
   * Segmentos:
   * - MSH: Message Header
   * - PID: Patient Identification (apenas participantId anonimizado)
   * - OBR: Observation Request
   * - OBX: Observation/Result
   * - SPM: Specimen
   */
  async generateHL7v2Message(db, sampleFile, sample, participantId) {
    try {
      const messageID = this.generateMessageID();
      const timestamp = this.formatHL7DateTime(new Date());
      const facilityName = process.env.FACILITY_NAME || 'BioAdvanceD';
      
      // MSH - Message Header
      const msh = this.buildMSH(messageID, timestamp);
      
      // PID - Patient Identification (LGPD: apenas participantId anonimizado)
      const pid = this.buildPID(participantId);
      
      // SPM - Specimen
      const spm = this.buildSPM(sampleFile, sample);
      
      // OBR - Observation Request
      const obr = this.buildOBR(sampleFile, sample);
      
      // OBX - Observation/Result
      const obx = this.buildOBX(sampleFile, sample);
      
      // Monta mensagem completa
      const message = [
        msh,
        pid,
        spm,
        obr,
        obx
      ].filter(Boolean).join('\r');
      
      return message;
    } catch (error) {
      logger.error('Erro ao gerar mensagem HL7 v2.x:', error.message);
      throw error;
    }
  }

  /**
   * MSH - Message Header
   * Formato: MSH|^~\\&|SendingApp|SendingFacility|ReceivingApp|ReceivingFacility|DateTime|Security|MessageType|MessageID|ProcessingID|VersionID
   */
  buildMSH(messageID, timestamp) {
    const sendingApp = 'BioAdvanceD';
    const sendingFacility = process.env.FACILITY_NAME || 'BioAdvanceD';
    const receivingApp = '';
    const receivingFacility = '';
    const security = '';
    const messageType = 'ORU^R01^ORU_R01'; // Observation Result (unsolicited)
    const processingID = 'P'; // Production
    const versionID = '2.8';
    
    return `MSH|^~\\&|${sendingApp}|${sendingFacility}|${receivingApp}|${receivingFacility}|${timestamp}|${security}|${messageType}|${messageID}|${processingID}|${versionID}`;
  }

  /**
   * PID - Patient Identification
   * LGPD: Apenas participantId anonimizado (8 dígitos), sem dados pessoais
   */
  buildPID(participantId) {
    const pid2 = ''; // Patient ID (Internal)
    const pid3 = `${participantId}^^^BioAdvanceD^MR`; // Patient Identifier List (anonimizado)
    const pid5 = '^^^' ; // Patient Name (vazio - LGPD)
    const pid7 = ''; // Date/Time of Birth (vazio - LGPD)
    const pid8 = ''; // Administrative Sex (vazio - LGPD)
    
    return `PID|1|${pid2}|${pid3}||${pid5}||${pid7}||${pid8}|||||||||||||||||||||||||`;
  }

  /**
   * SPM - Specimen
   */
  buildSPM(sampleFile, sample) {
    const spmId = sample._id?.toString() || sample.specimenId || '';
    const specimenType = sample.sampleType || '';
    const collectionDateTime = sampleFile.collectionDateTime 
      ? this.formatHL7DateTime(sampleFile.collectionDateTime)
      : (sample.registeredAt ? this.formatHL7DateTime(sample.registeredAt) : '');
    
    return `SPM|1|${spmId}||${specimenType}|||${collectionDateTime}|||||||`;
  }

  /**
   * OBR - Observation Request
   */
  buildOBR(sampleFile, sample) {
    const placerOrderNumber = sampleFile.orderNumber || '';
    const fillerOrderNumber = sampleFile.accessionNumber || sampleFile._id?.toString() || '';
    const universalServiceID = sampleFile.loincCode 
      ? `${sampleFile.loincCode}^${sampleFile.fileType}^LN`
      : `^${sampleFile.fileType}`;
    const observationDateTime = sampleFile.analysisDateTime 
      ? this.formatHL7DateTime(sampleFile.analysisDateTime)
      : (sampleFile.processingDateTime ? this.formatHL7DateTime(sampleFile.processingDateTime) : this.formatHL7DateTime(new Date()));
    const specimenReceivedDateTime = sampleFile.processingDateTime 
      ? this.formatHL7DateTime(sampleFile.processingDateTime)
      : this.formatHL7DateTime(sampleFile.uploadDate || new Date());
    
    return `OBR|1|${placerOrderNumber}|${fillerOrderNumber}||${universalServiceID}|${observationDateTime}||||||${specimenReceivedDateTime}|||||||||||||||||||${sampleFile.resultStatus || 'F'}`;
  }

  /**
   * OBX - Observation/Result
   */
  buildOBX(sampleFile, sample) {
    const valueType = sampleFile.fileType === 'RAW' ? 'ED' : 'TX'; // ED = Encapsulated Data, TX = Text
    const observationID = sampleFile.loincCode || `FILE^${sampleFile.fileType}`;
    const observationValue = sampleFile.resultValue !== null && sampleFile.resultValue !== undefined
      ? `${sampleFile.resultValue}${sampleFile.unitOfMeasure ? `^${sampleFile.unitOfMeasure}` : ''}`
      : this.exportFileLabel(sampleFile);
    const units = sampleFile.unitOfMeasure || '';
    const referencesRange = '';
    const abnormalFlags = this.mapInterpretationToHL7(sampleFile.interpretation);
    const observationResultStatus = sampleFile.resultStatus || 'F'; // F = Final, P = Preliminary, C = Canceled
    
    return `OBX|1|${valueType}|${observationID}|${this.exportFileLabel(sampleFile)}||${observationValue}|${units}||${referencesRange}||${abnormalFlags}|||${observationResultStatus}|||${this.formatHL7DateTime(sampleFile.uploadDate || new Date())}||`;
  }

  /**
   * Mapeia interpretação para flags HL7
   * N = Normal, A = Abnormal, H = High, L = Low, HH = Very High, LL = Very Low
   */
  mapInterpretationToHL7(interpretation) {
    if (!interpretation) return '';
    const upper = String(interpretation).toUpperCase();
    const map = {
      'N': 'N',
      'NORMAL': 'N',
      'A': 'A',
      'ABNORMAL': 'A',
      'ANORMAL': 'A',
      'H': 'H',
      'HIGH': 'H',
      'ALTO': 'H',
      'L': 'L',
      'LOW': 'L',
      'BAIXO': 'L',
      'HH': 'HH',
      'VERY HIGH': 'HH',
      'MUITO ALTO': 'HH',
      'LL': 'LL',
      'VERY LOW': 'LL',
      'MUITO BAIXO': 'LL',
      'C': 'C',
      'CRITICAL': 'C',
      'CRÍTICO': 'C'
    };
    return map[upper] || '';
  }

  /**
   * Gera ID único para mensagem HL7
   */
  generateMessageID() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 9).toUpperCase();
    return `MSG${timestamp}${random}`;
  }

  /**
   * Gera Resource FHIR R4 (DiagnosticReport + Observation + Specimen)
   */
  async generateFHIRResource(db, sampleFile, sample, participantId) {
    try {
      const baseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
      const fileID = sampleFile._id?.toString() || '';
      
      // DiagnosticReport
      const diagnosticReport = {
        resourceType: 'DiagnosticReport',
        id: fileID,
        status: this.mapStatusToFHIR(sampleFile.resultStatus),
        category: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/v2-0074',
            code: 'LAB',
            display: 'Laboratory'
          }]
        }],
        code: sampleFile.loincCode ? {
          coding: [{
            system: 'http://loinc.org',
            code: sampleFile.loincCode,
            display: sampleFile.fileType
          }]
        } : {
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/v2-0074',
            code: 'LAB',
            display: 'Laboratory Analysis'
          }]
        },
        subject: {
          reference: `Patient/${participantId}`,
          identifier: {
            system: `${baseUrl}/fhir/Patient`,
            value: participantId
          }
        },
        effectiveDateTime: sampleFile.analysisDateTime 
          ? (sampleFile.analysisDateTime instanceof Date ? sampleFile.analysisDateTime.toISOString() : new Date(sampleFile.analysisDateTime).toISOString())
          : (sampleFile.uploadDate ? (sampleFile.uploadDate instanceof Date ? sampleFile.uploadDate.toISOString() : new Date(sampleFile.uploadDate).toISOString()) : new Date().toISOString()),
        issued: sampleFile.uploadDate 
          ? (sampleFile.uploadDate instanceof Date ? sampleFile.uploadDate.toISOString() : new Date(sampleFile.uploadDate).toISOString())
          : new Date().toISOString(),
        specimen: [{
          reference: `Specimen/${sample._id?.toString() || sample.specimenId}`
        }],
        result: [{
          reference: `Observation/${fileID}`
        }],
        presentedForm: [{
          contentType: this.getMimeType(sampleFile.fileType),
          url: `${baseUrl}/api/samples/${sample._id?.toString()}/files/${fileID}/download`,
          title: this.exportFileLabel(sampleFile),
          creation: sampleFile.uploadDate 
            ? (sampleFile.uploadDate instanceof Date ? sampleFile.uploadDate.toISOString() : new Date(sampleFile.uploadDate).toISOString())
            : new Date().toISOString()
        }],
        identifier: sampleFile.accessionNumber ? [{
          system: `${baseUrl}/fhir/DiagnosticReport`,
          value: sampleFile.accessionNumber
        }] : [],
        meta: {
          versionId: '1',
          lastUpdated: new Date().toISOString()
        }
      };

      // Observation
      const observation = {
        resourceType: 'Observation',
        id: fileID,
        status: this.mapStatusToFHIR(sampleFile.resultStatus),
        category: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/observation-category',
            code: 'laboratory',
            display: 'Laboratory'
          }]
        }],
        code: sampleFile.loincCode ? {
          coding: [{
            system: 'http://loinc.org',
            code: sampleFile.loincCode,
            display: sampleFile.fileType
          }]
        } : {
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/v2-0074',
            code: sampleFile.fileType,
            display: sampleFile.fileType
          }]
        },
        subject: {
          reference: `Patient/${participantId}`,
          identifier: {
            system: `${baseUrl}/fhir/Patient`,
            value: participantId
          }
        },
        effectiveDateTime: sampleFile.analysisDateTime 
          ? (sampleFile.analysisDateTime instanceof Date ? sampleFile.analysisDateTime.toISOString() : new Date(sampleFile.analysisDateTime).toISOString())
          : new Date().toISOString(),
        issued: sampleFile.uploadDate 
          ? (sampleFile.uploadDate instanceof Date ? sampleFile.uploadDate.toISOString() : new Date(sampleFile.uploadDate).toISOString())
          : new Date().toISOString(),
        valueString: this.exportFileLabel(sampleFile),
        interpretation: sampleFile.interpretation ? [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
            code: this.mapInterpretationToFHIR(sampleFile.interpretation),
            display: sampleFile.interpretation
          }]
        }] : [],
        specimen: {
          reference: `Specimen/${sample._id?.toString() || sample.specimenId}`
        },
        meta: {
          versionId: '1',
          lastUpdated: new Date().toISOString()
        }
      };

      // Specimen
      const specimen = {
        resourceType: 'Specimen',
        id: sample._id?.toString() || sample.specimenId?.toString() || '',
        type: {
          coding: [{
            system: 'http://snomed.info/sct',
            code: this.mapSampleTypeToSNOMED(sample.sampleType),
            display: this.getSampleTypeDisplay(sample.sampleType)
          }]
        },
        subject: {
          reference: `Patient/${participantId}`,
          identifier: {
            system: `${baseUrl}/fhir/Patient`,
            value: participantId
          }
        },
        collection: {
          collectedDateTime: sample.registeredAt
            ? (sample.registeredAt instanceof Date ? sample.registeredAt.toISOString() : new Date(sample.registeredAt).toISOString())
            : new Date().toISOString()
        },
        identifier: sample.barcode ? [{
          system: `${baseUrl}/fhir/Specimen`,
          value: sample.barcode
        }] : [],
        meta: {
          versionId: '1',
          lastUpdated: new Date().toISOString()
        }
      };

      // Bundle FHIR
      const bundle = {
        resourceType: 'Bundle',
        id: `bundle-${fileID}`,
        type: 'document',
        timestamp: new Date().toISOString(),
        entry: [
          {
            fullUrl: `${baseUrl}/fhir/DiagnosticReport/${fileID}`,
            resource: diagnosticReport
          },
          {
            fullUrl: `${baseUrl}/fhir/Observation/${fileID}`,
            resource: observation
          },
          {
            fullUrl: `${baseUrl}/fhir/Specimen/${sample._id?.toString() || sample.specimenId}`,
            resource: specimen
          }
        ],
        meta: {
          versionId: '1',
          lastUpdated: new Date().toISOString()
        }
      };

      return bundle;
    } catch (error) {
      logger.error('Erro ao gerar resource FHIR:', error.message);
      throw error;
    }
  }

  /**
   * Gera documento CDA (Clinical Document Architecture)
   */
  async generateCDA(db, sampleFile, sample, participantId) {
    try {
      const timestamp = new Date().toISOString();
      const fileID = sampleFile._id?.toString() || '';
      
      // XML CDA básico conforme HL7 CDA Release 2.0
      const cda = `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <realmCode code="BR"/>
  <typeId root="2.16.840.1.113883.1.3" extension="POCD_HD000040"/>
  <templateId root="2.16.840.1.113883.10.20.22.1.1"/>
  <id root="${fileID}" extension="${sampleFile.accessionNumber || fileID}"/>
  <code code="11502-2" codeSystem="2.16.840.1.113883.6.1" codeSystemName="LOINC" displayName="Laboratory Report"/>
  <title>Laboratory Analysis Report</title>
  <effectiveTime value="${this.formatHL7DateTime(new Date())}"/>
  <confidentialityCode code="N" codeSystem="2.16.840.1.113883.5.25"/>
  <languageCode code="pt-BR"/>
  <recordTarget>
    <patientRole>
      <id extension="${participantId}" root="2.16.840.1.113883.3.933"/>
      <!-- LGPD: Apenas ID anonimizado, sem dados pessoais -->
    </patientRole>
  </recordTarget>
  <author>
    <time value="${this.formatHL7DateTime(sampleFile.uploadDate || new Date())}"/>
    <assignedAuthor>
      <id extension="${sampleFile.uploaderAnonId || 'USR-SYSTEM'}" root="2.16.840.1.113883.3.933"/>
    </assignedAuthor>
  </author>
  <custodian>
    <assignedCustodian>
      <representedCustodianOrganization>
        <id root="2.16.840.1.113883.3.933"/>
        <name>${process.env.FACILITY_NAME || 'BioAdvanceD'}</name>
      </representedCustodianOrganization>
    </assignedCustodian>
  </custodian>
  <component>
    <structuredBody>
      <component>
        <section>
          <templateId root="2.16.840.1.113883.10.20.22.2.10"/>
          <code code="26436-6" codeSystem="2.16.840.1.113883.6.1" codeSystemName="LOINC" displayName="Laboratory Studies"/>
          <title>Laboratory Analysis</title>
          <text>
            <paragraph>
              <content ID="file-description">File: ${this.escapeXML(this.exportFileLabel(sampleFile))}</content>
              <content>Type: ${this.escapeXML(sampleFile.fileType)}</content>
              <content>Size: ${this.formatFileSize(sampleFile.fileSize)}</content>
              ${sampleFile.loincCode ? `<content>LOINC Code: ${this.escapeXML(sampleFile.loincCode)}</content>` : ''}
              ${sampleFile.procedureCode ? `<content>Procedure Code: ${this.escapeXML(sampleFile.procedureCode)}</content>` : ''}
              ${sampleFile.resultStatus ? `<content>Status: ${this.escapeXML(sampleFile.resultStatus)}</content>` : ''}
              ${sampleFile.interpretation ? `<content>Interpretation: ${this.escapeXML(sampleFile.interpretation)}</content>` : ''}
            </paragraph>
          </text>
          <entry>
            <organizer classCode="BATTERY" moodCode="EVN">
              <code code="26436-6" codeSystem="2.16.840.1.113883.6.1" codeSystemName="LOINC"/>
              <statusCode code="completed"/>
              <component>
                <observation classCode="OBS" moodCode="EVN">
                  <code code="${sampleFile.loincCode || 'LAB'}" codeSystem="2.16.840.1.113883.6.1" codeSystemName="LOINC" displayName="${this.escapeXML(sampleFile.fileType)}"/>
                  <statusCode code="completed"/>
                  <effectiveTime value="${this.formatHL7DateTime(sampleFile.analysisDateTime || sampleFile.uploadDate || new Date())}"/>
                  ${sampleFile.resultValue !== null && sampleFile.resultValue !== undefined ? `
                  <value xsi:type="PQ" value="${sampleFile.resultValue}" unit="${sampleFile.unitOfMeasure || ''}"/>
                  ` : `
                  <value xsi:type="ED" mediaType="${this.getMimeType(sampleFile.fileType)}">${this.escapeXML(this.exportFileLabel(sampleFile))}</value>
                  `}
                  ${sampleFile.interpretation ? `
                  <interpretationCode code="${this.mapInterpretationToHL7(sampleFile.interpretation)}" codeSystem="2.16.840.1.113883.5.83"/>
                  ` : ''}
                </observation>
              </component>
            </organizer>
          </entry>
        </section>
      </component>
      <component>
        <section>
          <templateId root="2.16.840.1.113883.10.20.22.2.7.1"/>
          <code code="30954-2" codeSystem="2.16.840.1.113883.6.1" codeSystemName="LOINC" displayName="Relevant Diagnostic Tests"/>
          <title>Specimen Information</title>
          <text>
            <paragraph>
              <content>Sample ID: ${this.escapeXML(String(sample._id || sample.specimenId || ''))}</content>
              <content>Sample Type: ${this.escapeXML(sample.sampleType || '')}</content>
              ${sample.barcode ? `<content>Barcode: ${this.escapeXML(sample.barcode)}</content>` : ''}
              ${sample.registeredAt ? `<content>Collection Date: ${this.formatHL7Date(sample.registeredAt)}</content>` : ''}
            </paragraph>
          </text>
        </section>
      </component>
    </structuredBody>
  </component>
</ClinicalDocument>`;
      
      return cda;
    } catch (error) {
      logger.error('Erro ao gerar documento CDA:', error.message);
      throw error;
    }
  }

  /**
   * Mapeia status para FHIR
   */
  mapStatusToFHIR(status) {
    if (!status) return 'final';
    const upper = String(status).toUpperCase();
    const map = {
      'F': 'final',
      'FINAL': 'final',
      'P': 'preliminary',
      'PRELIMINARY': 'preliminary',
      'PRELIMINAR': 'preliminary',
      'C': 'cancelled',
      'CANCELED': 'cancelled',
      'CANCELADO': 'cancelled'
    };
    return map[upper] || 'final';
  }

  /**
   * Mapeia interpretação para FHIR
   */
  mapInterpretationToFHIR(interpretation) {
    if (!interpretation) return 'N';
    const upper = String(interpretation).toUpperCase();
    const map = {
      'N': 'N',
      'NORMAL': 'N',
      'A': 'A',
      'ABNORMAL': 'A',
      'ANORMAL': 'A',
      'H': 'H',
      'HIGH': 'H',
      'ALTO': 'H',
      'L': 'L',
      'LOW': 'L',
      'BAIXO': 'L',
      'HH': 'HH',
      'VERY HIGH': 'HH',
      'MUITO ALTO': 'HH',
      'LL': 'LL',
      'VERY LOW': 'LL',
      'MUITO BAIXO': 'LL',
      'C': 'CRIT',
      'CRITICAL': 'CRIT',
      'CRÍTICO': 'CRIT'
    };
    return map[upper] || 'N';
  }

  /**
   * Mapeia tipo de amostra para código SNOMED CT (simplificado)
   */
  mapSampleTypeToSNOMED(sampleType) {
    if (!sampleType) return '119297000';
    const map = {
      PLASMA: '119361006',
      SERUM: '119297000',
      ERYTHROCYTES: '119297000',
      URINE: '122575003',
      DBS: '119297000',
      TISSUE_FRESH: '119361006',
      TISSUE_FFPE: '119361006',
      PBMC: '119297000',
      SALIVA: '258467004',
      FECES: '119297000',
      CSF: '430864002'
    };
    return map[sampleType] || '119297000';
  }

  getSampleTypeDisplay(sampleType) {
    const specimenType = SPECIMEN_TYPES.find((item) => item.id === sampleType);
    return specimenType?.label || sampleType || 'Desconhecido';
  }

  /**
   * Obtém MIME type baseado no tipo de arquivo
   */
  getMimeType(fileType) {
    const map = {
      'RAW': 'application/octet-stream',
      'ZIP': 'application/zip',
      'CSV': 'text/csv',
      'XLS': 'application/vnd.ms-excel',
      'XLSX': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'PDF': 'application/pdf',
      'TXT': 'text/plain'
    };
    return map[fileType] || 'application/octet-stream';
  }

  /**
   * Escapa XML para prevenir injection
   */
  /**
   * #1272: the label a message gives the file. The stored fileName is the
   * uploader's original name, which can carry a person's name
   * ("maria_silva_hemograma.pdf"), and RNF007 keeps exports to pseudonymised
   * or opaque identifiers. The file's own id plus its extension identifies
   * it as well; the original name stays in the stored record and the
   * download.
   */
  exportFileLabel(sampleFile) {
    const id = sampleFile && sampleFile._id ? String(sampleFile._id) : 'file';
    const name = (sampleFile && typeof sampleFile.fileName === 'string') ? sampleFile.fileName : '';
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot).toLowerCase().replace(/[^.a-z0-9]/g, '') : '';
    return `${id}${ext}`;
  }

  escapeXML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Formata tamanho de arquivo
   */
  formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 bytes';
    const k = 1024;
    const sizes = ['bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }
}

module.exports = new HL7Service();

