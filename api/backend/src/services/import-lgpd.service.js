const csv = require('csv-parser');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const PatientModel = require('../models/Patient');
const { SampleModel } = require('../models/Sample');
const patientService = require('./patient.service');
const notificationService = require('./notification.service');
const { generateUniqueParticipantId } = require('../utils/patientAnonymization');
const { getCollection } = require('../utils/collectionResolver');
const {
  SPECIMEN_TYPES,
  SAMPLE_ORIGINS,
  EXTRACTION_PROTOCOLS,
} = require('../config/constants/specimen.constants');
const SampleGraphValidator = require('./SampleGraphValidator');
const DrugService = require('./DrugService');
const participantIdentityService = require('./PatientIdentityService');
const { generateSampleHash } = require('./MerkleService');
const qualityDomain = require('./quality-domain.service');

/**
 * Service de Importação LGPD
 * Implementa importação de pacientes e amostras via CSV/Excel
 * com total conformidade com anonimização LGPD
 */
class ImportLGPDService {
  normalizeCatalogValue(value, catalog) {
    if (value === undefined || value === null) {
      return null;
    }

    const normalized = String(value).trim();
    if (!normalized) {
      return null;
    }

    const directMatch = catalog.find((item) => item.id === normalized);
    if (directMatch) {
      return directMatch.id;
    }

    const labelMatch = catalog.find((item) => String(item.label).trim().toLowerCase() === normalized.toLowerCase());
    return labelMatch ? labelMatch.id : normalized;
  }

  getPatientsSmartImportMetadata() {
    return {
      acceptedExtensions: ['csv', 'xlsx', 'txt'],
      invalidRowPolicy: {
        code: 'SKIP_INVALID_ROWS',
        message: 'Linhas inválidas não são salvas no sistema durante a importação em lote.'
      },
      requiredMapping: true,
      requiredFields: [
        {
          field: 'patientName',
          label: 'Nome do paciente',
          description: 'Nome completo do paciente.'
        },
        {
          field: 'birthDate',
          label: 'Data de nascimento',
          description: 'Formato aceito: DD/MM/AAAA ou AAAA-MM-DD.'
        },
        {
          field: 'sex',
          label: 'Sexo',
          description: 'Valores aceitos: M, F ou O.'
        },
        {
          field: 'email',
          label: 'Email',
          description: 'Email válido para envio de TCLE e notificações.'
        },
        {
          field: 'consentTemplateId',
          label: 'Template de consentimento (TCLE)',
          description: 'Selecione um TCLE existente no próprio sistema para aplicar na importação em lote.'
        }
      ],
      conditionalRules: [
        {
          when: 'isDeceased = true',
          requiredFields: ['representativeName', 'representativeEmail'],
          message: 'Para paciente falecido, nome e email do responsável são obrigatórios.'
        }
      ],
      optionalButValidatedFields: [
        {
          field: 'cpf',
          message: 'Quando informado, deve conter CPF válido.'
        }
      ]
    };
  }

  /**
   * Valida formato do arquivo
   */
  validateFileFormat(file, allowedTypes) {
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeType = file.mimetype;

    const validExtensions = {
      'patients': ['.csv', '.txt', '.xlsx'],
      'samples': ['.csv', '.xlsx']
    };

    const validMimeTypes = {
      'patients': ['text/csv', 'text/plain', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      'samples': ['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
    };

    const extensions = validExtensions[allowedTypes] || [];
    const mimeTypes = validMimeTypes[allowedTypes] || [];

    return extensions.includes(ext) || mimeTypes.includes(mimeType);
  }

  /**
   * Lê arquivo CSV e retorna array de objetos
   */
  async readCSV(filePath) {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(filePath)) {
        return reject(new Error('Arquivo não encontrado'));
      }

      const fileContent = fs.readFileSync(filePath, 'utf8');
      const firstNonEmptyLine = fileContent
        .split(/\r?\n/)
        .find((line) => String(line || '').trim().length > 0) || '';

      const delimiters = [',', ';', '\t', '|'];
      let separator = ',';
      let separatorScore = -1;
      for (const candidate of delimiters) {
        const count = (firstNonEmptyLine.match(new RegExp(`\\${candidate}`, 'g')) || []).length;
        if (count > separatorScore) {
          separatorScore = count;
          separator = candidate;
        }
      }
      
      const rows = [];
      fs.createReadStream(filePath)
        .pipe(csv({
          separator,
          skipEmptyLines: true,
          skipLinesWithError: false
        }))
        .on('data', (row) => {
          // Filtra linhas vazias
          const hasData = Object.values(row).some(val => val && String(val).trim());
          if (hasData) {
            rows.push(row);
          }
        })
        .on('end', () => {
          if (rows.length === 0) {
            return reject(new Error('Arquivo CSV está vazio ou não contém dados válidos'));
          }
          resolve(rows);
        })
        .on('error', (error) => {
          logger.error('Erro ao ler arquivo CSV:', error);
          reject(new Error('Erro ao processar arquivo CSV: ' + (error.message || 'Erro desconhecido')));
        });
    });
  }

  /**
   * Lê arquivo Excel e retorna array de objetos
   * @param {string} filePath - Caminho do arquivo
   * @param {string} dataType - Tipo de dados: 'patients' ou 'samples'
   */
  async readExcel(filePath, dataType = 'patients') {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error('Arquivo não encontrado');
      }

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);

      if (!workbook.worksheets || workbook.worksheets.length === 0) {
        throw new Error('Arquivo Excel não contém planilhas');
      }

      // Busca a aba apropriada baseado no tipo de dados
      let sheetName = null;
      let worksheet = null;

      const sheetNames = workbook.worksheets.map((sheet) => sheet.name);

      if (dataType === 'patients') {
        // Prioridade: 1) Aba "Pacientes", 2) Primeira aba que não seja "Instruções"
        if (sheetNames.includes('Pacientes')) {
          sheetName = 'Pacientes';
          worksheet = workbook.getWorksheet(sheetName);
        } else {
          // Procura primeira aba que não seja "Instruções"
          for (const name of sheetNames) {
            if (name.toLowerCase() !== 'instruções' && name.toLowerCase() !== 'instrucoes') {
              sheetName = name;
              worksheet = workbook.getWorksheet(name);
              break;
            }
          }

          // Se não encontrou, usa a primeira aba
          if (!sheetName) {
            sheetName = sheetNames[0];
            worksheet = workbook.getWorksheet(sheetName);
          }
        }
      } else if (dataType === 'samples') {
        // Prioridade: 1) Aba "Amostras", 2) Primeira aba que não seja "Instruções"
        if (sheetNames.includes('Amostras')) {
          sheetName = 'Amostras';
          worksheet = workbook.getWorksheet(sheetName);
        } else {
          // Procura primeira aba que não seja "Instruções"
          for (const name of sheetNames) {
            if (name.toLowerCase() !== 'instruções' && name.toLowerCase() !== 'instrucoes') {
              sheetName = name;
              worksheet = workbook.getWorksheet(name);
              break;
            }
          }

          // Se não encontrou, usa a primeira aba
          if (!sheetName) {
            sheetName = sheetNames[0];
            worksheet = workbook.getWorksheet(sheetName);
          }
        }
      }

      if (!worksheet) {
        throw new Error(`Planilha "${sheetName}" não encontrada`);
      }

      // Lê todas as linhas primeiro
      const allRows = [];
      worksheet.eachRow({ includeEmpty: true }, (row) => {
        const values = [];
        for (let cellIndex = 1; cellIndex <= row.cellCount; cellIndex += 1) {
          const cell = row.getCell(cellIndex);
          const rawValue = cell.value;
          let value = null;

          if (rawValue !== undefined && rawValue !== null) {
            if (typeof rawValue === 'object' && rawValue.text !== undefined) {
              value = rawValue.text;
            } else if (rawValue instanceof Date) {
              value = rawValue.toISOString();
            } else {
              value = String(rawValue);
            }
          }

          values.push(value);
        }
        allRows.push(values);
      });

      if (!allRows || allRows.length === 0) {
        throw new Error('Planilha está vazia');
      }

      // Encontra a linha de headers baseado no tipo de dados
      let headerRowIndex = -1;
      const searchFields = dataType === 'patients' 
        ? ['patientname', 'patientname'] 
        : ['patientid', 'patientid', 'sampletype', 'sampletype'];

      for (let i = 0; i < allRows.length; i++) {
        const row = allRows[i];
        if (Array.isArray(row)) {
          const rowStr = row.map(cell => String(cell || '').toLowerCase()).join(' ');
          if (searchFields.some(field => rowStr.includes(field))) {
            headerRowIndex = i;
            break;
          }
        }
      }

      if (headerRowIndex === -1) {
        const requiredField = dataType === 'patients' ? 'patientName' : 'participantId ou sampleType';
        throw new Error(`Não foi possível encontrar a linha de cabeçalhos (headers) na planilha. Certifique-se de que a coluna "${requiredField}" está presente.`);
      }

      // Extrai headers e remove caracteres especiais (como (*))
      const headerRow = allRows[headerRowIndex];
      const cleanHeaders = headerRow.map(h => {
        if (!h) return null;
        const headerStr = String(h).trim();
        // Remove asteriscos e parênteses (ex: "patientName (*)" -> "patientName")
        return headerStr.replace(/\s*\([^)]*\)\s*/g, '').trim();
      });

      // Filtra headers nulos
      const validHeaders = cleanHeaders.filter(h => h && h.length > 0);

      // Converte linhas seguintes para objetos usando os headers limpos
      const dataRows = [];
      for (let i = headerRowIndex + 1; i < allRows.length; i++) {
        const row = allRows[i];
        if (!Array.isArray(row)) continue;

        // Verifica se a linha está vazia (todos os valores são null/empty)
        const isEmpty = row.every(cell => !cell || String(cell).trim() === '');
        if (isEmpty) continue;

        // Cria objeto usando headers limpos
        const rowObj = {};
        validHeaders.forEach((header, index) => {
          if (header) {
            const value = row[index];
            // Ignora valores vazios mas mantém null para campos opcionais
            rowObj[header] = (value !== undefined && value !== null && String(value).trim() !== '') ? value : null;
          }
        });

        // Só adiciona se tiver pelo menos um campo preenchido
        if (Object.values(rowObj).some(v => v !== null && v !== '')) {
          dataRows.push(rowObj);
        }
      }

      if (dataRows.length === 0) {
        throw new Error('Nenhum dado válido encontrado na planilha. Certifique-se de que há dados além dos cabeçalhos.');
      }

      return dataRows;
    } catch (error) {
      logger.error('Erro ao ler arquivo Excel:', error);
      throw new Error('Erro ao processar arquivo Excel: ' + (error.message || 'Erro desconhecido'));
    }
  }

  /**
   * Lê arquivo (CSV ou Excel) e retorna array de objetos
   * @param {string} filePath - Caminho do arquivo
   * @param {string} originalName - Nome original do arquivo
   * @param {string} dataType - Tipo de dados: 'patients' ou 'samples'
   */
  async readFile(filePath, originalName, dataType = 'patients') {
    const ext = path.extname(originalName).toLowerCase();
    
    if (ext === '.csv' || ext === '.txt') {
      return await this.readCSV(filePath);
    } else if (ext === '.xlsx') {
      return await this.readExcel(filePath, dataType);
    } else {
      throw new Error('Formato de arquivo não suportado. Use CSV ou Excel (.xlsx)');
    }
  }

  /**
   * Importa pacientes com geração automática de ID (LGPD)
   */
  async importPatients(db, file, options = {}) {
    const groupFields = options?.groupFields || {};
    const results = {
      total: 0,
      success: 0,
      errors: [],
      generatedIDs: [] // Não será exposto na resposta final
    };

    try {
      const rows = await this.readFile(file.path, file.originalname, 'patients');
      const patientsCollection = await getCollection(db, 'patients');

      // Verifica se o arquivo está vazio
      if (!rows || rows.length === 0) {
        throw new Error('Arquivo está vazio ou não contém dados válidos');
      }

      // Campos obrigatórios para pacientes (sem participantId, pois será gerado)
      const requiredFields = ['patientName', 'birthDate', 'sex', 'email'];

      // Pega headers da primeira linha válida
      const firstRow = rows.find(r => r && Object.keys(r).length > 0);
      if (!firstRow) {
        throw new Error('Arquivo não contém dados válidos');
      }

      const headers = Object.keys(firstRow);

      // Normaliza headers (remove espaços, converte para lowercase para comparação)
      const normalizedHeaders = headers.map(h => h.trim().toLowerCase());
      const normalizedRequired = requiredFields.map(f => f.toLowerCase());
      
      // Verifica campos obrigatórios (case-insensitive)
      const missingFields = requiredFields.filter(field => {
        const fieldLower = field.toLowerCase();
        return !normalizedHeaders.includes(fieldLower);
      });
      
      if (missingFields.length > 0) {
        // Tenta encontrar headers similares para ajudar o usuário
        const foundHeaders = headers.filter(h => h && h.trim().length > 0);
        throw new Error(`Campos obrigatórios ausentes: ${missingFields.join(', ')}. Campos encontrados: ${foundHeaders.slice(0, 10).join(', ')}${foundHeaders.length > 10 ? '...' : ''}`);
      }
      
      // Verifica se participantId está presente (não deve estar)
      if (normalizedHeaders.includes('patientid')) {
        logger.warn('Arquivo contém coluna participantId - será ignorada. IDs serão gerados automaticamente.');
      }

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNumber = i + 2; // +2 porque linha 1 é header e arrays começam em 0

        try {
          // Ignora linhas vazias
          if (!row || Object.keys(row).length === 0) {
            continue;
          }
          
          // Verifica se a linha tem dados válidos (pelo menos um campo não vazio)
          const hasData = Object.values(row).some(v => v !== null && v !== undefined && String(v).trim() !== '');
          if (!hasData) {
            continue;
          }
          
          results.total++;

          // Parse dos dados do CSV/Excel
          const patientData = this.parsePatientRow(row);

          if (!patientData.consentTemplateId && groupFields?.consentTemplateId) {
            patientData.consentTemplateId = String(groupFields.consentTemplateId).trim();
          }

          // Remove participantId se fornecido (será gerado automaticamente)
          delete patientData.participantId;
                    if (!patientData.email || !PatientModel.isValidEmail(patientData.email)) {
                      const receivedValue = row.email || 'não informado';
                      results.errors.push({
                        row: rowNumber,
                        errors: [`Linha ${rowNumber}: Email (email) é obrigatório e deve ser válido. Valor recebido: "${receivedValue}"`],
                        data: this.sanitizeRowForError(row)
                      });
                      continue;
                    }

                    if (!patientData.consentTemplateId) {
                      results.errors.push({
                        row: rowNumber,
                        errors: [`Linha ${rowNumber}: Template de consentimento (consentTemplateId) é obrigatório para importação em lote`],
                        data: this.sanitizeRowForError(row)
                      });
                      continue;
                    }

                    const { ObjectId } = require('mongodb');
                    if (!ObjectId.isValid(patientData.consentTemplateId)) {
                      results.errors.push({
                        row: rowNumber,
                        errors: [`Linha ${rowNumber}: consentTemplateId inválido`],
                        data: this.sanitizeRowForError(row)
                      });
                      continue;
                    }

                    const consentTemplatesCollection = await getCollection(db, 'consentTemplates');
                    const consentTemplateExists = await consentTemplatesCollection.findOne({ _id: new ObjectId(patientData.consentTemplateId) });
                    if (!consentTemplateExists) {
                      results.errors.push({
                        row: rowNumber,
                        errors: [`Linha ${rowNumber}: Template de consentimento não encontrado para consentTemplateId informado`],
                        data: this.sanitizeRowForError(row)
                      });
                      continue;
                    }

          
          // Remove campos clínicos legados que parsePatientRow ainda gera mas
          // que ParticipantModel não aceita mais como top-level (decisão de
          // #142: o fluxo de criação de paciente é disease-agnostic; dados
          // clínicos/biomarcadores devem ser vinculados via diagnóstico
          // canônico depois, não aceitos aqui como campos soltos).
          delete patientData.height;
          delete patientData.weight;
          delete patientData.heightCm;
          delete patientData.diagnosticHypothesis;
          delete patientData.icdCode;
          delete patientData.hypertension;
          delete patientData.obesity;
          delete patientData.diabetesType1;
          delete patientData.diabetesType2;
          delete patientData.copd;
          delete patientData.ckd;
          delete patientData.smoking;
          delete patientData.alcoholUse;
          delete patientData.asthma;
          delete patientData.antibioticUse;
          delete patientData.insulinUse;
          delete patientData.antiviralUse;
          delete patientData.geneticVariant;
          delete patientData.notes;

          // Valida dados básicos antes da validação do modelo
          if (!patientData.patientName || (typeof patientData.patientName === 'string' && patientData.patientName.trim().length === 0)) {
            results.errors.push({
              row: rowNumber,
              errors: [`Linha ${rowNumber}: Nome do paciente (patientName) é obrigatório e não pode estar vazio`],
              data: this.sanitizeRowForError(row)
            });
            continue;
          }
          
          if (!patientData.birthDate || !(patientData.birthDate instanceof Date) || isNaN(patientData.birthDate.getTime())) {
            const receivedValue = row.birthDate || 'não informado';
            results.errors.push({
              row: rowNumber,
              errors: [`Linha ${rowNumber}: Data de nascimento (birthDate) é obrigatória e deve ser uma data válida no formato DD/MM/YYYY ou YYYY-MM-DD. Valor recebido: "${receivedValue}"`],
              data: this.sanitizeRowForError(row)
            });
            continue;
          }
          
          if (!patientData.sex || !['M', 'F', 'O'].includes(patientData.sex)) {
            const receivedValue = row.sex || 'não informado';
            results.errors.push({
              row: rowNumber,
              errors: [`Linha ${rowNumber}: Sexo (sex) é obrigatório e deve ser M (Masculino), F (Feminino) ou O (Outro). Valor recebido: "${receivedValue}"`],
              data: this.sanitizeRowForError(row)
            });
            continue;
          }
          
          // Converte recordNumber para número se for string numérica
          // Se for string vazia ou inválida, define como null
          if (patientData.recordNumber !== undefined && patientData.recordNumber !== null) {
            if (typeof patientData.recordNumber === 'string') {
              const trimmed = patientData.recordNumber.trim();
              if (trimmed === '' || trimmed === 'null' || trimmed === 'undefined' || trimmed === 'NaN') {
                patientData.recordNumber = null;
              } else {
                const num = parseInt(trimmed, 10);
                if (!isNaN(num) && isFinite(num)) {
                  patientData.recordNumber = num;
                }
                // Se não for número válido, mantém como string
              }
            }
          } else {
            patientData.recordNumber = null;
          }
          
          // GERA ID ÚNICO DE 8 DÍGITOS AUTOMATICAMENTE (LGPD) - antes da
          // validação, pois PatientModel.validate() exige participantId
          const participantId = await generateUniqueParticipantId(db, 'pacientes');
          patientData.participantId = participantId;

          // Valida dados
          const validation = PatientModel.validate(patientData);
          if (!validation.isValid) {
            // Adiciona número da linha em cada erro para melhor rastreabilidade
            const detailedErrors = validation.errors.map(err => `Linha ${rowNumber}: ${err}`);
            results.errors.push({
              row: rowNumber,
              errors: detailedErrors,
              data: this.sanitizeRowForError(row) // Remove dados sensíveis do erro
            });
            continue;
          }

          const consentMetadata = notificationService.buildConsentMetadata();
          patientData.status = 'PENDING_CONSENT';
          patientData.consentToken = consentMetadata.token;
          patientData.consentTokenCreatedAt = consentMetadata.createdAt;
          patientData.consentTokenExpiresAt = consentMetadata.expiresAt;

          // Valida unidade clínica se fornecida
          if (patientData.clinicalUnit && !PatientModel.validateUnit(patientData.clinicalUnit)) {
            results.errors.push({
              row: rowNumber,
              errors: ['Unidade clínica inválida'],
              data: this.sanitizeRowForError(row)
            });
            continue;
          }

          // Gera sigla se não fornecida
          if (patientData.clinicalUnit && !patientData.unitAcronym) {
            patientData.unitAcronym = PatientModel.fillAcronym(patientData.clinicalUnit);
          }

          // Verifica duplicidade antes de inserir
          const duplicate = await patientService.checkDuplicatePatient(db, patientData);
          if (duplicate) {
            // patientData.birthDate is guaranteed a valid Date here (row 529's guard `continue`s otherwise)
            const birthDateStr = patientData.birthDate.toLocaleDateString('pt-BR');
            results.errors.push({
              row: rowNumber,
              errors: [`Paciente duplicado: já existe um paciente com o nome "${patientData.patientName}" e data de nascimento "${birthDateStr}" cadastrado no sistema`],
              data: this.sanitizeRowForError(row)
            });
            continue;
          }

          // Cria paciente
          const patient = PatientModel.create(patientData);
          
          // Insere no banco
          const insertResult = await patientsCollection.insertOne(patient);

          try {
            const consentLink = notificationService.buildConsentLink(patient, consentMetadata.token);
            await notificationService.enqueueConsentNotification(patientData, consentLink);
            await patientsCollection.updateOne(
              { _id: insertResult.insertedId },
              { $set: { consentNotifiedAt: new Date() } }
            );
          } catch (notifyError) {
            logger.error('Erro ao enfileirar notificações de consentimento (importação LGPD):', notifyError.message);
          }
          
          results.success++;
          // ID gerado não é adicionado ao array (LGPD - não expor)
          
        } catch (error) {
          logger.error(`Erro ao processar linha ${rowNumber}:`, error);
          results.errors.push({
            row: rowNumber,
            errors: [error.message || 'Erro desconhecido ao processar linha'],
            data: this.sanitizeRowForError(row)
          });
        }
      }

      // Log sanitizado (sem dados sensíveis)
      logger.info(`Importação de pacientes concluída: ${results.success}/${results.total} registros importados com sucesso`);

      return {
        total: results.total,
        success: results.success,
        errors: results.errors,
        // NÃO retorna IDs gerados (LGPD)
      };

    } catch (error) {
      logger.error('Erro ao importar pacientes:', error.message);
      throw error;
    }
  }

  /**
   * #462/#463: walks the StorageContainer chain up from a StorageBox's
   * `parent_id` (RACK, optionally through a DRAWER) to SHELF then FREEZER —
   * mirrors `intakeWizard.js`'s helper of the same name (duplicated here
   * rather than imported, matching #464's precedent of mirroring the shape
   * rather than sharing a cross-service module).
   */
  async resolveStorageHierarchyForBox(db, box) {
    const storageContainersCollection = db.collection('storageContainers');

    let rack = box.parent_id ? await storageContainersCollection.findOne({ _id: box.parent_id }) : null;
    if (rack && rack.containerType === 'DRAWER') {
      rack = rack.parent_id ? await storageContainersCollection.findOne({ _id: rack.parent_id }) : null;
    }

    const shelf = rack?.parent_id ? await storageContainersCollection.findOne({ _id: rack.parent_id }) : null;
    const freezer = shelf?.parent_id ? await storageContainersCollection.findOne({ _id: shelf.parent_id }) : null;

    return { rack, shelf, freezer };
  }

  findFirstAvailablePositionInBox(box) {
    const rows = Number(box?.dimension?.rows || 0);
    const cols = Number(box?.dimension?.cols || 0);
    if (rows < 1 || cols < 1) return null;

    const occupancyGrid = box?.occupancyGrid || {};
    for (let row = 0; row < rows; row += 1) {
      for (let col = 1; col <= cols; col += 1) {
        const position = `${String.fromCharCode(65 + row)}${col}`;
        const occupied = typeof occupancyGrid.has === 'function'
          ? occupancyGrid.has(position) && occupancyGrid.get(position)
          : occupancyGrid[position];
        if (!occupied) return position;
      }
    }

    return null;
  }

  isBoxAvailable(box) {
    const status = String(box?.status || '').trim().toUpperCase();
    if (status && ['FULL', 'RETIRED', 'INACTIVE'].includes(status)) return false;
    const capacity = Number(box?.dimension?.rows || 0) * Number(box?.dimension?.cols || 0);
    if (capacity < 1) return false;
    if (Number(box?.currentOccupancy || 0) >= capacity) return false;
    return Boolean(this.findFirstAvailablePositionInBox(box));
  }

  /**
   * #459: replaces the legacy `locations`-collection scan
   * (`getNextAvailableLocation`). Enumerates `storageBoxes` sorted by
   * `name`/`boxID`/`_id` — the same deterministic order
   * `intakeWizard.js`'s `resolveAutomaticLocation` scans in — resolving
   * each candidate's FREEZER/SHELF/RACK/[DRAWER] chain via
   * `resolveStorageHierarchyForBox`. Legacy `getNextAvailableLocation`
   * advanced by `index` full *location* documents (one per box —
   * `wellPosition` was descriptive metadata, not itself a sort key in the
   * legacy sort). The canonical equivalent advances by `index` *available*
   * (non-full, active) boxes in that same order, returning that box's own
   * first free position rather than a legacy `wellPosition` value that no
   * longer exists.
   */
  async getNextAvailableStorageSlot(db, startBoxId, index) {
    try {
      const { ObjectId } = require('mongodb');
      if (!startBoxId || !ObjectId.isValid(String(startBoxId))) {
        return null;
      }

      const boxesCollection = db.collection('storageBoxes');
      const boxes = await boxesCollection.find({}).sort({ name: 1, boxID: 1, _id: 1 }).toArray();

      const startIndex = boxes.findIndex((box) => String(box._id) === String(startBoxId));
      if (startIndex === -1) {
        return null;
      }

      const availableBoxes = boxes
        .slice(startIndex)
        .filter((box) => this.isBoxAvailable(box));

      const target = availableBoxes[index];
      if (!target) {
        return null;
      }

      const { freezer } = await this.resolveStorageHierarchyForBox(db, target);
      if (!freezer) {
        return null;
      }

      return {
        boxId: target._id,
        position: this.findFirstAvailablePositionInBox(target),
      };
    } catch (error) {
      logger.error('Erro ao buscar próxima localização de armazenamento:', error.message);
      return null;
    }
  }

  /**
   * Importa amostras com validação de ID de paciente (LGPD)
   * @param {Object} db - Instância do banco de dados
   * @param {Object} file - Arquivo a ser importado
   * @param {Object} options - Opções de importação { startBoxId, autoIncrement }
   */
  async importSamples(db, file, options = {}) {
    const { startBoxId = null, autoIncrement = false, groupFields = {} } = options;
    const results = {
      total: 0,
      success: 0,
      errors: [],
      importedSampleIds: []
    };

    try {
      const rows = await this.readFile(file.path, file.originalname, 'samples');
      const samplesCollection = await getCollection(db, 'samples');
      const patientsCollection = await getCollection(db, 'patients');
      const validator = new SampleGraphValidator(db);
      const drugService = new DrugService(db);

      // Campos obrigatórios para amostras.
      const requiredFields = ['sampleType', 'sampleOrigin'];

      // Valida headers
      if (rows.length > 0) {
        const headers = Object.keys(rows[0]);
        const missingFields = requiredFields.filter(field => !headers.includes(field));
        const hasPatientIdHeader = headers.includes('participantId') || headers.includes('participantId') || headers.includes('patient_id');
        const hasPatientNameHeader = headers.includes('patientName') || headers.includes('nomePaciente') || headers.includes('nome');
        const hasBirthDateHeader = headers.includes('birthDate') || headers.includes('dataNascimento') || headers.includes('patientBirthDate');
        if (missingFields.length > 0) {
          throw new Error(`Campos obrigatórios ausentes: ${missingFields.join(', ')}`);
        }
        if (!hasPatientIdHeader && !(hasPatientNameHeader && hasBirthDateHeader)) {
          throw new Error('Identificação do paciente ausente: informe participantId ou as colunas patientName + birthDate.');
        }
      }

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNumber = i + 2; // +2 porque linha 1 é header e arrays começam em 0
        let sampleData = null;

        try {
          // Parse dos dados do CSV/Excel
          sampleData = this.parseSampleRow(row);

          if (!sampleData.specimenId) {
            const { generateUniqueSpecimenId } = require('../utils/sampleIDGenerator');
            sampleData.specimenId = await generateUniqueSpecimenId(db, 'samples');
          }

          if (!sampleData.sampleType && groupFields?.sampleType) {
            sampleData.sampleType = String(groupFields.sampleType).trim();
          }
          if (!sampleData.sampleOrigin && groupFields?.sampleOrigin) {
            sampleData.sampleOrigin = String(groupFields.sampleOrigin).trim();
          }
          if (!sampleData.extractionProtocol && groupFields?.extractionProtocol) {
            sampleData.extractionProtocol = String(groupFields.extractionProtocol).trim();
          }

          const matchedPatient = await participantIdentityService.matchOrUpsertParticipant(db, {
            participantId: sampleData.participantId,
            patientName: sampleData.patientName,
            birthDate: sampleData.patientBirthDate,
            identityDocument: sampleData.identityDocument,
          });

          sampleData.participantId = String(matchedPatient?.patient?.participantId || '').trim();
          sampleData.patientObjectId = matchedPatient?.patient?._id || null;
          sampleData.patientName = sampleData.patientName || matchedPatient?.patient?.patientName || null;

          if (!sampleData.participantId) {
            results.errors.push({
              row: rowNumber,
              errors: ['Nao foi possivel resolver a identidade do paciente para a amostra'],
              data: { participantId: null }
            });
            continue;
          }

          // Valida formato do ID (8 dígitos)
          const participantIdStr = String(sampleData.participantId).trim();
          if (participantIdStr.length !== 8 || !/^\d{8}$/.test(participantIdStr)) {
            results.errors.push({
              row: rowNumber,
              errors: [`ID de paciente inválido: deve ter exatamente 8 dígitos numéricos`],
              data: { participantId: participantIdStr }
            });
            continue;
          }

          // Resolve/valida ATC por código ou nome do fármaco.
          const pharmacology = sampleData.pharmacologyData && typeof sampleData.pharmacologyData === 'object'
            ? sampleData.pharmacologyData
            : {};
          const treatmentStatus = String(pharmacology.treatmentStatus || '').trim().toUpperCase();
          const isTreated = treatmentStatus === 'TREATED' || treatmentStatus === 'ON_TREATMENT';
          const currentAtcCode = String(pharmacology.atcCode || '').trim().replace(/^ATC:/i, '').toUpperCase();
          const currentDrugName = String(pharmacology.medicationName || '').trim();

          if (currentAtcCode && !/^[A-Z]\d{2}[A-Z]{0,2}\d{0,2}$/.test(currentAtcCode)) {
            results.errors.push({
              row: rowNumber,
              errors: [`atcCode inválido: ${currentAtcCode}`],
              data: { participantId: participantIdStr }
            });
            continue;
          }

          if (isTreated && !currentAtcCode && currentDrugName) {
            const drugCandidates = await drugService.searchAndCacheDrug(currentDrugName, { limit: 5 });
            const selectedDrug = Array.isArray(drugCandidates) && drugCandidates.length > 0 ? drugCandidates[0] : null;
            if (selectedDrug) {
              sampleData.pharmacologyData = {
                ...pharmacology,
                medicationName: String(selectedDrug.generic_name || selectedDrug.name || currentDrugName).trim(),
                atcCode: String(selectedDrug.atcCode || '').trim().replace(/^ATC:/i, '').toUpperCase(),
                atcClass: String(selectedDrug.drug_class || selectedDrug.atcClass || '').trim(),
                drug_class: String(selectedDrug.drug_class || '').trim(),
              };
            }
          }

          // Valida dados da amostra
          const validation = SampleModel.validate(sampleData);
          if (!validation.isValid) {
            results.errors.push({
              row: rowNumber,
              errors: validation.errors,
              data: { participantId: participantIdStr } // Apenas ID, sem dados sensíveis
            });
            continue;
          }

          // Validações específicas - verifica se os valores existem no banco
          // (SampleModel.validate() above already confirmed sampleType/sampleOrigin/extractionProtocol
          // are valid per SampleModel.validateXxx, so only the findOne lookup can fail here)
          if (sampleData.sampleType) {
            const sampleTypesCollection = db.collection('sampleTypes');
            const validSampleType = await sampleTypesCollection.findOne({ description: sampleData.sampleType });
            if (!validSampleType) {
              results.errors.push({
                row: rowNumber,
                errors: [`Tipo de amostra "${sampleData.sampleType}" não encontrado no banco de dados. Use um valor cadastrado.`],
                data: { participantId: participantIdStr }
              });
              continue;
            }
          }

          if (sampleData.sampleOrigin) {
            const sampleOriginsCollection = db.collection('sampleOrigins');
            const validOrigin = await sampleOriginsCollection.findOne({ description: sampleData.sampleOrigin });
            if (!validOrigin) {
              results.errors.push({
                row: rowNumber,
                errors: [`Origem "${sampleData.sampleOrigin}" não encontrada no banco de dados. Use um valor cadastrado.`],
                data: { participantId: participantIdStr }
              });
              continue;
            }
          }

          if (sampleData.extractionProtocol) {
            const extractionProtocolsCollection = db.collection('extractionProtocols');
            const validProtocol = await extractionProtocolsCollection.findOne({ description: sampleData.extractionProtocol });
            if (!validProtocol) {
              results.errors.push({
                row: rowNumber,
                errors: [`Protocolo de extração "${sampleData.extractionProtocol}" não encontrado no banco de dados. Use um valor cadastrado.`],
                data: { participantId: participantIdStr }
              });
              continue;
            }
          }

          // RF004 - Verifica duplicidade por barcode (se fornecido)
          if (sampleData.barcode) {
            const existingSample = await samplesCollection.findOne({ barcode: sampleData.barcode });
            if (existingSample) {
              results.errors.push({
                row: rowNumber,
                errors: [`Já existe uma amostra com o código de barras ${sampleData.barcode}`],
                data: { participantId: participantIdStr, barcode: sampleData.barcode }
              });
              continue;
            }
          }

          // #459: resolve a canonical storageLocation (boxId/positionCode)
          // for this row — CSV-provided boxId first, then auto-increment
          // from the StorageBox sequence, then a single fixed startBoxId
          // applied to every location-less row — same precedence the legacy
          // `getNextAvailableLocation`/`startLocationID` path used.
          if (sampleData.boxId) {
            const { ObjectId } = require('mongodb');
            const boxesCollection = db.collection('storageBoxes');
            const providedBoxId = ObjectId.isValid(String(sampleData.boxId))
              ? new ObjectId(String(sampleData.boxId))
              : null;
            const providedBox = providedBoxId ? await boxesCollection.findOne({ _id: providedBoxId }) : null;
            if (providedBox) {
              sampleData.storageLocation = {
                boxId: providedBox._id,
                position: sampleData.positionCode || this.findFirstAvailablePositionInBox(providedBox),
              };
            }
          }

          if (!sampleData.storageLocation && autoIncrement && startBoxId) {
            const nextSlot = await this.getNextAvailableStorageSlot(db, startBoxId, results.success);
            if (nextSlot && nextSlot.position) {
              sampleData.storageLocation = { boxId: nextSlot.boxId, position: nextSlot.position };
              logger.debug(`Localização automática atribuída: caixa ${nextSlot.boxId} posição ${nextSlot.position} para linha ${rowNumber}`);
            } else {
              results.errors.push({
                row: rowNumber,
                errors: ['Não há mais localizações de armazenamento disponíveis para incremento automático'],
                data: { participantId: participantIdStr }
              });
              continue;
            }
          } else if (!sampleData.storageLocation && !autoIncrement && startBoxId) {
            const { ObjectId } = require('mongodb');
            const boxesCollection = db.collection('storageBoxes');
            const startBoxObjectId = ObjectId.isValid(String(startBoxId)) ? new ObjectId(String(startBoxId)) : null;
            const startBox = startBoxObjectId ? await boxesCollection.findOne({ _id: startBoxObjectId }) : null;
            const position = startBox ? this.findFirstAvailablePositionInBox(startBox) : null;
            if (startBox && position) {
              sampleData.storageLocation = { boxId: startBox._id, position };
            }
          }

          // Gera código de barras automaticamente se não fornecido
          if (!sampleData.barcode || (typeof sampleData.barcode === 'string' && sampleData.barcode.trim() === '')) {
            const { generateUniqueBarcode } = require('../utils/barcodeGenerator');
            sampleData.barcode = await generateUniqueBarcode(db, 'amostras');
            logger.info(`Código de barras gerado automaticamente para linha ${rowNumber}: ${sampleData.barcode}`);
          } else {
            // Converte para string se necessário
            sampleData.barcode = String(sampleData.barcode).trim();
          }

          // Cria amostra
          const sample = SampleModel.create(sampleData);
          sample.patientName = sampleData.patientName || matchedPatient?.patient?.patientName || null;
          sample.patient_name_confirmed = sample.patientName;
          sample.patientObjectId = sampleData.patientObjectId || null;
          sample.merkleRoot = generateSampleHash(sample);
          
          // Insere no banco
          const insertResult = await samplesCollection.insertOne(sample);
          results.importedSampleIds.push(insertResult.insertedId);

          // #459: dict-02 StorageAssignment (ELM-0167-0178) — open the
          // placement-history record for the specimen's stay at
          // boxId/positionCode, same convention #461/#462 use
          // (equipmentId = the FREEZER StorageContainer's _id).
          if (sample.storageLocation?.boxId) {
            const StorageAssignmentModel = require('../models/StorageAssignment');
            const storageBoxesCollection = db.collection('storageBoxes');
            const assignedBox = await storageBoxesCollection.findOne({ _id: sample.storageLocation.boxId });
            const { rack, shelf, freezer } = assignedBox
              ? await this.resolveStorageHierarchyForBox(db, assignedBox)
              : {};
            if (freezer) {
              const storageAssignmentsCollection = db.collection('storageAssignments');
              await storageAssignmentsCollection.insertOne(StorageAssignmentModel.open({
                specimenId: insertResult.insertedId,
                boxId: sample.storageLocation.boxId,
                positionCode: sample.storageLocation.position,
                equipmentId: freezer._id,
                shelfId: shelf?._id || null,
                rackId: rack?._id || null,
                placedAt: sample.registeredAt
              }));
            }
          }

          const hasMissingEthicsOrSprec = !sampleData.consentTemplateId
            || !sampleData.sprec
            || !sampleData.sprec.sampleType
            || !sampleData.sprec.primaryContainer;

          try {
            await validator.validateSampleCompliance(String(insertResult.insertedId));
          } catch (validationError) {
            logger.warn('[IMPORT_LGPD] Falha no SampleGraphValidator durante importação', {
              specimenId: String(insertResult.insertedId),
              row: rowNumber,
              error: validationError?.message || String(validationError),
            });
          }

          if (hasMissingEthicsOrSprec) {
            await samplesCollection.updateOne(
              { _id: insertResult.insertedId },
              { $set: { releaseStatus: 'QUARANTINE', updatedAt: new Date() } }
            );
          }

          await patientsCollection.updateOne(
            { _id: matchedPatient.patient._id },
            {
              $set: {
                patientName: sample.patientName || matchedPatient.patient.patientName,
                updatedAt: new Date(),
                lastClinicalData: sample.clinicalData || {},
              },
              $addToSet: {
                linkedSampleIds: String(insertResult.insertedId),
              },
            }
          );
          
          results.success++;
          
        } catch (error) {
          results.errors.push({
            row: rowNumber,
            errors: [error.message],
            data: { participantId: sampleData?.participantId || null }
          });
        }

        results.total++;
      }

      // Log sanitizado (sem dados sensíveis)
      logger.info(`Importação de amostras concluída: ${results.success}/${results.total} registros importados com sucesso`);

      return {
        total: results.total,
        success: results.success,
        errors: results.errors,
        importedSampleIds: results.importedSampleIds
      };

    } catch (error) {
      logger.error('Erro ao importar amostras:', error.message);
      throw error;
    }
  }

  /**
   * Parse data de nascimento de vários formatos
   */
  parseBirthDate(dateStr) {
    if (!dateStr) return null;
    
    // Se já for um objeto Date, retorna diretamente
    if (dateStr instanceof Date) {
      if (!isNaN(dateStr.getTime())) {
        return dateStr;
      }
      return null;
    }
    
    const str = String(dateStr).trim();
    if (!str || str === '') return null;
    
    // Tenta formato DD/MM/YYYY
    const ddmmyyyy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(str);
    if (ddmmyyyy) {
      const day = parseInt(ddmmyyyy[1], 10);
      const month = parseInt(ddmmyyyy[2], 10) - 1; // Mês começa em 0
      const year = parseInt(ddmmyyyy[3], 10);
      const date = new Date(year, month, day);
      if (date.getDate() === day && date.getMonth() === month && date.getFullYear() === year) {
        return date;
      }
    }
    
    // Tenta formato YYYY-MM-DD
    const yyyymmdd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
    if (yyyymmdd) {
      const year = parseInt(yyyymmdd[1], 10);
      const month = parseInt(yyyymmdd[2], 10) - 1;
      const day = parseInt(yyyymmdd[3], 10);
      const date = new Date(year, month, day);
      if (date.getDate() === day && date.getMonth() === month && date.getFullYear() === year) {
        return date;
      }
    }
    
    // Tenta formato DD-MM-YYYY
    const ddmmyyyy2 = /^(\d{2})-(\d{2})-(\d{4})$/.exec(str);
    if (ddmmyyyy2) {
      const day = parseInt(ddmmyyyy2[1], 10);
      const month = parseInt(ddmmyyyy2[2], 10) - 1;
      const year = parseInt(ddmmyyyy2[3], 10);
      const date = new Date(year, month, day);
      if (date.getDate() === day && date.getMonth() === month && date.getFullYear() === year) {
        return date;
      }
    }
    
    // Nenhum dos formatos documentados (DD/MM/YYYY, YYYY-MM-DD, DD-MM-YYYY) confere -
    // rejeita em vez de aceitar via parsing nativo ambíguo (issue #37)
    return null;
  }

  /**
   * Parse sexo de vários formatos para M, F ou O
   */
  parseSex(sexStr) {
    if (!sexStr) return null;
    
    const str = String(sexStr).trim().toUpperCase();
    
    // Aceita M, F, O diretamente
    if (['M', 'F', 'O'].includes(str)) {
      return str;
    }
    
    // Converte "Masculino" ou variações para M
    if (str.startsWith('M') || str.includes('MASCULINO') || str === 'MALE') {
      return 'M';
    }
    
    // Converte "Feminino" ou variações para F
    if (str.startsWith('F') || str.includes('FEMININO') || str === 'FEMALE') {
      return 'F';
    }
    
    // Outros casos
    if (str.startsWith('O') || str.includes('OUTRO') || str === 'OTHER') {
      return 'O';
    }
    
    return null;
  }

  /**
   * Parse linha CSV/Excel para Patient
   */
  parsePatientRow(row) {
    // Parse birthDate com suporte a múltiplos formatos
    const birthDate = this.parseBirthDate(row.birthDate);
    
    // Parse sex com suporte a múltiplos formatos
    const sex = this.parseSex(row.sex);
    
    // Parse recordNumber - aceita string ou número
    let recordNumber = null;
    if (row.recordNumber !== undefined && row.recordNumber !== null && row.recordNumber !== '') {
      const recordStr = String(row.recordNumber).trim();
      if (recordStr && recordStr !== 'null' && recordStr !== 'undefined' && recordStr !== 'NaN') {
        // Tenta como número primeiro
        const num = parseInt(recordStr, 10);
        if (!isNaN(num) && isFinite(num)) {
          recordNumber = num;
        } else {
          // Se não for número válido, mantém como string (se não estiver vazio)
          if (recordStr.length > 0) {
            recordNumber = recordStr;
          }
        }
      }
    }
    
    // Parse heightCm - também aceita height (em metros, converte para cm)
    let heightCm = null;
    if (row.heightCm) {
      const height = parseFloat(row.heightCm);
      if (!isNaN(height)) {
        // Se o valor for menor que 3, assume que está em metros e converte para cm
        heightCm = height < 3 ? height * 100 : height;
      }
    } else if (row.height) {
      // Aceita também "height" como alternativa (em metros, converte para cm)
      const height = parseFloat(row.height);
      if (!isNaN(height)) {
        // Se o valor for menor que 3, assume que está em metros e converte para cm
        heightCm = height < 3 ? height * 100 : height;
      }
    }
    
    return {
      participantId: row.participantId?.trim() || null,
      patientName: row.patientName?.trim() || null,
      email: row.email ? String(row.email).trim().toLowerCase() : null,
      phone: row.phone ? String(row.phone).trim() : null,
      birthDate: birthDate,
      sex: sex,
      weight: this.parseFloatField(row.weight),
      heightCm: heightCm,
      recordNumber: recordNumber,
      clinicalUnit: row.clinicalUnit?.trim() || null,
      unitAcronym: row.unitAcronym?.trim() || null,
      diagnosticHypothesis: row.diagnosticHypothesis?.trim() || null,
      icdCode: row.icdCode?.trim() || null,
      hypertension: this.parseBoolean(row.hypertension),
      obesity: this.parseBoolean(row.obesity),
      diabetesType1: this.parseBoolean(row.diabetesType1),
      diabetesType2: this.parseBoolean(row.diabetesType2),
      copd: this.parseBoolean(row.copd),
      ckd: this.parseBoolean(row.ckd),
      smoking: this.parseBoolean(row.smoking),
      alcoholUse: this.parseBoolean(row.alcoholUse),
      asthma: this.parseBoolean(row.asthma),
      antibioticUse: this.parseBoolean(row.antibioticUse),
        insulinUse: this.parseBoolean(row.insulinUse),
        antiviralUse: this.parseBoolean(row.antiviralUse),
        geneticVariant: row.geneticVariant?.trim() || null,
        notes: row.notes?.trim() || null,
        consentTemplateId: row.consentTemplateId ? String(row.consentTemplateId).trim() : null
      };
  }

  /**
   * Parse linha CSV/Excel para Sample (RF004)
   */
  parseSampleRow(row) {
    const { parseQualityMIABIS } = require('../utils/qualityMIABISValidator');
    // Parse de data de registro
    let registeredAt = null;
    if (row.registeredAt) {
      registeredAt = this.parseBirthDate(row.registeredAt);
    } else if (row.registeredAt) {
      registeredAt = this.parseBirthDate(row.registeredAt);
    }
    if (!registeredAt) {
      registeredAt = new Date(); // Padrão: hoje
    }

    const tcleId = row.consentTemplateId || null;
    const sprec = {
      matrixType: row.sprec_matrix_type || row.sprecMatrixType || null,
      sampleType: row.sprec_sample_type || row.sprecSampleType || row.sprecSampleTypeCode || null,
      primaryContainer: row.sprec_primary_container || row.sprecPrimaryContainer || null,
      preCentrifugation: row.sprec_pre_centrifugation || row.sprecPreCentrifugation || null,
      centrifugation: row.sprec_centrifugation || row.sprecCentrifugation || null,
      secondCentrifugation: row.sprec_second_centrifugation || row.sprecSecondCentrifugation || null,
      postCentrifugationDelay: row.sprec_post_centrifugation_delay || row.sprecPostCentrifugationDelay || null,
      longTermStorage: row.sprec_long_term_storage || row.sprecLongTermStorage || null,
    };

    const clinicalData = {
      orphaCode: row.orphaCode || row.orpha || row.orpha_code || null,
      omimCode: row.omimCode || row.omim || row.omim_code || null,
      cid: row.cid || row.cidCode || row.diagnosisCidCode || null,
      phenotypes: [],
      charlsonComorbidities: [],
      biomarkerValues: {},
    };

    const treatmentStatus = String(row.treatmentStatus || '').trim().toUpperCase();
    const atcCode = String(row.atcCode || '').trim().replace(/^ATC:/i, '').toUpperCase();
    const medicationName = String(row.medicationName || '').trim();
    const atcLevel1 = String(row.atcClass || '').trim().toUpperCase() || (atcCode ? atcCode.charAt(0) : '');

    const pharmacologyData = {
      treatmentStatus: ['NAIVE', 'TREATED', 'ON_TREATMENT', 'WASHOUT'].includes(treatmentStatus) ? treatmentStatus : '',
      medicationName: medicationName || null,
      atcCode: atcCode || null,
      atcClass: atcLevel1 || null,
      medicationName: medicationName || null,
      atcCode: atcCode || null,
      atcClass: atcLevel1 || null,
      lastDoseDate: row.lastDoseDate || null,
      washoutStartDate: row.washoutStartDate || null,
      washoutEndDate: row.washoutEndDate || null,
    };
    const externalQualityAssessment = {
      score: row.rcsScore !== undefined && row.rcsScore !== null && row.rcsScore !== '' ? parseFloat(row.rcsScore) : null,
      category: row.scoreBasedGrade ? String(row.scoreBasedGrade).trim().toUpperCase() : '',
      source: 'external-lgpd-import',
      canonical: false,
    };
    const canonicalQualityAssessment = qualityDomain.resolveMethodologicalQuality({ sprec });
    const releaseStatus = canonicalQualityAssessment?.governance_status === 1
      && ['A', 'B', 'C', 'D'].includes(String(canonicalQualityAssessment?.final_grade || '').toUpperCase())
      ? 'AVAILABLE'
      : 'QUARANTINE';

    return {
      participantId: row.participantId?.trim() || null, // Aceita participantId, participantId ou patient_id
      patientName: row.patientName?.trim() || row.nomePaciente?.trim() || row.nome?.trim() || null,
      patientBirthDate: this.parseBirthDate(row.birthDate || row.dataNascimento || row.patientBirthDate),
      patientEmail: row.email ? String(row.email).trim().toLowerCase() : null,
      patientSex: this.parseSex(row.sex || row.gender || row.sexo),
      identityDocument: row.identityDocument ? String(row.identityDocument).trim() : null,
      patientIsDeceased: this.parseBoolean(row.isDeceased),
      representativeName: row.representativeName?.trim() || row.responsavelNome?.trim() || null,
      representativeEmail: row.representativeEmail ? String(row.representativeEmail).trim().toLowerCase() : null,
      representativeIdentityDocument: row.representativeIdentityDocument ? String(row.representativeIdentityDocument).trim() : null,
      sampleType: row.sampleType?.trim() || null,
      sampleOrigin: this.normalizeCatalogValue(row.sampleOrigin, SAMPLE_ORIGINS),
      extractionProtocol: this.normalizeCatalogValue(row.extractionProtocol, EXTRACTION_PROTOCOLS),
      barcode: row.barcode ? String(row.barcode).trim() : null, // RF004 - barcode como string
      registeredAt: registeredAt,
      registeredAt: registeredAt,
      quantity: row.quantity ? parseFloat(row.quantity) : null,
      quality: parseQualityMIABIS(row.quality), // Valida e converte para id MIABIS canônico
      model_version: canonicalQualityAssessment.model_version,
      matrix_type: canonicalQualityAssessment.matrix_type,
      governance_status: canonicalQualityAssessment.governance_status,
      governance_failure_reasons: canonicalQualityAssessment.governance_failure_reasons || [],
      governance_rule_codes: canonicalQualityAssessment.governance_rule_codes || [],
      p_bio: canonicalQualityAssessment.p_bio,
      rcs_score: canonicalQualityAssessment.rcs_score,
      score_based_grade: canonicalQualityAssessment.score_based_grade,
      final_grade: canonicalQualityAssessment.final_grade || '',
      grade_route: canonicalQualityAssessment.grade_route,
      axis_penalties: canonicalQualityAssessment.axis_penalties || [],
      calculation_trace: canonicalQualityAssessment.calculation_trace || {},
      rcs_evaluation: canonicalQualityAssessment,
      canonical: {
        rcsScore: externalQualityAssessment.score,
        scoreBasedGrade: externalQualityAssessment.category || '',
        axisPenalties: [],
      },
      externalQualityAssessment: externalQualityAssessment,
      releaseStatus: releaseStatus,
      // #459: CSV rows carry the canonical boxId/positionCode pair directly —
      // no compatibility field for the legacy numeric locationID, matching
      // #462's createSample input-contract change (`no legacy field aliases
      // in runtime persistence`, canonical-data-cleanup.md rule 2).
      boxId: row.boxId || row.boxID || null,
      positionCode: row.positionCode || row.position || row.wellPosition || null,
      linkedProject: row.linkedProject?.trim() || null,
      specimenStatus: SampleModel.mapLegacyLifecycleStatusToSpecimenStatus(row.specimenStatus?.trim() || row.lifecycleStatus?.trim()),
      consentTemplateId: tcleId ? String(tcleId).trim() : null,
      merkleRoot: row.merkleRoot ? String(row.merkleRoot).trim() : null,
      sprec,
      clinicalData: clinicalData,
      pharmacologyData: pharmacologyData,
    };
  }

  normalizeText(value, { uppercase = false } = {}) {
    if (value === undefined || value === null) return null;
    const normalized = String(value).trim();
    if (!normalized) return null;
    return uppercase ? normalized.toUpperCase() : normalized;
  }

  normalizeCpf(value) {
    if (value === undefined || value === null) return null;
    const digits = String(value).replace(/\D/g, '').trim();
    return digits || null;
  }

  isValidCpf(value) {
    const cpf = this.normalizeCpf(value);
    if (!cpf || cpf.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(cpf)) return false;

    const calcDigit = (base, factor) => {
      let total = 0;
      for (let i = 0; i < base.length; i += 1) {
        total += parseInt(base[i], 10) * (factor - i);
      }
      const remainder = total % 11;
      return remainder < 2 ? 0 : 11 - remainder;
    };

    const d1 = calcDigit(cpf.slice(0, 9), 10);
    const d2 = calcDigit(cpf.slice(0, 9) + d1, 11);
    return cpf === `${cpf.slice(0, 9)}${d1}${d2}`;
  }

  isFutureDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
    const today = new Date();
    const normalizedToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const normalizedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return normalizedDate.getTime() > normalizedToday.getTime();
  }

  buildMappedPatientRow(rawRow, mapping = {}) {
    const mapped = {};
    Object.keys(mapping || {}).forEach((sourceColumn) => {
      const targetField = mapping[sourceColumn];
      if (!targetField) return;
      mapped[targetField] = rawRow[sourceColumn];
    });

    const knownPatientFields = new Set([
      'patientName',
      'participantId',
      'email',
      'cpf',
      'birthDate',
      'sex',
      'phone',
      'recordNumber',
      'clinicalUnit',
      'unitAcronym',
      'diagnosticHypothesis',
      'icdCode',
      'weight',
      'heightCm',
      'height',
      'hypertension',
      'obesity',
      'diabetesType1',
      'diabetesType2',
      'copd',
      'ckd',
      'smoking',
      'alcoholUse',
      'asthma',
      'antibioticUse',
        'insulinUse',
        'antiviralUse',
        'geneticVariant',
        'notes',
        'isDeceased',
        'representativeName',
      'representativeEmail',
      'representativeCpf',
      'consentTemplateId'
    ]);

    const canonicalHeaderMap = {
      patientname: 'patientName',
      nomepaciente: 'patientName',
      name: 'patientName',
      patientid: 'participantId',
      patient_id: 'participantId',
      email: 'email',
      cpf: 'cpf',
      birthdate: 'birthDate',
      datanascimento: 'birthDate',
      sex: 'sex',
      sexo: 'sex',
      phone: 'phone',
      telefone: 'phone',
      celular: 'phone',
      recordnumber: 'recordNumber',
      prontuario: 'recordNumber',
      clinicalunit: 'clinicalUnit',
      unidadeclinica: 'clinicalUnit',
      unitacronym: 'unitAcronym',
      siglaunidade: 'unitAcronym',
      diagnostichypothesis: 'diagnosticHypothesis',
      icdcode: 'icdCode',
      weight: 'weight',
      heightcm: 'heightCm',
      height: 'height',
      hypertension: 'hypertension',
      obesity: 'obesity',
      diabetestype1: 'diabetesType1',
      diabetestype2: 'diabetesType2',
      copd: 'copd',
      ckd: 'ckd',
      smoking: 'smoking',
      alcoholuse: 'alcoholUse',
      asthma: 'asthma',
      antibioticuse: 'antibioticUse',
        insulinuse: 'insulinUse',
        antiviraluse: 'antiviralUse',
        geneticvariant: 'geneticVariant',
        notes: 'notes',
        isdeceased: 'isDeceased',
        falecido: 'isDeceased',
      representativename: 'representativeName',
      responsavelnome: 'representativeName',
      representativeemail: 'representativeEmail',
      responsavelemail: 'representativeEmail',
      representativecpf: 'representativeCpf',
      responsavelcpf: 'representativeCpf',
      consenttemplateid: 'consentTemplateId'
    };

    const hasValue = (value) => value !== undefined && value !== null && String(value).trim() !== '';

    Object.keys(rawRow || {}).forEach((sourceColumn) => {
      const rawValue = rawRow[sourceColumn];
      if (!hasValue(rawValue)) return;

      const trimmedSource = String(sourceColumn || '').trim();
      if (!trimmedSource) return;

      if (knownPatientFields.has(trimmedSource) && !hasValue(mapped[trimmedSource])) {
        mapped[trimmedSource] = rawValue;
      }

      const normalizedSource = trimmedSource
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');

      const canonicalTarget = canonicalHeaderMap[normalizedSource];
      if (canonicalTarget && !hasValue(mapped[canonicalTarget])) {
        mapped[canonicalTarget] = rawValue;
      }
    });

    if (mapped.responsavelNome && !mapped.representativeName) {
      mapped.representativeName = mapped.responsavelNome;
    }
    if (mapped.responsavelEmail && !mapped.representativeEmail) {
      mapped.representativeEmail = mapped.responsavelEmail;
    }

    return mapped;
  }

  async importPatientsSmart(db, file, options = {}) {
    const groupFields = options?.groupFields || {};
    const mapping = options?.mapping || {};

    if (!mapping || Object.keys(mapping).length === 0) {
      throw new Error('Mapeamento inteligente é obrigatório para importação em lote');
    }

    const results = {
      total: 0,
      success: 0,
      errors: []
    };

    const rows = await this.readFile(file.path, file.originalname, 'patients');
    const patientsCollection = await getCollection(db, 'patients');
    const { ObjectId } = require('mongodb');

    for (let i = 0; i < rows.length; i += 1) {
      const rawRow = rows[i];
      const rowNumber = i + 2;
      results.total += 1;

      try {
        const mappedRow = this.buildMappedPatientRow(rawRow, mapping);
        const patientData = this.parsePatientRow(mappedRow);

        patientData.patientName = this.normalizeText(patientData.patientName, { uppercase: true });
        patientData.clinicalUnit = this.normalizeText(patientData.clinicalUnit, { uppercase: true });
        if (patientData.clinicalUnit) {
          patientData.unitAcronym = PatientModel.fillAcronym(patientData.clinicalUnit);
        }

        patientData.cpf = this.normalizeCpf(mappedRow.cpf ?? mappedRow.documento ?? mappedRow.CPF);
        patientData.isDeceased = this.parseBoolean(mappedRow.isDeceased);
        patientData.representativeName = this.normalizeText(mappedRow.representativeName);
        patientData.representativeEmail = this.normalizeText(mappedRow.representativeEmail);

        if (!patientData.consentTemplateId && groupFields?.consentTemplateId) {
          patientData.consentTemplateId = String(groupFields.consentTemplateId).trim();
        }

        if (!patientData.patientName) {
          results.errors.push({ row: rowNumber, errors: [`Linha ${rowNumber}: Nome do paciente é obrigatório`] });
          continue;
        }

        if (!patientData.email || !PatientModel.isValidEmail(patientData.email)) {
          results.errors.push({ row: rowNumber, errors: [`Linha ${rowNumber}: Email inválido`] });
          continue;
        }

        if (patientData.cpf && !this.isValidCpf(patientData.cpf)) {
          results.errors.push({ row: rowNumber, errors: [`Linha ${rowNumber}: CPF inválido`] });
          continue;
        }

        if (!patientData.birthDate || !(patientData.birthDate instanceof Date) || Number.isNaN(patientData.birthDate.getTime())) {
          results.errors.push({ row: rowNumber, errors: [`Linha ${rowNumber}: Data de nascimento inválida`] });
          continue;
        }

        if (this.isFutureDate(patientData.birthDate)) {
          results.errors.push({ row: rowNumber, errors: [`Linha ${rowNumber}: Data de nascimento futura não é permitida`] });
          continue;
        }

        if (!patientData.consentTemplateId || !ObjectId.isValid(patientData.consentTemplateId)) {
          results.errors.push({ row: rowNumber, errors: [`Linha ${rowNumber}: consentTemplateId inválido ou ausente`] });
          continue;
        }

        const consentTemplatesCollection = await getCollection(db, 'consentTemplates');
        const consentTemplateExists = await consentTemplatesCollection.findOne({ _id: new ObjectId(patientData.consentTemplateId) });
        if (!consentTemplateExists) {
          results.errors.push({ row: rowNumber, errors: [`Linha ${rowNumber}: Template de consentimento não encontrado`] });
          continue;
        }

        if (patientData.isDeceased) {
          if (!patientData.representativeName || !patientData.representativeEmail) {
            results.errors.push({ row: rowNumber, errors: [`Linha ${rowNumber}: Para paciente falecido, responsável (nome e email) é obrigatório`] });
            continue;
          }
          if (!PatientModel.isValidEmail(patientData.representativeEmail)) {
            results.errors.push({ row: rowNumber, errors: [`Linha ${rowNumber}: Email do responsável inválido`] });
            continue;
          }
        }

        const duplicate = await patientService.checkDuplicatePatient(db, patientData);
        if (duplicate) {
          results.errors.push({ row: rowNumber, errors: [`Linha ${rowNumber}: Paciente duplicado detectado`] });
          continue;
        }

        // GERA ID ÚNICO ANTES DA VALIDAÇÃO (PatientModel.validate() exige
        // participantId) e remove campos clínicos legados/CPF que
        // parsePatientRow/esta função ainda geram mas que ParticipantModel
        // não aceita mais como top-level (decisão de #142: fluxo de
        // criação de paciente é disease-agnostic).
        const participantId = await generateUniqueParticipantId(db, 'pacientes');
        patientData.participantId = participantId;
        delete patientData.cpf;
        delete patientData.height;
        delete patientData.weight;
        delete patientData.heightCm;
        delete patientData.diagnosticHypothesis;
        delete patientData.icdCode;
        delete patientData.hypertension;
        delete patientData.obesity;
        delete patientData.diabetesType1;
        delete patientData.diabetesType2;
        delete patientData.copd;
        delete patientData.ckd;
        delete patientData.smoking;
        delete patientData.alcoholUse;
        delete patientData.asthma;
        delete patientData.antibioticUse;
        delete patientData.insulinUse;
        delete patientData.antiviralUse;
        delete patientData.geneticVariant;
        delete patientData.notes;

        const validation = PatientModel.validate(patientData);
        if (!validation.isValid) {
          results.errors.push({ row: rowNumber, errors: validation.errors.map((error) => `Linha ${rowNumber}: ${error}`) });
          continue;
        }

        const consentMetadata = notificationService.buildConsentMetadata();
        patientData.status = 'PENDING_CONSENT';
        patientData.consentToken = consentMetadata.token;
        patientData.consentTokenCreatedAt = consentMetadata.createdAt;
        patientData.consentTokenExpiresAt = consentMetadata.expiresAt;

        const patient = PatientModel.create(patientData);
        const insertResult = await patientsCollection.insertOne(patient);

        try {
          const consentLink = notificationService.buildConsentLink(patient, consentMetadata.token);
          await notificationService.enqueueConsentNotification(patientData, consentLink);
          await patientsCollection.updateOne(
            { _id: insertResult.insertedId },
            { $set: { consentNotifiedAt: new Date() } }
          );
        } catch (notifyError) {
          logger.error('Erro ao enfileirar notificações de consentimento (smart import):', notifyError.message);
        }

        results.success += 1;
      } catch (error) {
        logger.error(`Erro ao processar linha ${rowNumber} (smart import):`, error);
        results.errors.push({ row: rowNumber, errors: [error.message || 'Erro desconhecido ao processar linha'] });
      }
    }

    logger.info(`Smart import de pacientes concluído: ${results.success}/${results.total}`);
    return results;
  }

  /**
   * Parse boolean de string
   */
  parseBoolean(value) {
    if (value === undefined || value === null || value === '') return false;
    const str = String(value).toLowerCase().trim();
    return str === 'true' || str === '1' || str === 'sim' || str === 'yes' || str === 's';
  }

  /**
   * Parse campo numérico (float) de string
   * Retorna null se o valor for inválido, vazio ou não numérico
   */
  parseFloatField(value) {
    if (value === undefined || value === null || value === '') return null;
    const str = String(value).trim();
    if (str === '' || str === 'null' || str === 'undefined' || str === 'NaN' || str === 'N/A' || str === '-') {
      return null;
    }
    const num = parseFloat(str);
    if (isNaN(num) || !isFinite(num)) {
      return null;
    }
    return num;
  }

  /**
   * Sanitiza linha para erro (remove dados sensíveis)
   */
  sanitizeRowForError(row) {
    // Retorna apenas campos não sensíveis para debug
    return {
      // Não retorna patientName, birthDate, etc.
      // Apenas campos técnicos se necessário
    };
  }

  /**
   * Limpa arquivo temporário
   */
  cleanupFile(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      logger.error('Erro ao limpar arquivo temporário:', error.message);
    }
  }
}

module.exports = new ImportLGPDService();

