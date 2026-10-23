// RF007 AC#5 ("Registrar URI, formato, tamanho...")/#679: dict-02_DICIONARIO.md's
// DataFile entity types two controlled vocabularies -- fileRole (ELM-0317,
// pipeline stage) and fileFormat (ELM-0319, EDAM/MIME-coded) -- that RF007's
// real upload path never populated, leaving canonical.v1.file's own fields
// unvalidated/optional (#679's own investigation). fileFormat maps
// deterministically from the existing closed fileType enum (both describe
// the same technical container format, just different vocabularies -- RAW
// has no specific MIME registration, so it falls back to the generic binary
// type). fileRole is a genuinely different axis (processing-pipeline stage,
// not container format) with no reliable derivation from fileType -- it's
// an explicit optional upload input here, defaulting to dict-02's own
// stated example value 'raw' (a freshly-uploaded analysis file's natural
// stage).
const FILE_ROLES = ['raw', 'intermediate', 'processed', 'derived', 'report', 'manifest'];

// RF007 AC5, V2E-0476 (#1321): the entities a DataFile may be linked to.
// Each reference is { entityType, entityId }.
const LINKED_ENTITY_TYPES = ['Specimen', 'Assay', 'Dataset', 'Consent', 'CollectionGovernanceApproval', 'Study', 'WorkflowRun'];

const MIME_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

const FILE_FORMAT_BY_TYPE = {
  RAW: 'application/octet-stream',
  ZIP: 'application/zip',
  CSV: 'text/csv',
  XLS: 'application/vnd.ms-excel',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  PDF: 'application/pdf',
  TXT: 'text/plain'
};

/**
 * Modelo de validação e estrutura para SampleFile (Arquivos de Análise de Amostra)
 * RF007 - Upload de Arquivos de Análise
 */
class SampleFileModel {
  static validate(data) {
    const errors = [];

    if (!data.sampleID) {
      errors.push('sampleID é obrigatório');
    }

    if (!data.fileName || typeof data.fileName !== 'string') {
      errors.push('fileName é obrigatório e deve ser string');
    }

    if (!data.fileType || typeof data.fileType !== 'string') {
      errors.push('fileType é obrigatório e deve ser string');
    }

    if (!data.storagePath || typeof data.storagePath !== 'string') {
      errors.push('storagePath é obrigatório e deve ser string');
    }

    if (data.fileSize === undefined || data.fileSize === null) {
      errors.push('fileSize é obrigatório');
    } else if (typeof data.fileSize !== 'number' || data.fileSize <= 0) {
      errors.push('fileSize deve ser um número maior que zero');
    }

    // V2E-0472 (#1321): rows written before the object store lack it, so it
    // is optional here, but a supplied value is a non-empty string.
    if (data.storageObjectVersion !== undefined && data.storageObjectVersion !== null
      && (typeof data.storageObjectVersion !== 'string' || data.storageObjectVersion.length === 0)) {
      errors.push('storageObjectVersion deve ser string não vazia');
    }

    // V2E-0471/V2E-0476 (#1321): optional for the same reason, but a
    // supplied mimeType is a MIME type and supplied links are 1..*.
    if (data.mimeType !== undefined && data.mimeType !== null
      && (typeof data.mimeType !== 'string' || !MIME_TYPE_PATTERN.test(data.mimeType))) {
      errors.push('mimeType deve ser um tipo MIME válido');
    }

    if (data.linkedEntityRefs !== undefined && data.linkedEntityRefs !== null) {
      if (!Array.isArray(data.linkedEntityRefs) || data.linkedEntityRefs.length === 0) {
        errors.push('linkedEntityRefs deve ser uma lista não vazia');
      } else {
        data.linkedEntityRefs.forEach((ref, index) => {
          if (!ref || !LINKED_ENTITY_TYPES.includes(ref.entityType)) {
            errors.push(`linkedEntityRefs[${index}].entityType deve ser um dos: ${LINKED_ENTITY_TYPES.join(', ')}`);
          }
          if (!ref || typeof ref.entityId !== 'string' || ref.entityId.length === 0) {
            errors.push(`linkedEntityRefs[${index}].entityId deve ser string não vazia`);
          }
        });
      }
    }

    // Valida tipos de arquivo permitidos
    const allowedTypes = ['RAW', 'ZIP', 'CSV', 'XLS', 'XLSX', 'PDF', 'TXT'];
    if (typeof data.fileType === 'string' && !allowedTypes.includes(data.fileType.toUpperCase())) {
      errors.push(`fileType deve ser um dos: ${allowedTypes.join(', ')}`);
    }

    // dict-02 ELM-0317 (DataFile.fileRole) -- optional here (defaults to
    // 'raw' in create()), but when a caller does supply one it must be a
    // real pipeline-stage value, not an arbitrary string.
    if (data.fileRole !== undefined && data.fileRole !== null && !FILE_ROLES.includes(data.fileRole)) {
      errors.push(`fileRole deve ser um dos: ${FILE_ROLES.join(', ')}`);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static create(data) {
    const baseData = {
      sampleID: data.sampleID, // ID da amostra (pode ser ObjectId string ou número)
      specimenId: data.specimenId || data.sampleID, // referência usada por listFiles/downloadFile/deleteFile
      fileName: data.fileName, // Nome original do arquivo
      fileType: data.fileType.toUpperCase(), // Tipo: RAW, ZIP, CSV, XLS, XLSX, PDF, TXT
      fileRole: data.fileRole || 'raw', // dict-02 ELM-0317 -- papel no pipeline
      fileFormat: data.fileFormat || SampleFileModel.getFileFormatFromType(data.fileType), // dict-02 ELM-0319 -- MIME/EDAM
      mimeType: data.mimeType || null, // V2E-0471 - tipo MIME canônico da extensão (#1321)
      fileSize: data.fileSize, // Tamanho em bytes
      storagePath: data.storagePath, // Caminho no sistema de arquivos (não exposto ao frontend)
      storageUri: data.storageUri || null, // RF007 - URI estável de Object Storage
      storageObjectVersion: data.storageObjectVersion || null, // V2E-0472 - versão do objeto (#1321)
      malwareScan: data.malwareScan || null, // RNF029 C4 (#1321)
      checksum: data.checksum || null, // RF007/RNF029 - SHA-256 do conteúdo original
      checksumAlgorithm: data.checksumAlgorithm || null,
      encryptionAlgorithm: data.encryptionAlgorithm || null, // RNF029 - cifra em repouso
      encryptionKeyId: data.encryptionKeyId || null,
      encryptionIv: data.encryptionIv || null,
      encryptionTag: data.encryptionTag || null,
      accessPolicy: data.accessPolicy || null, // RF007 - restrições de acesso vigentes
      uploaderAnonId: data.uploaderAnonId || null, // ID anonimizado do uploader (LGPD)
      ownerId: data.ownerId || data.uploaderAnonId || null, // V2E-0474 - owner (#1321)
      linkedEntityRefs: Array.isArray(data.linkedEntityRefs) // V2E-0476 - vínculos canônicos (#1321)
        ? data.linkedEntityRefs.map(r => ({ entityType: r.entityType, entityId: r.entityId }))
        : [],
      uploadDate: data.uploadDate || new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Campos HL7 opcionais (extensão para interoperabilidade)
    const hl7Fields = {
      // Identificadores HL7
      accessionNumber: data.accessionNumber || null, // Número de acesso do exame
      orderNumber: data.orderNumber || null, // Número da requisição
      equipmentID: data.equipmentID || null, // ID do equipamento que gerou o arquivo
      
      // Metadados de coleta/processamento
      collectionDateTime: data.collectionDateTime ? (data.collectionDateTime instanceof Date ? data.collectionDateTime : new Date(data.collectionDateTime)) : null,
      processingDateTime: data.processingDateTime ? (data.processingDateTime instanceof Date ? data.processingDateTime : new Date(data.processingDateTime)) : null,
      analysisDateTime: data.analysisDateTime ? (data.analysisDateTime instanceof Date ? data.analysisDateTime : new Date(data.analysisDateTime)) : null,
      
      // Códigos padronizados
      loincCode: data.loincCode || null, // Código LOINC do exame/procedimento
      procedureCode: data.procedureCode || null, // Código do procedimento (SNOMED ou local)
      
      // Informações do equipamento
      equipmentManufacturer: data.equipmentManufacturer || null,
      equipmentModel: data.equipmentModel || null,
      equipmentSerialNumber: data.equipmentSerialNumber || null,
      softwareVersion: data.softwareVersion || null,
      
      // Arquivos de analise e interpretacao
      resultStatus: data.resultStatus || null, // F (Final), P (Preliminar), C (Cancelado)
      unitOfMeasure: data.unitOfMeasure || null, // Unidade de medida padronizada
      resultValue: data.resultValue !== undefined && data.resultValue !== null ? data.resultValue : null, // Valor numérico do resultado
      interpretation: data.interpretation || null, // N (Normal), A (Anormal), H (Alto), L (Baixo), HH (Muito Alto), LL (Muito Baixo)
      
      // Metadados HL7
      hl7Version: data.hl7Version || null, // Ex: "2.8", "FHIR R4"
      messageType: data.messageType || null // Ex: "ORU^R01", "OBR"
    };

    return { ...baseData, ...hl7Fields };
  }

  /**
   * Valida se um tipo de arquivo é permitido
   */
  static isValidFileType(fileType) {
    const allowedTypes = ['RAW', 'ZIP', 'CSV', 'XLS', 'XLSX', 'PDF', 'TXT'];
    return allowedTypes.includes(fileType.toUpperCase());
  }

  /**
   * Determina o tipo de arquivo baseado na extensão
   */
  static getFileTypeFromExtension(fileName) {
    const ext = fileName.split('.').pop()?.toUpperCase() || '';
    const typeMap = {
      'RAW': 'RAW',
      'ZIP': 'ZIP',
      'CSV': 'CSV',
      'XLS': 'XLS',
      'XLSX': 'XLSX',
      'PDF': 'PDF',
      'TXT': 'TXT'
    };
    return typeMap[ext] || null;
  }

  /**
   * dict-02 ELM-0319 (DataFile.fileFormat) -- deriva o formato MIME/EDAM
   * do fileType técnico já validado. Sem correspondência conhecida, cai no
   * tipo binário genérico em vez de retornar null (todo fileType permitido
   * tem um mapeamento definido acima).
   */
  static getFileFormatFromType(fileType) {
    const key = typeof fileType === 'string' ? fileType.toUpperCase() : '';
    return FILE_FORMAT_BY_TYPE[key] || 'application/octet-stream';
  }

  /**
   * Valida extensão de arquivo
   */
  static isValidExtension(fileName) {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const allowedExtensions = ['.raw', '.zip', '.csv', '.xls', '.xlsx', '.pdf', '.txt'];
    return allowedExtensions.some(allowed => ext === allowed.replace('.', ''));
  }
}

SampleFileModel.FILE_ROLES = FILE_ROLES;
SampleFileModel.LINKED_ENTITY_TYPES = LINKED_ENTITY_TYPES;

module.exports = SampleFileModel;

