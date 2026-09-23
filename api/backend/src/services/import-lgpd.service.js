const csv = require('csv-parser');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const PatientModel = require('../models/Patient');
const ParticipantIdentityModel = require('../models/ParticipantIdentity');
// Named distinctly from participantIdentityService below (that name is
// already taken in this file by ./PatientIdentityService.js, the
// import-time name+DOB matching service — a different entity concern).
const participantIdentityEncryptionService = require('./participantIdentity.service');
const { SampleModel } = require('../models/Sample');
const patientService = require('./patient.service');
const notificationService = require('./notification.service');
const { generateUniqueParticipantId } = require('../utils/patientAnonymization');
const { getCollection } = require('../utils/collectionResolver');
const { omitLegacyIdentityFields } = require('../utils/legacyPatientIdentityFields');
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
const rcsAssessmentService = require('./rcs-assessment.service');
const specimenPreanalyticsService = require('./specimen-preanalytics.service');
const AllocateSampleUseCase = require('../core/use-cases/AllocateSampleUseCase');
const MongoStorageRepository = require('../infrastructure/persistence/mongo/MongoStorageRepository');
const MongoAuditRepository = require('../infrastructure/persistence/mongo/MongoAuditRepository');
const LineageRepository = require('../infrastructure/database/neo4j/LineageRepository');

const { CRITICAL_SENSOR_STATUSES, isEquipmentBlocked } = require('../models/equipmentStatus');

/**
 * Os dois tipos de lote de quarentena que a importacao LGPD escreve em
 * `import_batches` (#787 para amostras, #814 para participantes).
 *
 * A colecao e compartilhada com a importacao FHIR (`FHIR_BUNDLE`) e com o
 * motor assincrono (`ASYNC_BATCH_IMPORT`), que tem outras permissoes -- por
 * isso os leitores filtram por tipo em vez de so por `_id` (#799 foi
 * exatamente esse vazamento no sentido oposto).
 */
const QUARANTINE_BATCH_TYPES = Object.freeze({
  SAMPLE: 'LGPD_SAMPLE_CSV',
  PATIENT: 'LGPD_PATIENT_CSV',
});

const READABLE_QUARANTINE_TYPES = Object.freeze(Object.values(QUARANTINE_BATCH_TYPES));

/**
 * #915: normaliza o conjunto de tipos que um leitor de quarentena pode ver.
 *
 * Descarta o que nao for um tipo LGPD conhecido -- um `type` vindo de query
 * string nunca deve alargar o filtro para `FHIR_BUNDLE`/`ASYNC_BATCH_IMPORT`
 * -- e cai no padrao so-amostras quando sobra vazio, para que um conjunto
 * vazio nunca vire um `$in: []` (que nao casa nada) nem um filtro ausente
 * (que casaria tudo).
 */
function normalizeQuarantineTypes(types) {
  const requested = Array.isArray(types) ? types : [types];
  const allowed = READABLE_QUARANTINE_TYPES.filter((t) => requested.includes(t));
  return allowed.length > 0 ? allowed : [QUARANTINE_BATCH_TYPES.SAMPLE];
}

function buildIdVariants(...ids) {
  const variants = [];
  const seen = new Set();
  const add = (value) => {
    if (value === undefined || value === null || value === '') return;
    const key = `${typeof value}:${String(value)}`;
    if (!seen.has(key)) {
      seen.add(key);
      variants.push(value);
    }
  };

  for (const id of ids) {
    if (id === undefined || id === null || id === '') continue;
    add(id);
    add(String(id));

    const numeric = Number(id);
    if (Number.isFinite(numeric)) {
      add(numeric);
    }
  }

  return variants;
}

function isOperationalSensor(sensor) {
  const status = String(sensor?.status || sensor?.maintenanceStatus || sensor?.operationalStatus || '').trim().toLowerCase();
  return !status || !CRITICAL_SENSOR_STATUSES.includes(status);
}

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

      const fileBuffer = fs.readFileSync(filePath);
      const fileContent = fileBuffer.toString('utf8');
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
      // #1012: `skipEmptyLines`/`skipLinesWithError` abaixo NAO sao opcoes do
      // csv-parser 3.2.0 -- o `defaults` do pacote instalado
      // (node_modules/csv-parser/index.js) so reconhece escape, headers,
      // mapHeaders, mapValues, newline, quote, raw, separator, skipComments,
      // skipLines, maxRowBytes, strict, outputByteOffset; o construtor faz
      // `Object.assign({}, defaults, opts)`, entao as duas chaves abaixo sao
      // absorvidas e ficam inertes. Elas continuam no objeto de opcoes como
      // declaracao de intencao, nao como filtro que funciona hoje -- se um
      // upgrade futuro do csv-parser passar a reconhecer alguma delas, o
      // comportamento muda silenciosamente, entao removê-las agora seria
      // comportamento-neutro mas perderia esse aviso.
      //
      // Uma linha fisica em branco chega normalmente ao parser: `parseLine`
      // produz uma lista de celulas vazia, `writeRow` emite `{}`, e esse `{}`
      // e o que o handler 'data' abaixo recebe -- e' o proprio check
      // `hasData` do handler que rejeita e conta essa linha, nao o parser.
      // Ou seja: a contagem abaixo sempre esteve correta; o que estava errado
      // era este comentario atribuir o descarte a `skipEmptyLines`.
      let skippedByHasData = 0;
      // #1035: a linha FISICA no arquivo que o operador enviou, derivada do
      // `byteOffset` que o csv-parser 3.2.0 reporta por registro quando
      // `outputByteOffset: true` (ver node_modules/csv-parser/index.js --
      // `writeRow` empacota `{ row, byteOffset }` nesse modo, e o offset
      // aponta para o primeiro byte do registro). `newlineByteOffsets` e' a
      // posicao de cada 0x0A no arquivo, calculada uma unica vez sobre
      // `fileBuffer` (O(n)); a linha fisica de um registro e' quantas dessas
      // posicoes ficam estritamente antes do seu `byteOffset`, mais 1 --
      // resolvido por busca binaria por registro (O(log n)), nao por
      // varredura.
      //
      // Byte, nao caractere: `fileBuffer` e' lido como Buffer (nao
      // `.toString('utf8')`) exatamente para isto -- o texto e' portugues
      // acentuado, e um indice de string diverge de um indice de byte a
      // partir do primeiro caractere multibyte.
      //
      // Substitui o contador antigo (`physicalLine += 1` por evento 'data'),
      // que era exato so' enquanto o csv-parser emitia um evento por linha
      // fisica -- falso para um registro com quebra de linha dentro de um
      // campo entre aspas, que ocupa varias linhas fisicas mas produz um
      // unico evento. A partir desse registro o contador antigo desliza para
      // todo registro seguinte; a busca por byteOffset nao depende de quantas
      // linhas fisicas um registro ocupou.
      const newlineByteOffsets = [];
      for (let i = 0; i < fileBuffer.length; i += 1) {
        if (fileBuffer[i] === 0x0a) newlineByteOffsets.push(i);
      }
      const physicalLineForByteOffset = (byteOffset) => {
        let lo = 0;
        let hi = newlineByteOffsets.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (newlineByteOffsets[mid] < byteOffset) lo = mid + 1;
          else hi = mid;
        }
        return lo + 1;
      };
      const sourceLines = [];
      fs.createReadStream(filePath)
        .pipe(csv({
          separator,
          skipEmptyLines: true,
          skipLinesWithError: false,
          outputByteOffset: true
        }))
        .on('data', ({ row, byteOffset }) => {
          const physicalLine = physicalLineForByteOffset(byteOffset);
          // Filtra linhas vazias
          const hasData = Object.values(row).some(val => val && String(val).trim());
          if (hasData) {
            rows.push(row);
            sourceLines.push(physicalLine);
          } else {
            skippedByHasData += 1;
          }
        })
        .on('end', () => {
          if (rows.length === 0) {
            return reject(new Error('Arquivo CSV está vazio ou não contém dados válidos'));
          }
          // #1001: non-enumerable so the array's own `toEqual` shape (used by
          // the existing readers tests) is unaffected -- readFile/the
          // importers read it explicitly via `rows.skippedCount`.
          Object.defineProperty(rows, 'skippedCount', {
            value: skippedByHasData,
            enumerable: false,
          });
          // #1023: index-aligned com `rows`. Nao-enumeravel pela mesma razao
          // que `skippedCount` (#1001): os testes dos readers comparam o array
          // com `toEqual`.
          Object.defineProperty(rows, 'sourceLines', {
            value: sourceLines,
            enumerable: false,
          });
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
      // #1023: o numero da linha na planilha ja' vinha e estava sendo
      // descartado -- ExcelJS passa o rowNumber como SEGUNDO argumento do
      // callback. E' o numero que o operador ve' aberto no Excel.
      const allRowNumbers = [];
      worksheet.eachRow({ includeEmpty: true }, (row, sheetRowNumber) => {
        allRowNumbers.push(sheetRowNumber);
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
      // #1023: index-aligned com `dataRows` -- a linha da planilha de cada
      // linha efetivamente mantida. Mesma finalidade que o sourceLines do
      // readCSV.
      const sourceLines = [];
      // #1001: counts rows dropped by either filter below, without
      // double-counting a row rejected by the first (the `continue` means a
      // row can only ever hit one of the two `skippedRows += 1` sites).
      let skippedRows = 0;
      for (let i = headerRowIndex + 1; i < allRows.length; i++) {
        const row = allRows[i];
        if (!Array.isArray(row)) continue;

        // Verifica se a linha está vazia (todos os valores são null/empty)
        const isEmpty = row.every(cell => !cell || String(cell).trim() === '');
        if (isEmpty) {
          skippedRows += 1;
          continue;
        }

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
          sourceLines.push(allRowNumbers[i]);
        } else {
          skippedRows += 1;
        }
      }

      if (dataRows.length === 0) {
        throw new Error('Nenhum dado válido encontrado na planilha. Certifique-se de que há dados além dos cabeçalhos.');
      }

      // #1001: non-enumerable, same rationale as readCSV above -- keeps the
      // array's `toEqual` shape used by the existing readers tests intact.
      Object.defineProperty(dataRows, 'skippedCount', {
        value: skippedRows,
        enumerable: false,
      });
      // #1023: mesmo par que o readCSV attacha, mesma razao nao-enumeravel.
      Object.defineProperty(dataRows, 'sourceLines', {
        value: sourceLines,
        enumerable: false,
      });

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

    // #1001: both branches resolve to the same array object readCSV/readExcel
    // return, so the non-enumerable `skippedCount` either of them attaches
    // (blank rows discarded before this array is built) rides along
    // unchanged -- callers read it as `rows.skippedCount`.
    //
    // WARNING for anyone adding a caller: the property is on the array
    // INSTANCE, so it does not survive any transform that builds a new array.
    // `rows.filter(...)`, `rows.map(...)`, `[...rows]` and `rows.slice()` all
    // return a plain Array and `skippedCount` becomes undefined, which the
    // importers' `|| 0` then reads as "nothing was skipped" -- silently, with
    // no error. Read `skippedCount` off the value readFile returned, before
    // any such transform. It is attached this way rather than returned as
    // `{ rows, skipped }` because the existing readers tests assert the return
    // value with `toEqual([...])` on the array itself; changing the shape means
    // changing them and every caller.
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
    const actor = options?.actor || {};
    const results = {
      total: 0,
      success: 0,
      errors: [],
      skipped: 0, // #798: linhas em branco ignoradas, fora de total (#1012: quem as detecta e conta e readCSV/readExcel, nao este loop)
      // #931: SUBCONJUNTO ROTULADO de `errors`, nao um balde separado. Uma
      // linha duplicada ja entra em `errors` e faz `continue`; este contador
      // apenas diz quantos desses erros foram duplicidade. Somar
      // success + errors + duplicates ultrapassaria o total -- ver o
      // comentario em getJobReport.
      duplicates: 0,
      generatedIDs: [] // Não será exposto na resposta final
    };

    try {
      const rows = await this.readFile(file.path, file.originalname, 'patients');
      // #1001: readCSV/readExcel already drop blank rows before this array
      // exists (hasData / isEmpty+all-null-values checks), so results.skipped
      // would stay 0 forever without seeding it from what the reader
      // discarded. #1012: the per-row isEmptyRow backstop that used to sit in
      // the loop below was unreachable for exactly this reason and is gone --
      // the readers are now the only place a blank row is detected or counted.
      results.skipped = rows.skippedCount || 0;
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
        // #1023: a linha FISICA no arquivo, vinda do reader via `sourceLines`
        // (index-aligned com `rows`). O fallback `i + 2` cobre chamadores que
        // mockam readFile com um array simples -- nesse caso a propriedade
        // nao-enumeravel nao existe e o comportamento antigo vale.
        const rowNumber = rows.sourceLines?.[i] ?? (i + 2);

        try {
          // #1012: o guard isEmptyRow que existia aqui era inalcancavel --
          // readCSV/readExcel ja descartam qualquer linha em branco antes
          // deste array existir (ver readFile acima), entao nenhuma `row`
          // aqui pode satisfazer isEmptyRow. Removido; results.skipped
          // continua vindo de rows.skippedCount, seedado acima.
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
                      results.errors.push({ index: i,
                        row: rowNumber,
                        errors: [`Linha ${rowNumber}: Email (email) é obrigatório e deve ser válido. Valor recebido: "${receivedValue}"`],
                        data: this.sanitizeRowForError(row)
                      });
                      continue;
                    }

                    if (!patientData.consentTemplateId) {
                      results.errors.push({ index: i,
                        row: rowNumber,
                        errors: [`Linha ${rowNumber}: Template de consentimento (consentTemplateId) é obrigatório para importação em lote`],
                        data: this.sanitizeRowForError(row)
                      });
                      continue;
                    }

                    const { ObjectId } = require('mongodb');
                    if (!ObjectId.isValid(patientData.consentTemplateId)) {
                      results.errors.push({ index: i,
                        row: rowNumber,
                        errors: [`Linha ${rowNumber}: consentTemplateId inválido`],
                        data: this.sanitizeRowForError(row)
                      });
                      continue;
                    }

                    const consentTemplatesCollection = await getCollection(db, 'consentTemplates');
                    const consentTemplateExists = await consentTemplatesCollection.findOne({ _id: new ObjectId(patientData.consentTemplateId) });
                    if (!consentTemplateExists) {
                      results.errors.push({ index: i,
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
            results.errors.push({ index: i,
              row: rowNumber,
              errors: [`Linha ${rowNumber}: Nome do paciente (patientName) é obrigatório e não pode estar vazio`],
              data: this.sanitizeRowForError(row)
            });
            continue;
          }
          
          if (!patientData.birthDate || !(patientData.birthDate instanceof Date) || isNaN(patientData.birthDate.getTime())) {
            const receivedValue = row.birthDate || 'não informado';
            results.errors.push({ index: i,
              row: rowNumber,
              errors: [`Linha ${rowNumber}: Data de nascimento (birthDate) é obrigatória e deve ser uma data válida no formato DD/MM/YYYY ou YYYY-MM-DD. Valor recebido: "${receivedValue}"`],
              data: this.sanitizeRowForError(row)
            });
            continue;
          }
          
          if (!patientData.sex || !['M', 'F', 'O'].includes(patientData.sex)) {
            const receivedValue = row.sex || 'não informado';
            results.errors.push({ index: i,
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
          const validation = PatientModel.validate(omitLegacyIdentityFields(patientData));
          if (!validation.isValid) {
            // Adiciona número da linha em cada erro para melhor rastreabilidade
            const detailedErrors = validation.errors.map(err => `Linha ${rowNumber}: ${err}`);
            results.errors.push({ index: i,
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
            results.errors.push({ index: i,
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

          // Verifica duplicidade antes de inserir.
          //
          // #942: esta checagem consulta o BANCO (participantIdentities, via
          // checkDuplicatePatient) -- não há conjunto em memória das chaves já
          // vistas NESTE arquivo. Duas linhas idênticas no mesmo CSV mesmo
          // assim são pegas, mas SÓ porque o insert da linha N (:709) é
          // aguardado antes da checagem da linha N+1: quando a linha B chega,
          // a linha A já está no banco. A correção é consequência da ordem do
          // laço, não do desenho.
          //
          // Portanto: NÃO transforme este laço em lote (insertMany, Promise.all,
          // buffer) sem antes adicionar o conjunto em memória. O sintoma seria
          // silencioso -- dois Participants para uma pessoa, diferindo apenas
          // pelo participantId gerado.
          const duplicate = await patientService.checkDuplicatePatient(db, patientData);
          if (duplicate) {
            // patientData.birthDate is guaranteed a valid Date here (row 529's guard `continue`s otherwise)
            const birthDateStr = patientData.birthDate.toLocaleDateString('pt-BR');
            results.errors.push({ index: i,
              row: rowNumber,
              errors: [`Paciente duplicado: já existe um paciente com o nome "${patientData.patientName}" e data de nascimento "${birthDateStr}" cadastrado no sistema`],
              data: this.sanitizeRowForError(row)
            });
            // #931: chave de duplicidade deste caminho = nome + data de nascimento.
            results.duplicates += 1;
            continue;
          }

          // Cria paciente
          const patient = PatientModel.create(omitLegacyIdentityFields(patientData));

          // Insere no banco
          const insertResult = await patientsCollection.insertOne(patient);

          // RF005/RNF007 (#575): patientName/birthDate/identityDocument are
          // civil identity — they never land on Patient. ParticipantIdentity
          // is the sole write target; patientData (not the stripped
          // `patient`) still carries them here for that write.
          const identityCollection = getCollection(db, 'participantIdentities');
          const identityDoc = participantIdentityEncryptionService.encryptIdentityFields(
            ParticipantIdentityModel.create({ ...patientData, participantId: patient.participantId })
          );
          // #1166 slice 3: a refused identity insert must not leave the Patient behind.
          await participantIdentityEncryptionService.insertIdentityOrRollbackPatient(
            identityCollection, identityDoc, patientsCollection, insertResult.insertedId
          );

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
          results.errors.push({ index: i,
            row: rowNumber,
            errors: [error.message || 'Erro desconhecido ao processar linha'],
            data: this.sanitizeRowForError(row)
          });
        }
      }

      // RNF011 AC#4 / RF029 AC#5-6 (#814): quarantines rejected patient rows
      // the same way #787 already does for samples -- reuses
      // quarantineRejectedSampleRows with a distinct batch `type` so a
      // patient batch and a sample batch never collide in the shared
      // import_batches collection. #915 then made both readers type-scoped,
      // so this batch is readable by a caller holding `createPatient` -- the
      // same permission this import itself requires.
      const stagingBatchId = await this.quarantineRejectedSampleRows(db, {
        type: QUARANTINE_BATCH_TYPES.PATIENT,
        importOptions: { groupFields },
        fileName: file?.originalname || null,
        rows,
        results,
        actor,
      });

      // Log sanitizado (sem dados sensíveis)
      logger.info(`Importação de pacientes concluída: ${results.success}/${results.total} registros importados com sucesso`);

      return {
        total: results.total,
        success: results.success,
        errors: results.errors,
        skipped: results.skipped,
        // #969: `results.duplicates` é incrementado acima (linha ~691) mas
        // faltava aqui, então patient-worker lia `undefined`. Continua
        // obrigatório depois de #1007: import-worker agora OMITE o campo
        // quando o resultado não o traz, então uma ausência aqui apagaria
        // o tile "Duplicados" da importação LGPD em vez de gravar 0.
        duplicates: results.duplicates,
        stagingBatchId,
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

  /**
   * #467: RF004 operational-sensor/equipment-readiness gate, mirrored from
   * `sample.service.js`'s `createSample` / `intakeWizard.js`'s
   * `isEquipmentReadyForContainer`+`hasOperationalSensorForContainer`
   * (equipment-level granularity, per #465). Bulk LGPD import bypasses
   * `createSample` and previously placed samples without this check at all.
   */
  async isPlacementReady(db, freezer) {
    if (!freezer?.containerID) return false;

    const equipmentVariants = buildIdVariants(freezer.containerID);
    const equipmentCollection = db.collection('equipment');
    const equipment = await equipmentCollection.findOne({
      equipmentID: { $in: equipmentVariants }
    });
    if (!equipment) return false;

    const equipmentStatus = String(equipment.status || equipment.maintenanceStatus || equipment.operationalStatus || '').trim().toLowerCase();
    if (isEquipmentBlocked(equipmentStatus)) return false;

    const sensorsCollection = db.collection('sensors');
    const sensors = await sensorsCollection.find({
      $or: [
        { locationId: { $in: equipmentVariants } },
        { locationID: { $in: equipmentVariants } }
      ]
    }).limit(20).toArray();

    return sensors.some(isOperationalSensor);
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

      const boxCandidates = boxes
        .slice(startIndex)
        .filter((box) => this.isBoxAvailable(box));

      // #471: skip candidates whose freezer fails the RF004 readiness gate
      // and keep advancing, matching `intakeWizard.js`'s
      // `resolveAutomaticLocation` — a single non-ready freezer shouldn't
      // fail rows that could be placed in a later box in the same sequence.
      const readyBoxes = [];
      for (const box of boxCandidates) {
        const { freezer } = await this.resolveStorageHierarchyForBox(db, box);
        if (!freezer) continue;
        if (!(await this.isPlacementReady(db, freezer))) continue;
        readyBoxes.push(box);
      }

      const target = readyBoxes[index];
      if (!target) {
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

  /**
   * #787 (RNF011 AC#4, Crítica): "Importações inválidas são colocadas em
   * staging ou quarentena, sem correção silenciosa."
   *
   * Deliberately mirrors the FHIR import path, which already satisfies this
   * same acceptance criterion (`fhir-import-staging.service.js`, proven
   * end-to-end by `interop-monitoring.spec.ts`): the same two collections,
   * `import_batches` and `import_staging_records`, and the same
   * batch-plus-per-row shape. The FHIR batch document already discriminates
   * itself with `type: 'FHIR_BUNDLE'` / `source: 'FHIR'`, so that schema was
   * built to hold more than one import path -- this is the second.
   *
   * Like that service, this reaches for `db.collection(...)` directly rather
   * than `getCollection`: neither collection is registered in
   * `CANONICAL_COLLECTIONS`, and the FHIR path set the precedent.
   *
   * Best-effort by design. If quarantining fails, the import still returns
   * whatever it accomplished -- losing the review copy must not also lose
   * the rows that did import. The failure is logged and `stagingBatchId`
   * comes back null, so a caller can tell the difference between "nothing
   * was rejected" and "rejections were not preserved".
   *
   * Returns the batch id, or null when there was nothing to quarantine.
   */
  /**
   * Le um lote de quarentena LGPD e as linhas rejeitadas dele (#794, RNF011
   * AC#4 -- "sem correcao silenciosa").
   *
   * O #787 fez as linhas rejeitadas sobreviverem; nada conseguia le-las de
   * volta, entao a quarentena so era acessivel consultando o Mongo direto.
   * Espelha o `getBatch` do caminho FHIR (`fhir-import-staging.service.js`):
   * mesmas duas colecoes, mesma forma lote-mais-linhas, mesmo 404 via
   * `error.statusCode`, mesma ordenacao por rowNumber.
   *
   * Diferenca deliberada em relacao ao original: filtra tambem por `type`.
   * As rotas de importacao compartilham `import_batches`, e um leitor que
   * filtra so por `_id` entrega o lote de outra rota a quem tem a permissao
   * errada -- as linhas em quarentena carregam identificadores civis. O
   * leitor FHIR ainda tem esse vazamento; esta rastreado no #799 e nao e
   * reproduzido aqui.
   *
   * #915: `types` diz *quais* tipos LGPD este chamador pode ler. O #814
   * passou a escrever lotes de participantes com `LGPD_PATIENT_CSV`, e
   * enquanto este filtro era fixo em `LGPD_SAMPLE_CSV` esses lotes eram
   * gravados e ficavam ilegiveis -- 404 ate com o id correto. O padrao
   * continua so-amostras: quem chama e que decide alargar, aplicando a regra
   * que `import-lgpd.routes.js` ja enunciava para o lote de amostras -- a
   * mesma permissao da importacao que produziu o lote.
   *
   * Um id malformado e 400, nao um cast de BSON estourando como 500.
   */
  async getQuarantineBatch(db, batchIdRaw, { types } = {}) {
    // ObjectId e exigido inline neste arquivo (ver linhas 503/803), nao no topo.
    const { ObjectId } = require('mongodb');
    const raw = String(batchIdRaw || '').trim();

    if (!ObjectId.isValid(raw)) {
      const error = new Error('Identificador de lote de importacao invalido.');
      error.statusCode = 400;
      throw error;
    }

    const batchId = new ObjectId(raw);

    const batch = await db.collection('import_batches').findOne({
      _id: batchId,
      type: { $in: normalizeQuarantineTypes(types) },
    });

    if (!batch) {
      const error = new Error('Lote de quarentena LGPD nao encontrado.');
      error.statusCode = 404;
      throw error;
    }

    const records = await db
      .collection('import_staging_records')
      .find({ batchId })
      .sort({ rowNumber: 1 })
      .toArray();

    return { batch, records };
  }

  /**
   * Lista os lotes de quarentena LGPD, do mais recente para o mais antigo
   * (#794 item 2, RNF011 AC#4).
   *
   * O #794 slice 1 tornou um lote legivel *se voce ja souber o id dele*. Nada
   * entrega esse id a um operador: `stagingBatchId` volta na resposta da API,
   * mas a importacao LGPD nao tem nenhum consumidor no frontend (#808), entao
   * ele nunca chegou a uma tela. Sem listagem nao existe ponto de entrada
   * navegavel, e uma tela de revisao seria codigo inalcancavel.
   *
   * Filtra por `type` pelo mesmo motivo que `getQuarantineBatch`:
   * `import_batches` e compartilhada com a importacao FHIR e as rotas tem
   * permissoes diferentes (#799 foi exatamente esse defeito no sentido
   * oposto). `types` (#915) recebe o conjunto que este chamador pode ler; o
   * padrao e so-amostras.
   *
   * Devolve **so o resumo do lote** -- deliberadamente nao le
   * `import_staging_records`. As linhas carregam `row`, a linha original da
   * planilha, com identificadores civis (#807); uma listagem nao precisa
   * deles, e transformar "um lote" em "todos os lotes" seria ampliar a
   * exposicao na direcao errada.
   */
  async listQuarantineBatches(db, { limit = 20, page = 1, types } = {}) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const safePage = Math.max(parseInt(page, 10) || 1, 1);
    const skip = (safePage - 1) * safeLimit;

    const filter = { type: { $in: normalizeQuarantineTypes(types) } };
    const collection = db.collection('import_batches');

    const [batches, total] = await Promise.all([
      collection.find(filter).sort({ createdAt: -1 }).skip(skip).limit(safeLimit).toArray(),
      collection.countDocuments(filter),
    ]);

    return {
      batches,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.max(Math.ceil(total / safeLimit), 1),
    };
  }

  /**
   * Normaliza as opcoes de importacao para gravacao no lote (#794 item 3).
   *
   * `groupFields` vem do caller e acaba num documento que um reenvio le de
   * volta para montar uma query -- so escalares planos entram, para que nao
   * seja possivel contrabandear um operador (`{$ne: null}`) para dentro do
   * lote e ve-lo reaparecer num filtro depois.
   */
  sanitizeImportOptions(importOptions = {}) {
    const groupFields = {};
    const raw = importOptions?.groupFields;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [key, value] of Object.entries(raw)) {
        if (key.startsWith('$') || key.includes('.')) continue;
        if (value === null) continue;
        const type = typeof value;
        if (type === 'string' || type === 'number' || type === 'boolean') {
          groupFields[key] = value;
        }
      }
    }

    return {
      startBoxId: importOptions?.startBoxId ? String(importOptions.startBoxId) : null,
      autoIncrement: Boolean(importOptions?.autoIncrement),
      groupFields,
    };
  }

  async quarantineRejectedSampleRows(
    db,
    { fileName = null, rows = [], results, actor = {}, importOptions = {}, type = 'LGPD_SAMPLE_CSV' } = {}
  ) {
    const rejected = Array.isArray(results?.errors) ? results.errors : [];
    if (rejected.length === 0) return null;

    try {
      const now = new Date();

      const batchDoc = {
        type,
        source: 'LGPD',
        status: 'QUARANTINED',
        fileName: fileName ? String(fileName) : null,
        counts: {
          total: results.total,
          success: results.success,
          errors: rejected.length,
        },
        // #794 item 3: the options the rejected rows were imported under.
        // importSamples places each row with
        // getNextAvailableStorageSlot(db, startBoxId, results.success) -- the
        // running success count within this batch is the slot index -- and
        // reads startBoxId/autoIncrement/groupFields from the caller. Without
        // them persisted, a corrected row cannot be resubmitted through the
        // same path that rejected it, because the placement intent no longer
        // exists anywhere once the request ends. `counts.success` above is
        // the matching cursor.
        importOptions: this.sanitizeImportOptions(importOptions),
        createdBy: actor?.userID || actor?.userId || null,
        createdAt: now,
        updatedAt: now,
      };

      const batchResult = await db.collection('import_batches').insertOne(batchDoc);
      const batchId = batchResult.insertedId;

      const stagedRecords = rejected.map((rejection) => ({
        batchId,
        // #1023: rowNumber e' a linha FISICA do arquivo -- o que o operador
        // ve' ao abrir a planilha -- e nao mais o indice do array filtrado
        // mais um header. Os dois divergem em uma unidade por linha em branco
        // anterior a esta.
        //
        // Por isso a linha de origem e' resolvida por `rejection.index` (o
        // indice no array `rows`, carregado separadamente em cada entrada de
        // results.errors) e NAO derivando-o de volta de `rowNumber - 2`. A
        // derivacao era correta so' enquanto os dois numeros coincidiam; com a
        // linha fisica ela aponta para a linha errada, ou para fora do array,
        // e o `|| null` transformava isso num registro em quarentena
        // impossivel de corrigir -- silenciosamente, que e' pior do que o bug
        // de numeracao que #1023 comecou por corrigir.
        //
        // Deliberadamente sem fallback para `rowNumber - 2`: aplicado a uma
        // linha fisica ele calcula um indice ERRADO em silencio, o que e' pior
        // do que o undefined que um chamador sem `index` produziria.
        rowNumber: rejection.row,
        status: 'ERROR',
        errors: rejection.errors || [],
        validationErrors: rejection.errors || [],
        // The original row as read from the file. Without it a quarantined
        // record can be reviewed but not corrected and re-submitted, which
        // is the whole reason to quarantine rather than log.
        row: rows[rejection.index] ?? null,
        normalized: rejection.data || null,
        createdAt: now,
        updatedAt: now,
      }));

      await db.collection('import_staging_records').insertMany(stagedRecords);

      logger.warn(
        `[IMPORT_LGPD] ${stagedRecords.length} linha(s) rejeitada(s) colocadas em quarentena (batch ${batchId})`
      );

      return batchId;
    } catch (stagingError) {
      logger.error(
        'Falha ao colocar linhas rejeitadas em quarentena (RNF011 AC#4):',
        stagingError.message || stagingError
      );
      return null;
    }
  }
  /**
   * Grava um lote FAILED quando a importacao de amostras lanca a nivel de
   * cabecalho (#806, RNF011 AC#4).
   *
   * `quarantineRejectedSampleRows` acima so entra em jogo depois que pelo
   * menos uma linha foi processada e rejeitada -- um throw de cabecalho
   * (campos obrigatorios ausentes, identificacao do paciente ausente)
   * acontece ANTES do loop de linhas (ver o guard `rows.length > 0` em
   * `importSamples`), entao nenhuma linha e encaminhada e nenhum lote
   * existe para `retainSourceFileForBatch` reter o arquivo contra ele --
   * essa funcao exige um `_id` de lote ja gravado. Sem este lote o catch do
   * controller so podia apagar o arquivo, exatamente o modo de falha em que
   * o proprio arquivo e o suspeito mais provavel.
   *
   * Usa o mesmo `type` que `quarantineRejectedSampleRows` grava para lotes
   * de amostras ('LGPD_SAMPLE_CSV'), para que `listQuarantineBatches` (que
   * filtra so por `type`) e `getQuarantineBatch` (que tolera um lote sem
   * `import_staging_records`) enxerguem este lote sem mudanca nenhuma.
   *
   * Ao contrario de `quarantineRejectedSampleRows` e
   * `retainSourceFileForBatch`, esta funcao NAO e best-effort: se a gravacao
   * falhar, o erro sobe para o controller decidir o fallback (apagar o
   * arquivo como antes) em vez de mascarar silenciosamente a perda do lote.
   */
  async recordFailedImportBatch(db, { fileName = null, error, actor = {}, importOptions = {}, type = 'LGPD_SAMPLE_CSV' } = {}) {
    const now = new Date();
    const errorMessage = (error && error.message) ? error.message : String(error || 'Erro desconhecido');

    const batchDoc = {
      type,
      source: 'LGPD',
      status: 'FAILED',
      fileName: fileName ? String(fileName) : null,
      counts: {
        total: 0,
        success: 0,
        errors: 0,
      },
      error: errorMessage,
      importOptions: this.sanitizeImportOptions(importOptions),
      createdBy: actor?.userID || actor?.userId || null,
      createdAt: now,
      updatedAt: now,
    };

    const batchResult = await db.collection('import_batches').insertOne(batchDoc);
    const batchId = batchResult.insertedId;

    logger.warn(
      `[IMPORT_LGPD] Importacao de amostras falhou a nivel de cabecalho, lote FAILED aberto (batch ${batchId}): ${errorMessage}`
    );

    return batchId;
  }

  async importSamples(db, file, options = {}) {
    const { startBoxId = null, autoIncrement = false, groupFields = {}, neo4jDriver = null, actor = {} } = options;
    const results = {
      total: 0,
      success: 0,
      errors: [],
      skipped: 0, // #798: linhas em branco ignoradas, fora de total (#1012: quem as detecta e conta e readCSV/readExcel, nao este loop)
      duplicates: 0, // #931: subconjunto rotulado de `errors` (ver importPatients)
      importedSampleIds: []
    };

    try {
      const rows = await this.readFile(file.path, file.originalname, 'samples');
      // #1001: same seeding as importPatients -- readCSV/readExcel already
      // drop blank rows before this array exists. #1012: the unreachable
      // per-row backstop below is gone for that same reason.
      results.skipped = rows.skippedCount || 0;
      const samplesCollection = await getCollection(db, 'samples');
      const patientsCollection = await getCollection(db, 'patients');
      const validator = new SampleGraphValidator(db);
      const drugService = new DrugService(db);
      // #477: samples are inserted unallocated, then AllocateSampleUseCase
      // performs the atomic occupancyGrid write, storageLocation update,
      // StorageAssignment record and audit/lineage trail — same use case
      // sample.service.js's createSample reuses (#474). Replaces this
      // loop's old direct storageLocation write + manual StorageAssignment
      // insert, which never updated the box's occupancyGrid, so a fixed
      // (non-auto-increment) target box silently double-booked its first
      // free position across every row.
      const allocateUseCase = new AllocateSampleUseCase({
        storageRepository: new MongoStorageRepository(db),
        auditRepository: new MongoAuditRepository(db),
        lineageRepository: new LineageRepository(neo4jDriver)
      });

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
        // #1023: a linha FISICA no arquivo, vinda do reader via `sourceLines`
        // (index-aligned com `rows`). O fallback `i + 2` cobre chamadores que
        // mockam readFile com um array simples -- nesse caso a propriedade
        // nao-enumeravel nao existe e o comportamento antigo vale.
        const rowNumber = rows.sourceLines?.[i] ?? (i + 2);
        let sampleData = null;

        // #1012: o guard isEmptyRow que existia aqui era inalcancavel -- pela
        // mesma razao do loop de importPatients (readCSV/readExcel ja
        // descartam a linha em branco antes deste array existir). Removido;
        // results.skipped continua vindo de rows.skippedCount, seedado acima.

        // #786: counted here, at the top of the loop body, rather than at the
        // bottom. Every rejected row leaves via a `continue`, so a
        // bottom-of-loop increment skipped it entirely and a partially-failed
        // import reported total < success + errors -- numbers that
        // import-lgpd.controller.js passes straight to auditLogger.logImport.
        // importPatientsSmart already counts in this position; importPatients
        // counts just after its empty-row guard. importSamples has no
        // empty-row guard, so before the try is the equivalent spot.
        results.total++;

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
            results.errors.push({ index: i,
              row: rowNumber,
              errors: ['Nao foi possivel resolver a identidade do paciente para a amostra'],
              data: { participantId: null }
            });
            continue;
          }

          // Valida formato do ID (8 dígitos)
          const participantIdStr = String(sampleData.participantId).trim();
          if (participantIdStr.length !== 8 || !/^\d{8}$/.test(participantIdStr)) {
            results.errors.push({ index: i,
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
            results.errors.push({ index: i,
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
            results.errors.push({ index: i,
              row: rowNumber,
              errors: validation.errors,
              data: { participantId: participantIdStr } // Apenas ID, sem dados sensíveis
            });
            continue;
          }

          // Validações específicas - verifica se os valores existem no banco.
          // (SampleModel.validate() above already confirmed sampleType/sampleOrigin/extractionProtocol
          // are valid per SampleModel.validateXxx, so only the findOne lookup can fail here)
          // #702: consultado por `id`. Estes campos carregam o id MIABIS
          // ("PLASMA"), enquanto `description` guarda o rótulo humano
          // ("Plasma") -- consultar por description com um id nunca casava.
          if (sampleData.sampleType) {
            const sampleTypesCollection = db.collection('sampleTypes');
            const validSampleType = await sampleTypesCollection.findOne({ id: sampleData.sampleType });
            if (!validSampleType) {
              results.errors.push({ index: i,
                row: rowNumber,
                errors: [`Tipo de amostra "${sampleData.sampleType}" não encontrado no banco de dados. Use um valor cadastrado.`],
                data: { participantId: participantIdStr }
              });
              continue;
            }
          }

          if (sampleData.sampleOrigin) {
            const sampleOriginsCollection = db.collection('sampleOrigins');
            const validOrigin = await sampleOriginsCollection.findOne({ id: sampleData.sampleOrigin });
            if (!validOrigin) {
              results.errors.push({ index: i,
                row: rowNumber,
                errors: [`Origem "${sampleData.sampleOrigin}" não encontrada no banco de dados. Use um valor cadastrado.`],
                data: { participantId: participantIdStr }
              });
              continue;
            }
          }

          if (sampleData.extractionProtocol) {
            const extractionProtocolsCollection = db.collection('extractionProtocols');
            const validProtocol = await extractionProtocolsCollection.findOne({ id: sampleData.extractionProtocol });
            if (!validProtocol) {
              results.errors.push({ index: i,
                row: rowNumber,
                errors: [`Protocolo de extração "${sampleData.extractionProtocol}" não encontrado no banco de dados. Use um valor cadastrado.`],
                data: { participantId: participantIdStr }
              });
              continue;
            }
          }

          // #944: era "RF004". Nenhum criterio do RF004 menciona barcode --
          // AC#2 e sobre specimenId, outro identificador com outro gerador.
          // O requisito que esta checagem serve e dict-02 ELM-0116
          // (Specimen.barcodeValue), coluna Unicidade = `Unico`.
          // #936 item 2: esta checagem roda ANTES da geracao (~linha 1507), entao so
          // cobre barcodes VINDOS DO CSV, nunca um gerado. Foi avaliado e MANTIDO de
          // proposito (2026-09-02), nao e descuido:
          //   1. desde #932 o retry de generateUniqueBarcode consulta a colecao
          //      certa, entao uma colisao gerada ja e detectada e re-tentada ali;
          //   2. desde #936 item 1 existe indice unico real samples_barcode_unique_v1
          //      (utils/sampleIndexes.js, montado em utils/collectionResolver.js:46-48),
          //      entao uma colisao que escape ao retry falha alto com E11000 em vez de
          //      corromper em silencio -- que e a protecao esperada desta guarda;
          //   3. mover a guarda para depois da geracao transformaria uma colisao
          //      gerada em REJEICAO da linha em vez de nova tentativa: pior para o
          //      operador, e ELM-0116 nao pede isso.
          // O ganho restante seria simetria; o custo e mudar o comportamento do
          // import. INFERENCIA da preferencia do repositorio por mudancas estreitas,
          // NAO citacao -- nenhum doc fala de ordem de guarda. Barato de reverter.
          // Verifica duplicidade por barcode (se fornecido)
          // #942: mesma propriedade de importPatients -- esta checagem consulta
          // o BANCO, e duas linhas com o mesmo barcode no mesmo arquivo só são
          // pegas porque o insert da linha N (:1537) é aguardado antes da
          // checagem da linha N+1. Não há conjunto em memória dos barcodes já
          // vistos neste arquivo. Não transforme o laço em lote sem adicionar um.
          if (sampleData.barcode) {
            const existingSample = await samplesCollection.findOne({ barcode: sampleData.barcode });
            if (existingSample) {
              results.errors.push({ index: i,
                row: rowNumber,
                errors: [`Já existe uma amostra com o código de barras ${sampleData.barcode}`],
                data: { participantId: participantIdStr, barcode: sampleData.barcode }
              });
              // #931: chave de duplicidade deste caminho = barcode (RF004).
              // Diferente da chave usada em importPatients, de proposito: sao
              // entidades diferentes. Por isso `duplicatesFound` conta "linhas
              // rejeitadas por duplicidade", nao "duplicidade por <uma> chave".
              results.duplicates += 1;
              continue;
            }
          }

          // #459/#477: resolve a candidate storageLocation (boxId/positionCode)
          // for this row — CSV-provided boxId first, then auto-increment
          // from the StorageBox sequence, then a single fixed startBoxId
          // applied to every location-less row — same precedence the legacy
          // `getNextAvailableLocation`/`startLocationID` path used. Kept as a
          // local candidate (not written onto sampleData) — the sample is
          // inserted unallocated below, then AllocateSampleUseCase performs
          // the actual atomic occupancyGrid reservation for this candidate.
          let candidateLocation = null;
          if (sampleData.boxId) {
            const { ObjectId } = require('mongodb');
            const boxesCollection = db.collection('storageBoxes');
            const providedBoxId = ObjectId.isValid(String(sampleData.boxId))
              ? new ObjectId(String(sampleData.boxId))
              : null;
            const providedBox = providedBoxId ? await boxesCollection.findOne({ _id: providedBoxId }) : null;
            if (providedBox) {
              candidateLocation = {
                boxId: providedBox._id,
                position: sampleData.positionCode || this.findFirstAvailablePositionInBox(providedBox),
              };
            }
          }

          if (!candidateLocation && autoIncrement && startBoxId) {
            const nextSlot = await this.getNextAvailableStorageSlot(db, startBoxId, results.success);
            if (nextSlot && nextSlot.position) {
              candidateLocation = { boxId: nextSlot.boxId, position: nextSlot.position };
              logger.debug(`Localização automática atribuída: caixa ${nextSlot.boxId} posição ${nextSlot.position} para linha ${rowNumber}`);
            } else {
              results.errors.push({ index: i,
                row: rowNumber,
                errors: ['Não há mais localizações de armazenamento disponíveis para incremento automático'],
                data: { participantId: participantIdStr }
              });
              continue;
            }
          } else if (!candidateLocation && !autoIncrement && startBoxId) {
            const { ObjectId } = require('mongodb');
            const boxesCollection = db.collection('storageBoxes');
            const startBoxObjectId = ObjectId.isValid(String(startBoxId)) ? new ObjectId(String(startBoxId)) : null;
            const startBox = startBoxObjectId ? await boxesCollection.findOne({ _id: startBoxObjectId }) : null;
            const position = startBox ? this.findFirstAvailablePositionInBox(startBox) : null;
            if (startBox && position) {
              candidateLocation = { boxId: startBox._id, position };
            }
          }

          // #467: RF004 operational-sensor/equipment-readiness gate —
          // `createSample`/`intakeWizard.js` both refuse to place a
          // specimen in a freezer that isn't equipment-ready or has no
          // operational sensor; bulk LGPD import bypasses `createSample`
          // entirely and previously never checked this at all.
          if (candidateLocation?.boxId) {
            const storageBoxesCollection = db.collection('storageBoxes');
            const placementBox = await storageBoxesCollection.findOne({ _id: candidateLocation.boxId });
            const { freezer: placementFreezer } = placementBox
              ? await this.resolveStorageHierarchyForBox(db, placementBox)
              : {};
            if (!placementFreezer || !(await this.isPlacementReady(db, placementFreezer))) {
              results.errors.push({ index: i,
                row: rowNumber,
                errors: ['Localização física sem equipamento pronto ou sensor operacional associado.'],
                data: { participantId: participantIdStr }
              });
              continue;
            }
          }

          // Gera código de barras automaticamente se não fornecido
          if (!sampleData.barcode || (typeof sampleData.barcode === 'string' && sampleData.barcode.trim() === '')) {
            const { generateUniqueBarcode } = require('../utils/barcodeGenerator');
            sampleData.barcode = await generateUniqueBarcode(db);
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
          
          // Insere no banco (sem storageLocation — a amostra entra não alocada)
          const insertResult = await samplesCollection.insertOne(sample);
          results.importedSampleIds.push(insertResult.insertedId);

          // #499: mirrors import.service.js's CSV/XLSX branch — records the
          // canonical, referenced RcsAssessment snapshot alongside the
          // embedded copy this parser already computes.
          if (sample.rcsEvaluation) {
            try {
              const assessment = await rcsAssessmentService.recordAssessment(db, sample.specimenId, sample.rcsEvaluation);
              // #502: pins integrity verification to this snapshot, the one
              // in effect when merkleRoot was sealed above, so a later
              // re-assessment for the same specimenId can't false-positive
              // a tamper report.
              await samplesCollection.updateOne(
                { _id: insertResult.insertedId },
                { $set: { sealedRcsAssessmentId: assessment._id } }
              );
            } catch (assessmentError) {
              logger.warn('[IMPORT_LGPD] Falha ao registrar snapshot RcsAssessment referenciado, amostra mantém cópia embutida', {
                specimenId: sample.specimenId,
                error: assessmentError?.message || String(assessmentError),
              });
            }
          }

          // #503: mirrors the RCS pin above and import.service.js's
          // CSV/XLSX branch — records the canonical, referenced
          // SpecimenPreanalytics snapshot alongside the embedded sprec copy.
          if (sample.sprec) {
            try {
              const profile = await specimenPreanalyticsService.recordProfile(db, sample.specimenId, sample.sprec);
              await samplesCollection.updateOne(
                { _id: insertResult.insertedId },
                { $set: { sealedSpecimenPreanalyticsId: profile._id } }
              );
            } catch (profileError) {
              logger.warn('[IMPORT_LGPD] Falha ao registrar snapshot SpecimenPreanalytics referenciado, amostra mantém cópia embutida', {
                specimenId: sample.specimenId,
                error: profileError?.message || String(profileError),
              });
            }
          }

          // #477: AllocateSampleUseCase performs the atomic occupancyGrid
          // write, storageLocation update, StorageAssignment record
          // (dict-02 ELM-0167-0178) and audit/lineage trail for the
          // candidate resolved above — replaces the old manual
          // StorageAssignment insert, which never touched the box's
          // occupancyGrid.
          if (candidateLocation?.boxId) {
            await allocateUseCase.execute({
              specimenId: insertResult.insertedId,
              boxId: String(candidateLocation.boxId),
              position: candidateLocation.position,
              actor: {
                userId: actor?.userId || null,
                userName: actor?.userName || 'IMPORT_LGPD',
                userRole: actor?.userRole || null,
                ipAddress: actor?.ipAddress || null,
                userAgent: actor?.userAgent || null
              }
            });
            sample.storageLocation = { boxId: candidateLocation.boxId, position: candidateLocation.position };
          }

          try {
            await validator.validateSampleCompliance(String(insertResult.insertedId));
          } catch (validationError) {
            logger.warn('[IMPORT_LGPD] Falha no SampleGraphValidator durante importação', {
              specimenId: String(insertResult.insertedId),
              row: rowNumber,
              error: validationError?.message || String(validationError),
            });
          }

          // RF005/RNF007 (#575): patientName is civil identity — never
          // written to Patient (was a bare patientName $set here before).
          await patientsCollection.updateOne(
            { _id: matchedPatient.patient._id },
            {
              $set: {
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
          results.errors.push({ index: i,
            row: rowNumber,
            errors: [error.message],
            data: { participantId: sampleData?.participantId || null }
          });
        }
      }

      // #787 (RNF011 AC#4, Crítica): "Importações inválidas são colocadas em
      // staging ou quarentena, sem correção silenciosa." Until now a rejected
      // row lived only in the HTTP response, and the controller deletes the
      // uploaded file immediately afterwards -- so an operator who imported
      // 500 rows, got 40 rejections and closed the tab had lost both the rows
      // and the file, while the half that did import was already canonically
      // persisted.
      const stagingBatchId = await this.quarantineRejectedSampleRows(db, {
        importOptions: { startBoxId, autoIncrement, groupFields },
        fileName: file?.originalname || null,
        rows,
        results,
        actor,
      });

      // Log sanitizado (sem dados sensíveis)
      logger.info(`Importação de amostras concluída: ${results.success}/${results.total} registros importados com sucesso`);

      return {
        total: results.total,
        success: results.success,
        errors: results.errors,
        skipped: results.skipped,
        // #969: mesmo defeito de importPatients — incrementado (~1445) e
        // descartado aqui, tornando duplicatesFound sempre 0 em sample-worker.
        duplicates: results.duplicates,
        importedSampleIds: results.importedSampleIds,
        stagingBatchId
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
    // #758: this was a two-alias fallback (row.registerDate, then
    // row.registrationDate) until e2549bee renamed both arms to the same
    // canonical name, leaving an else-if whose condition could never differ
    // from the if. The producer side of that collision is #767.
    let registeredAt = null;
    if (row.registeredAt) {
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
      barcode: row.barcode ? String(row.barcode).trim() : null, // dict-02 ELM-0116 -- barcode como string (#944)
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
      // #499: camelCase alias SampleModel.create actually reads
      // (`data.rcsEvaluation`) — the snake_case `rcs_evaluation` above is
      // dropped by SampleModel.create and was never wired to
      // rcsAssessmentService.recordAssessment below.
      rcsEvaluation: canonicalQualityAssessment,
      canonical: {
        rcsScore: externalQualityAssessment.score,
        scoreBasedGrade: externalQualityAssessment.category || '',
        axisPenalties: [],
      },
      externalQualityAssessment: externalQualityAssessment,
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
    const actor = options?.actor || {};

    if (!mapping || Object.keys(mapping).length === 0) {
      throw new Error('Mapeamento inteligente é obrigatório para importação em lote');
    }

    const results = {
      total: 0,
      success: 0,
      errors: [],
      skipped: 0, // #798: linhas em branco ignoradas, fora de total (#1012: quem as detecta e conta e readCSV/readExcel, nao este loop)
      duplicates: 0 // #931: subconjunto rotulado de `errors` (ver importPatients)
    };

    const rows = await this.readFile(file.path, file.originalname, 'patients');
    // #1001: same seeding as importPatients/importSamples -- readCSV/readExcel
    // already drop blank rows before this array exists.
    results.skipped = rows.skippedCount || 0;
    const patientsCollection = await getCollection(db, 'patients');
    const { ObjectId } = require('mongodb');

    for (let i = 0; i < rows.length; i += 1) {
      const rawRow = rows[i];
      // #1023: idem os outros dois importadores.
      const rowNumber = rows.sourceLines?.[i] ?? (i + 2);

      // #1012: o guard isEmptyRow que existia aqui era inalcancavel -- pela
      // mesma razao dos outros dois loops (readCSV/readExcel ja descartam a
      // linha em branco antes deste array existir). Removido; results.skipped
      // continua vindo de rows.skippedCount, seedado acima.
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
          results.errors.push({ index: i, row: rowNumber, errors: [`Linha ${rowNumber}: Nome do paciente é obrigatório`] });
          continue;
        }

        if (!patientData.email || !PatientModel.isValidEmail(patientData.email)) {
          results.errors.push({ index: i, row: rowNumber, errors: [`Linha ${rowNumber}: Email inválido`] });
          continue;
        }

        if (patientData.cpf && !this.isValidCpf(patientData.cpf)) {
          results.errors.push({ index: i, row: rowNumber, errors: [`Linha ${rowNumber}: CPF inválido`] });
          continue;
        }

        if (!patientData.birthDate || !(patientData.birthDate instanceof Date) || Number.isNaN(patientData.birthDate.getTime())) {
          results.errors.push({ index: i, row: rowNumber, errors: [`Linha ${rowNumber}: Data de nascimento inválida`] });
          continue;
        }

        if (this.isFutureDate(patientData.birthDate)) {
          results.errors.push({ index: i, row: rowNumber, errors: [`Linha ${rowNumber}: Data de nascimento futura não é permitida`] });
          continue;
        }

        if (!patientData.consentTemplateId || !ObjectId.isValid(patientData.consentTemplateId)) {
          results.errors.push({ index: i, row: rowNumber, errors: [`Linha ${rowNumber}: consentTemplateId inválido ou ausente`] });
          continue;
        }

        const consentTemplatesCollection = await getCollection(db, 'consentTemplates');
        const consentTemplateExists = await consentTemplatesCollection.findOne({ _id: new ObjectId(patientData.consentTemplateId) });
        if (!consentTemplateExists) {
          results.errors.push({ index: i, row: rowNumber, errors: [`Linha ${rowNumber}: Template de consentimento não encontrado`] });
          continue;
        }

        if (patientData.isDeceased) {
          if (!patientData.representativeName || !patientData.representativeEmail) {
            results.errors.push({ index: i, row: rowNumber, errors: [`Linha ${rowNumber}: Para paciente falecido, responsável (nome e email) é obrigatório`] });
            continue;
          }
          if (!PatientModel.isValidEmail(patientData.representativeEmail)) {
            results.errors.push({ index: i, row: rowNumber, errors: [`Linha ${rowNumber}: Email do responsável inválido`] });
            continue;
          }
        }

        // #942: terceiro dos três sites -- ver a nota longa em importPatients
        // (~:680). Também depende do insert aguardado (:2314) para pegar
        // duplicatas dentro do mesmo arquivo; não há conjunto em memória.
        const duplicate = await patientService.checkDuplicatePatient(db, patientData);
        if (duplicate) {
          results.errors.push({ index: i, row: rowNumber, errors: [`Linha ${rowNumber}: Paciente duplicado detectado`] });
          // #931: mesma chave que importPatients (nome + data de nascimento) --
          // ambos chamam patientService.checkDuplicatePatient.
          results.duplicates += 1;
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

        const validation = PatientModel.validate(omitLegacyIdentityFields(patientData));
        if (!validation.isValid) {
          results.errors.push({ index: i, row: rowNumber, errors: validation.errors.map((error) => `Linha ${rowNumber}: ${error}`) });
          continue;
        }

        const consentMetadata = notificationService.buildConsentMetadata();
        patientData.status = 'PENDING_CONSENT';
        patientData.consentToken = consentMetadata.token;
        patientData.consentTokenCreatedAt = consentMetadata.createdAt;
        patientData.consentTokenExpiresAt = consentMetadata.expiresAt;

        const patient = PatientModel.create(omitLegacyIdentityFields(patientData));
        const insertResult = await patientsCollection.insertOne(patient);

        // RF005/RNF007 (#575): patientName/birthDate/identityDocument are
        // civil identity — they never land on Patient. ParticipantIdentity
        // is the sole write target; patientData (not the stripped
        // `patient`) still carries them here for that write.
        const identityCollection = getCollection(db, 'participantIdentities');
        const identityDoc = participantIdentityEncryptionService.encryptIdentityFields(
          ParticipantIdentityModel.create({ ...patientData, participantId: patient.participantId })
        );
        // #1166 slice 3: a refused identity insert must not leave the Patient behind.
        await participantIdentityEncryptionService.insertIdentityOrRollbackPatient(
          identityCollection, identityDoc, patientsCollection, insertResult.insertedId
        );

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
        results.errors.push({ index: i, row: rowNumber, errors: [error.message || 'Erro desconhecido ao processar linha'] });
      }
    }

    // RNF011 AC#4 / RF029 AC#5-6 (#814): same quarantine reuse as
    // importPatients above, with the same distinct 'LGPD_PATIENT_CSV' type.
    results.stagingBatchId = await this.quarantineRejectedSampleRows(db, {
      type: 'LGPD_PATIENT_CSV',
      importOptions: { groupFields },
      fileName: file?.originalname || null,
      rows,
      results,
      actor,
    });

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
   * Retem o arquivo enviado quando linhas foram para a quarentena (#792,
   * RNF011 AC#4 -- "sem correcao silenciosa").
   *
   * O #787 fez as linhas rejeitadas sobreviverem; o arquivo de origem
   * continuava sendo apagado incondicionalmente pelo controller. Os dois nao
   * se substituem: a linha em quarentena e a visao *interpretada* pelo
   * sistema, entao ela nao serve justamente para o caso em que o proprio
   * arquivo e o culpado (delimitador errado, encoding, coluna deslocada) --
   * ali o registro em staging documenta o erro de leitura, nao a entrada. E
   * tambem nao e o artefato que um revisor de conformidade pede ao
   * reconstruir o que o operador enviou.
   *
   * O arquivo sai de `uploads/temp/` (que qualquer rotina de limpeza pode
   * legitimamente esvaziar) para `uploads/quarantine/`, e o nome no disco e o
   * id do lote -- **nunca** o `originalname`, que vem do cliente e serviria
   * de vetor de path traversal. O nome original fica so como metadado.
   *
   * Best-effort, igual a `quarantineRejectedSampleRows`: perder a copia de
   * revisao nao pode derrubar uma importacao que ja gravou linhas. Devolve
   * null em qualquer falha, sempre com log.
   *
   * Por quanto tempo esses arquivos ficam retidos e questao aberta no #793,
   * junto com a retencao das proprias linhas em quarentena.
   */
  async retainSourceFileForBatch(db, file, batchId) {
    try {
      if (!file?.path || !fs.existsSync(file.path)) return null;

      const originalName = path.basename(String(file.originalname || '')) || 'upload';
      const extension = path.extname(originalName) || '.dat';
      const size = fs.statSync(file.path).size;

      const quarantineDir = path.join(path.dirname(file.path), '..', 'quarantine');
      fs.mkdirSync(quarantineDir, { recursive: true });

      const storedPath = path.join(quarantineDir, `${String(batchId)}${extension}`);
      fs.renameSync(file.path, storedPath);

      const sourceFile = {
        storedPath,
        originalName,
        size,
        retainedAt: new Date(),
      };

      await db.collection('import_batches').updateOne(
        { _id: batchId },
        { $set: { sourceFile, updatedAt: sourceFile.retainedAt } }
      );

      logger.warn(
        `[IMPORT_LGPD] Arquivo de origem retido para revisao (batch ${batchId}): ${storedPath}`
      );

      return sourceFile;
    } catch (retainError) {
      logger.error(
        'Falha ao reter arquivo de origem da importacao (RNF011 AC#4):',
        retainError.message || retainError
      );
      return null;
    }
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
// #915: os leitores de quarentena recebem o conjunto de tipos legiveis, e
// quem monta esse conjunto (o controller) precisa dos nomes.
module.exports.QUARANTINE_BATCH_TYPES = QUARANTINE_BATCH_TYPES;

