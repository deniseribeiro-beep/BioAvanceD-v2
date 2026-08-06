const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const importLGPDService = require('../services/import-lgpd.service');
const logService = require('../services/log.service');
const logger = require('../utils/logger');
const { sanitizePatientForLogs } = require('../utils/patientAnonymization');
const { getCollection } = require('../utils/collectionResolver');
const {
  SPECIMEN_TYPES,
  SAMPLE_ORIGINS,
  EXTRACTION_PROTOCOLS,
  MIABIS_QUALITY,
} = require('../config/constants/specimen.constants');

// Configuração do multer para upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = path.join(__dirname, '../../uploads/temp');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const blockedExts = ['.exe', '.sh', '.bat'];

    if (blockedExts.includes(ext)) {
      const err = new Error('Formato de arquivo não seguro');
      err.status = 400;
      return cb(err, false);
    }

    const allowedMimes = [
      'text/csv',
      'text/plain',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/json',
      'application/zip',
      'application/x-zip-compressed'
    ];

    if (!allowedMimes.includes(file.mimetype)) {
      const err = new Error('Formato de arquivo não seguro');
      err.status = 400;
      return cb(err, false);
    }

    cb(null, true);
  },
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

/**
 * Controller de Importação LGPD
 * Implementa importação de pacientes e amostras via CSV/Excel
 * com total conformidade com anonimização LGPD
 */
class ImportLGPDController {
  async persistSmartImportSummary(db, payload) {
    const reportsCollection = db.collection('importSummaryReports');
    const document = {
      type: 'patients-smart-import',
      createdAt: new Date(),
      ...payload
    };
    const result = await reportsCollection.insertOne(document);
    return {
      ...document,
      _id: result.insertedId
    };
  }

  async listSmartImportReports(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const limitRaw = parseInt(String(req.query.limit || '20'), 10);
      const pageRaw = parseInt(String(req.query.page || '1'), 10);
      const limit = Number.isNaN(limitRaw) ? 20 : Math.min(Math.max(limitRaw, 1), 100);
      const page = Number.isNaN(pageRaw) ? 1 : Math.max(pageRaw, 1);
      const skip = (page - 1) * limit;

      const reportsCollection = db.collection('importSummaryReports');
      const filter = { type: 'patients-smart-import' };

      const [items, total] = await Promise.all([
        reportsCollection.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
        reportsCollection.countDocuments(filter)
      ]);

      return res.status(200).json({
        success: true,
        data: items,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(Math.ceil(total / limit), 1)
        }
      });
    } catch (error) {
      logger.error('Erro ao listar summary reports de importação inteligente:', error);
      return res.status(500).json({
        success: false,
        error: 'Erro ao listar summary reports',
        message: error.message || 'Erro desconhecido'
      });
    }
  }

  async getPatientsSmartImportMetadata(req, res) {
    try {
      const db = req.app.locals.db;
      const metadata = importLGPDService.getPatientsSmartImportMetadata();

      if (!db) {
        return res.status(200).json({
          success: true,
          data: {
            ...metadata,
            consentTemplates: {
              available: false,
              count: 0,
              items: []
            }
          }
        });
      }

      const consentTemplatesCollection = await getCollection(db, 'consentTemplates');
      const [count, items] = await Promise.all([
        consentTemplatesCollection.countDocuments({}),
        consentTemplatesCollection
          .find({}, { projection: { _id: 1, title: 1, version: 1, caae: 1, active: 1 } })
          .sort({ createdAt: -1, _id: -1 })
          .limit(20)
          .toArray()
      ]);

      return res.status(200).json({
        success: true,
        data: {
          ...metadata,
          consentTemplates: {
            available: count > 0,
            count,
            items: items.map((item) => ({
              _id: String(item._id),
              title: item.title || '',
              version: item.version || '',
              caae: item.caae || '--',
              active: Boolean(item.active)
            }))
          }
        }
      });
    } catch (error) {
      logger.error('Erro ao obter metadados de smart import de pacientes:', error);
      return res.status(500).json({
        success: false,
        error: 'Erro ao obter metadados de importação',
        message: error.message || 'Erro desconhecido'
      });
    }
  }

  /**
   * Middleware de upload
   */
  uploadMiddleware() {
    return upload.single('file');
  }

  /**
   * Importa pacientes via CSV/Excel
   * Gera IDs automaticamente conforme LGPD
   */
  async importPatients(req, res) {
    const db = req.app.locals.db;
    try {
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const file = req.file;

      if (!file) {
        return res.status(400).json({
          success: false,
          error: 'Arquivo não fornecido'
        });
      }

      // Valida formato
      if (!importLGPDService.validateFileFormat(file, 'patients')) {
        importLGPDService.cleanupFile(file.path);
        return res.status(400).json({
          success: false,
          error: 'Formato de arquivo inválido',
          message: 'Apenas arquivos CSV ou Excel (.xlsx) são aceitos'
        });
      }

      let groupFields = {};
      if (req.body?.groupFields) {
        try {
          groupFields = typeof req.body.groupFields === 'string'
            ? JSON.parse(req.body.groupFields)
            : req.body.groupFields;
        } catch (error) {
          importLGPDService.cleanupFile(file.path);
          return res.status(400).json({
            success: false,
            error: 'groupFields inválido',
            message: 'groupFields deve ser um JSON válido'
          });
        }
      }

      // Processa importação
      const results = await importLGPDService.importPatients(db, file, { groupFields });

      // Registra log sanitizado (anonimizado via auditLogger)
      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.logImport(
          req, 
          'Patient', 
          results.errors.length === 0 ? 'success' : 'partial',
          results.total, 
          results.success, 
          results.errors.length
        );
      }

      // Limpa arquivo temporário
      importLGPDService.cleanupFile(file.path);

      // Determina mensagem baseada no resultado
      let message = 'Importação concluída';
      if (results.errors.length === 0) {
        message = `Importação concluída com sucesso! ${results.success} paciente(s) cadastrado(s) no sistema.`;
      } else if (results.success > 0) {
        message = `Importação parcialmente concluída: ${results.success} paciente(s) importado(s) com sucesso. ${results.errors.length} registro(s) apresentaram erro(s) e não foram importados.`;
      } else {
        message = `Importação não realizada: ${results.errors.length} erro(s) encontrado(s). Nenhum paciente foi cadastrado. Verifique os detalhes dos erros para corrigir o arquivo.`;
      }

      return res.status(200).json({
        success: results.errors.length === 0,
        message: message,
        data: {
          total: results.total,
          success: results.success,
          errors: results.errors.length,
          errorsDetails: results.errors.map(err => ({
            row: err.row,
            errors: Array.isArray(err.errors) ? err.errors : [err.errors]
            // NÃO inclui dados sensíveis
          }))
        }
      });

    } catch (error) {
      logger.error('Erro ao importar pacientes:', error);
      logger.error('Rastreamento:', error.stack);
      
      // Registra log de erro (anonimizado via auditLogger)
      if (req.user) {
        try {
          const auditLogger = require('../utils/auditLogger');
          auditLogger.init(db);
          await auditLogger.logError(
            req,
            'Patient',
            error,
            { action: 'IMPORT', fileName: req.file?.originalname || 'N/A' }
          );
        } catch (logError) {
          logger.error('Erro ao registrar log de auditoria:', logError);
        }
      }
      
      // Limpa arquivo em caso de erro
      if (req.file) {
        importLGPDService.cleanupFile(req.file.path);
      }

      // Retorna mensagem de erro mais detalhada
      const errorMessage = error.message || 'Erro desconhecido ao importar pacientes';
      
      return res.status(500).json({
        success: false,
        error: 'Erro ao importar pacientes',
        message: errorMessage
      });
    }
  }

  async importPatientsSmart(req, res) {
    const db = req.app.locals.db;
    try {
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const file = req.file;
      if (!file) {
        return res.status(400).json({ success: false, error: 'Arquivo não fornecido' });
      }

      if (!importLGPDService.validateFileFormat(file, 'patients')) {
        importLGPDService.cleanupFile(file.path);
        return res.status(400).json({
          success: false,
          error: 'Formato de arquivo inválido',
          message: 'Apenas CSV, TXT ou Excel (.xlsx) são aceitos'
        });
      }

      let groupFields = {};
      if (req.body?.groupFields) {
        groupFields = typeof req.body.groupFields === 'string' ? JSON.parse(req.body.groupFields) : req.body.groupFields;
      }

      let mapping = {};
      if (req.body?.mapping) {
        mapping = typeof req.body.mapping === 'string' ? JSON.parse(req.body.mapping) : req.body.mapping;
      }

      const fileBuffer = fs.readFileSync(file.path);
      const fileHashSHA256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'SMART_IMPORT_EXECUTION',
          resourceType: 'Import',
          resourceId: file.originalname || null,
          status: 'success',
          severity: 'info',
          module: 'Importação',
          message: 'Execução de importação inteligente iniciada.',
          payload: {
            stage: 'start',
            fileName: file.originalname,
            fileHashSHA256,
            hasCustomMapping: Object.keys(mapping || {}).length > 0,
            hasGroupFields: Object.keys(groupFields || {}).length > 0,
          },
          req,
        });
      }

      const results = await importLGPDService.importPatientsSmart(db, file, { mapping, groupFields });

      const summaryReport = {
        processedAt: new Date().toISOString(),
        totalProcessado: results.total,
        totalFalhas: results.errors.length,
        hashSHA256ArquivoOriginal: fileHashSHA256
      };

      const persistedSummaryReport = await this.persistSmartImportSummary(db, {
        summaryReport,
        fileName: file.originalname,
        userId: req.user?.id || req.user?._id || null,
        userName: req.user?.name || req.user?.username || null,
        totalSucesso: results.success,
        totalFalhas: results.errors.length,
        errorsDetails: (Array.isArray(results.errors) ? results.errors : []).slice(0, 200)
      });

      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'SMART_IMPORT_EXECUTION',
          resourceType: 'Import',
          resourceId: file.originalname || null,
          status: results.errors.length === 0 ? 'success' : 'warning',
          severity: results.errors.length === 0 ? 'info' : 'warning',
          module: 'Importação',
          message: results.errors.length === 0
            ? 'Execução de importação inteligente concluída com sucesso.'
            : 'Execução de importação inteligente concluída com inconsistências.',
          payload: {
            stage: 'finish',
            fileName: file.originalname,
            fileHashSHA256,
            total: results.total,
            success: results.success,
            failures: results.errors.length,
            summaryReportId: String(persistedSummaryReport._id),
          },
          req,
        });
        await auditLogger.logImport(
          req,
          'Patient',
          results.errors.length === 0 ? 'success' : 'partial',
          results.total,
          results.success,
          results.errors.length
        );
      }

      importLGPDService.cleanupFile(file.path);

      return res.status(200).json({
        success: results.errors.length === 0,
        message: 'Importação em lote concluída',
        data: {
          total: results.total,
          success: results.success,
          errors: results.errors.length,
          errorsDetails: results.errors,
          summaryReport,
          summaryReportId: String(persistedSummaryReport._id)
        }
      });
    } catch (error) {
      logger.error('Erro ao executar importação inteligente de pacientes:', error);

      if (db && req.user) {
        try {
          const auditLogger = require('../utils/auditLogger');
          auditLogger.init(db);
          await auditLogger.log({
            action: 'SMART_IMPORT_EXECUTION',
            resourceType: 'Import',
            resourceId: req.file?.originalname || null,
            status: 'error',
            severity: 'error',
            module: 'Importação',
            message: 'Falha na execução de importação inteligente.',
            payload: {
              stage: 'failure',
              fileName: req.file?.originalname || null,
              error: error.message || 'Erro desconhecido',
            },
            error,
            req,
          });
        } catch (_) {
          // Não interrompe resposta da API se auditoria falhar.
        }
      }

      if (req.file) {
        importLGPDService.cleanupFile(req.file.path);
      }
      return res.status(500).json({
        success: false,
        error: 'Erro ao importar pacientes em lote',
        message: error.message || 'Erro desconhecido'
      });
    }
  }

  /**
   * Importa amostras via CSV/Excel
   * Valida IDs de pacientes sem expor dados sensíveis
   */
  async importSamples(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const file = req.file;

      if (!file) {
        return res.status(400).json({
          success: false,
          error: 'Arquivo não fornecido'
        });
      }

      // Valida formato
      if (!importLGPDService.validateFileFormat(file, 'samples')) {
        importLGPDService.cleanupFile(file.path);
        return res.status(400).json({
          success: false,
          error: 'Formato de arquivo inválido',
          message: 'Apenas arquivos CSV ou Excel (.xlsx) são aceitos'
        });
      }

      // Obtém parâmetros de localização e auto-incremento do FormData
      // #459: boxId (StorageBox _id) replaces the legacy numeric locationID
      const startBoxId = req.body.boxId || null;
      const autoIncrement = req.body.autoIncrement === 'true' || req.body.autoIncrement === true || req.body.autoIncrement === '1';

      let groupFields = {};
      if (req.body?.groupFields) {
        try {
          groupFields = typeof req.body.groupFields === 'string'
            ? JSON.parse(req.body.groupFields)
            : req.body.groupFields;
        } catch (error) {
          importLGPDService.cleanupFile(file.path);
          return res.status(400).json({
            success: false,
            error: 'groupFields inválido',
            message: 'groupFields deve ser um JSON válido'
          });
        }
      }
      
      logger.debug('Parâmetros de importação:', { startBoxId, autoIncrement });

      // Processa importação
      const results = await importLGPDService.importSamples(db, file, {
        startBoxId,
        autoIncrement,
        groupFields
      });

      // Registra log sanitizado (anonimizado via auditLogger)
      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.logImport(
          req, 
          'Sample', 
          results.errors.length === 0 ? 'success' : 'partial',
          results.total, 
          results.success, 
          results.errors.length
        );
      }

      // Limpa arquivo temporário
      importLGPDService.cleanupFile(file.path);

      return res.status(200).json({
        success: results.errors.length === 0,
        message: 'Importação concluída',
        data: {
          total: results.total,
          success: results.success,
          errors: results.errors.length,
          errorsDetails: results.errors.map(err => ({
            row: err.row,
            errors: err.errors,
            participantId: err.data?.participantId || null // Apenas ID, sem dados sensíveis
          }))
        }
      });

    } catch (error) {
      logger.error('Erro ao importar amostras:', error.message);
      
      // Limpa arquivo em caso de erro
      if (req.file) {
        importLGPDService.cleanupFile(req.file.path);
      }

      return res.status(500).json({
        success: false,
        error: 'Erro ao importar amostras',
        message: error.message
      });
    }
  }

  /**
   * Gera template CSV para pacientes
   */

  /**
   * Gera template Excel para pacientes com instruções completas
   */
  async downloadPatientTemplateExcel(req, res) {
    try {
      const workbook = new ExcelJS.Workbook();
      
      // ========== ABA DE INSTRUÇÕES ==========
      const instructionsData = [
        ['INSTRUÇÕES PARA PREENCHIMENTO DO TEMPLATE DE PACIENTES'],
        [],
        ['IMPORTANTE:'],
        ['• O ID do paciente (participantId) será gerado automaticamente pelo sistema - NÃO preencha esta coluna'],
        ['• O TCLE (consentTemplateId) é obrigatório e deve ser selecionado no modal de importação em lote'],
        ['• Campos marcados com (*) são OBRIGATÓRIOS'],
        ['• Campos não marcados são OPCIONAIS'],
        ['• Mantenha o formato das colunas conforme especificado abaixo'],
        [],
        ['CAMPOS OBRIGATÓRIOS (*):'],
        ['• patientName: Nome completo do paciente (Texto)'],
        ['• email: Email válido para envio do TCLE (Texto)'],
        ['• birthDate: Data de nascimento no formato DD/MM/YYYY (Ex: 15/03/1985)'],
        ['• sex: Sexo do paciente - use M (Masculino), F (Feminino) ou O (Outro)'],
        [],
        ['FORMATOS E TIPOS DE DADOS:'],
        ['• patientName: Texto (obrigatório)'],
        ['• email: Texto no formato email válido (obrigatório)'],
        ['• phone: Telefone com 10 a 15 dígitos (opcional)'],
        ['• birthDate: Data no formato DD/MM/YYYY (obrigatório) - Ex: 15/03/1985'],
        ['• sex: M, F ou O (obrigatório) - Aceita também "Masculino" ou "Feminino"'],
        ['• weight: Número decimal (opcional) - Peso em quilos - Ex: 65.5'],
        ['• heightCm: Número decimal (opcional) - Altura em centímetros - Ex: 165'],
        ['• recordNumber: Número ou texto (opcional) - Número do prontuário'],
        ['• clinicalUnit: Texto (opcional) - Nome da unidade clínica'],
        ['• unitAcronym: Texto (opcional) - Sigla da unidade (gerada automaticamente se não informada)'],
        ['• diagnosticHypothesis: Texto (opcional) - Hipótese diagnóstica'],
        ['• icdCode: Texto (opcional) - Código CID (Classificação Internacional de Doenças)'],
        ['• hypertension: Sim/Não ou true/false (opcional) - Hipertensão'],
        ['• obesity: Sim/Não ou true/false (opcional) - Obesidade'],
        ['• diabetesType1: Sim/Não ou true/false (opcional) - Diabetes Tipo 1'],
        ['• diabetesType2: Sim/Não ou true/false (opcional) - Diabetes Tipo 2'],
        ['• copd: Sim/Não ou true/false (opcional) - Doença Pulmonar Obstrutiva Crônica'],
        ['• ckd: Sim/Não ou true/false (opcional) - Doença Renal Crônica'],
        ['• smoking: Sim/Não ou true/false (opcional) - Tabagismo'],
        ['• alcoholUse: Sim/Não ou true/false (opcional) - Uso de álcool'],
        ['• asthma: Sim/Não ou true/false (opcional) - Asma'],
        ['• antibioticUse: Sim/Não ou true/false (opcional) - Uso de antibióticos'],
        ['• insulinUse: Sim/Não ou true/false (opcional) - Uso de insulina'],
        ['• antiviralUse: Sim/Não ou true/false (opcional) - Uso de antivirais'],
        ['• geneticVariant: Texto (opcional) - Variante genética identificada'],
          ['• notes: Texto (opcional) - Observações adicionais'],
        [],
        ['VALORES ACEITOS PARA CAMPOS BOOLEANOS:'],
        ['• true, false (recomendado)'],
        ['• Sim, Não'],
        ['• sim, não'],
        ['• S, N'],
        ['• 1, 0'],
        [],
        ['VALORES ACEITOS PARA SEXO:'],
        ['• M ou Masculino (Masculino)'],
        ['• F ou Feminino (Feminino)'],
        ['• O (Outro)'],
        [],
        ['EXEMPLO DE PREENCHIMENTO:'],
        ['patientName: João Silva Santos'],
        ['birthDate: 15/03/1985'],
        ['sex: M'],
        ['weight: 75.5'],
        ['heightCm: 175'],
        ['recordNumber: 2024001'],
        ['clinicalUnit: Hospital Universitário'],
        ['hypertension: Sim'],
        ['diabetesType2: Não'],
        [],
        ['OBSERVAÇÕES IMPORTANTES:'],
        ['• Não inclua a coluna participantId - ela será gerada automaticamente'],
        ['• Mantenha os nomes das colunas exatamente como aparecem no template'],
        ['• Não deixe linhas vazias entre os registros'],
        ['• Certifique-se de que as datas estão no formato DD/MM/YYYY'],
        ['• Valores numéricos devem usar ponto (.) como separador decimal'],
        ['• O sistema validará todos os dados antes de importar'],
      ];
      
      const instructionsSheet = workbook.addWorksheet('Instruções');
      instructionsData.forEach((row) => instructionsSheet.addRow(row));
      instructionsSheet.getColumn(1).width = 80;
      
      // ========== ABA DE DADOS (TEMPLATE) ==========
      // Headers limpos (sem asteriscos ou descrições - serão usados para importação)
      const headers = [
        'patientName',
        'email',
        'phone',
        'birthDate',
        'sex',
        'weight',
        'heightCm',
        'recordNumber',
        'clinicalUnit',
        'unitAcronym',
        'diagnosticHypothesis',
        'icdCode',
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
        'notes'
      ];
      
      // Linha de exemplo (primeira linha de dados) - ordem deve corresponder exatamente aos headers
      const exampleRow = [
        'João Silva Santos',        // patientName
        'joao.silva@email.com',     // email
        '5511999999999',            // phone
        '15/03/1985',               // birthDate
        'M',                         // sex
        '75.5',                      // weight
        '175',                       // heightCm
        '2024001',                   // recordNumber
        'Hospital Universitário São Francisco de Assis', // clinicalUnit
        'HUSF',                      // unitAcronym
          'Doença lisossômica',        // diagnosticHypothesis
        'E75.21',                    // icdCode
        'false',                     // hypertension (boolean)
        'false',                     // obesity (boolean)
        'false',                     // diabetesType1 (boolean)
        'true',                      // diabetesType2 (boolean)
        'false',                     // copd (boolean)
        'false',                     // ckd (boolean)
        'false',                     // smoking (boolean)
        'false',                     // alcoholUse (boolean)
        'false',                     // asthma (boolean)
        'false',                     // antibioticUse (boolean)
        'true',                      // insulinUse (boolean)
        'false',                     // antiviralUse (boolean)
        'GLA337T>C, p.Ala143Thr',    // geneticVariant
        'Paciente em acompanhamento regular' // notes
      ];
      
      // Cria planilha apenas com headers limpos e exemplo
      const dataSheet = workbook.addWorksheet('Pacientes');
      dataSheet.addRow(headers);
      dataSheet.addRow(exampleRow);
      
      // Ajusta largura das colunas
      const colWidths = headers.map((header, idx) => {
        const maxLength = Math.max(
          header.length,
          exampleRow[idx]?.toString().length || 0,
          15
        );
        return { wch: Math.min(maxLength + 2, 40) };
      });
      dataSheet.columns = colWidths.map((col) => ({ width: col.wch }));
      dataSheet.views = [{ state: 'frozen', ySplit: 1 }];

      const buffer = await workbook.xlsx.writeBuffer();

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="pacientes_template.xlsx"');
      res.send(Buffer.from(buffer));

    } catch (error) {
      logger.error('Erro ao gerar template Excel de pacientes:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao gerar template',
        message: error.message
      });
    }
  }

  /**
   * Gera template CSV para amostras
   */
  async downloadSampleTemplateCSV(req, res) {
    try {
      const { stringify } = require('csv-stringify/sync');
      const db = req.app.locals.db;
      
      // Busca valores do banco de dados
      let sampleTypes = [];
      let sampleOrigins = [];
      let extractionProtocols = [];
      
      if (db) {
        try {
          const sampleTypesCollection = db.collection('sampleTypes');
          sampleTypes = await sampleTypesCollection.find({}).toArray();
          
          const sampleOriginsCollection = db.collection('sampleOrigins');
          sampleOrigins = await sampleOriginsCollection.find({}).toArray();
          
          const extractionProtocolsCollection = db.collection('extractionProtocols');
          extractionProtocols = await extractionProtocolsCollection.find({}).toArray();
        } catch (err) {
          logger.warn('Erro ao buscar valores do banco para template:', err.message);
        }
      }
      
      // Headers do template (incluindo participantId obrigatório)
      // quality usa ids MIABIS canônicos
      // locationID e barcode são opcionais - barcode será gerado automaticamente se não fornecido
      const headers = [
        'participantId',
        'sampleType',
        'sampleOrigin',
        'extractionProtocol',
        'barcode', // opcional - gerado automaticamente se vazio
        'registeredAt',
        'quantity',
        'quality', // MIABIS: GOOD, COMPROMISED ou UNKNOWN
        'locationID', // opcional - pode ser selecionado após upload
        'linkedProject',
        'specimenStatus'
      ];

      // Linha de exemplo com valores do banco ou padrão
      const exampleRow = [
        '12345678',
        sampleTypes.length > 0 ? sampleTypes[0].description : SPECIMEN_TYPES[0].id,
        sampleOrigins.length > 0 ? sampleOrigins[0].id || sampleOrigins[0].description : SAMPLE_ORIGINS[0].id,
        extractionProtocols.length > 0 ? extractionProtocols[0].id || extractionProtocols[0].description : EXTRACTION_PROTOCOLS[0].id,
        '', // barcode deixado vazio (opcional - será gerado automaticamente)
        new Date().toISOString().slice(0, 10), // ISO YYYY-MM-DD
        '500.5',
        '1',
        '', // locationID deixado vazio (opcional - pode ser selecionado após upload)
        'Projeto Genoma',
        'available'
      ];

      // Adiciona comentários com valores válidos
      const comments = [];
      comments.push('# Instruções: participantId obrigatório (8 dígitos); barcode e locationID são opcionais; quality usa GOOD, COMPROMISED ou UNKNOWN; registeredAt no formato YYYY-MM-DD');
      if (sampleTypes.length > 0) {
        comments.push(`# Valores válidos para sampleType: ${sampleTypes.map(t => t.id || t.description).join(', ')}`);
      }
      if (sampleOrigins.length > 0) {
        comments.push(`# Valores válidos para sampleOrigin: ${sampleOrigins.map(o => o.id || o.description).join(', ')}`);
      }
      if (extractionProtocols.length > 0) {
        comments.push(`# Valores válidos para extractionProtocol: ${extractionProtocols.map(p => p.id || p.description).join(', ')}`);
      }

      // CSV deve começar em linha 1 com cabeçalhos (sem comentários antes)
      const rows = [
        headers,
        exampleRow
      ];
      
      const csvContent = '\uFEFF' + stringify(rows); // BOM para compatibilidade Excel

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="amostras_template.csv"');
      res.send(csvContent);

    } catch (error) {
      logger.error('Erro ao gerar template CSV de amostras:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao gerar template',
        message: error.message
      });
    }
  }

  /**
   * Gera template Excel para amostras (RF004)
   */
  async downloadSampleTemplateExcel(req, res) {
    try {
      const db = req.app.locals.db;
      
      // Busca valores do banco de dados (com fallback para valores padrão)
      let sampleTypes = [];
      let sampleOrigins = [];
      let extractionProtocols = [];
      
      if (db) {
        try {
          const sampleTypesCollection = db.collection('sampleTypes');
          sampleTypes = await sampleTypesCollection.find({}).toArray();
        } catch (err) {
          logger.warn('Erro ao buscar sampleTypes do banco para template Excel:', err.message);
          sampleTypes = [];
        }
        
        try {
          const sampleOriginsCollection = db.collection('sampleOrigins');
          sampleOrigins = await sampleOriginsCollection.find({}).toArray();
        } catch (err) {
          logger.warn('Erro ao buscar sampleOrigins do banco para template Excel:', err.message);
          sampleOrigins = [];
        }
        
        try {
          const extractionProtocolsCollection = db.collection('extractionProtocols');
          extractionProtocols = await extractionProtocolsCollection.find({}).toArray();
        } catch (err) {
          logger.warn('Erro ao buscar extractionProtocols do banco para template Excel:', err.message);
          extractionProtocols = [];
        }
      } else {
        logger.warn('Banco de dados não disponível, usando valores padrão para template Excel');
      }
      
      const workbook = new ExcelJS.Workbook();
      
      // ========== ABA DE INSTRUÇÕES ==========
      const instructionsData = [
        ['INSTRUÇÕES PARA PREENCHIMENTO DO TEMPLATE DE AMOSTRAS (RF004)'],
        [],
        ['IMPORTANTE:'],
        ['• A maioria dos campos são OBRIGATÓRIOS, exceto locationID e barcode que são OPCIONAIS'],
        ['• O participantId deve ser um ID anonimizado de 8 dígitos numéricos (ex: 12345678)'],
        ['• O participantId deve existir no sistema (cadastrado previamente)'],
        ['• Mantenha o formato das colunas conforme especificado abaixo'],
        ['• O barcode é OPCIONAL - será gerado automaticamente se não fornecido'],
        ['• Se fornecido, o barcode deve ser único (não pode estar duplicado)'],
        ['• locationID é OPCIONAL - se não fornecido, você poderá selecionar após o upload'],
        [],
        ['CAMPOS OBRIGATÓRIOS:'],
        ['• participantId: ID anonimizado de 8 dígitos do paciente (Texto) - Ex: 12345678'],
        ['• sampleType: Tipo de amostra conforme MIABIS (id canônico)'],
        ['• sampleOrigin: Origem da amostra conforme MIABIS (id canônico)'],
        ['• extractionProtocol: Protocolo de extração conforme MIABIS (id canônico)'],
        ['• registeredAt: Data de registro no formato DD/MM/YYYY ou YYYY-MM-DD (Data)'],
        ['• quantity: Quantidade em microlitros (µL) - Número decimal maior que zero'],
        ['• quality: Qualidade conforme MIABIS (GOOD, COMPROMISED ou UNKNOWN)'],
        ['• linkedProject: Nome do projeto vinculado (Texto)'],
        ['• specimenStatus: Estado operacional atual - available, reserved, checked_out, partial, depleted, quarantined, destroyed, unavailable ou disposed'],
        [],
        ['CAMPOS OPCIONAIS:'],
        ['• barcode: Código de barras único (Texto) - OPCIONAL. Se não fornecido, será gerado automaticamente no formato BR-YYYY-NNN'],
        ['• locationID: ID da localização (Número inteiro) - OPCIONAL. Se não fornecido, pode ser selecionado após o upload do arquivo'],
        [],
        ['VALORES ACEITOS PARA sampleType (MIABIS):'],
        ['• Sangue'],
        ['• Urina'],
        ['• Saliva'],
        ['• Tecido'],
        ['• DNA'],
        ['• RNA'],
        ['• Plasma'],
        ['• Soro'],
        ['• Líquido Cefalorraquidiano'],
        [],
        ['VALORES ACEITOS PARA sampleOrigin (MIABIS):'],
        ['• VENOUS_BLOOD'],
        ['• CAPILLARY_BLOOD'],
        ['• ORAL_MUCOSA'],
        ['• URINE_MIDSTREAM'],
        [],
        ['VALORES ACEITOS PARA extractionProtocol (MIABIS):'],
        ['• TUBE_EDTA'],
        ['• TUBE_HEPARIN'],
        ['• TUBE_SERUM'],
        ['• FILTER_PAPER'],
        [],
        ['VALORES ACEITOS PARA quality (MIABIS):'],
        ['• GOOD - Adequada / Boa Qualidade'],
        ['• COMPROMISED - Comprometida (Hemólise/Lipemia)'],
        ['• UNKNOWN - Desconhecida / Não Avaliada'],
        ['• IMPORTANTE: Apenas os ids canônicos são aceitos'],
        [],
        ['VALORES ACEITOS PARA specimenStatus:'],
        ['• available (Disponível)'],
        ['• reserved (Reservada)'],
        ['• checked_out (Retirada)'],
        ['• partial (Parcial)'],
        ['• depleted (Esgotada)'],
        ['• quarantined (Em quarentena)'],
        ['• destroyed (Destruída)'],
        ['• unavailable (Indisponível)'],
        ['• disposed (Descartada)'],
        [],
        ['EXEMPLO DE PREENCHIMENTO:'],
        ['participantId: 12345678'],
        ['sampleType: PLASMA'],
        ['sampleOrigin: VENOUS_BLOOD'],
        ['extractionProtocol: TUBE_EDTA'],
        ['barcode: BR-2024-001'],
        ['registeredAt: 15/03/2024'],
        ['quantity: 500.5'],
        ['quality: GOOD'],
        ['locationID: (deixe vazio para selecionar após upload)'],
        ['linkedProject: Projeto Genoma'],
        ['specimenStatus: available'],
        [],
        ['OBSERVAÇÕES IMPORTANTES:'],
        ['• O participantId deve ter exatamente 8 dígitos numéricos'],
        ['• O participantId deve existir no sistema (cadastrado previamente)'],
        ['• O barcode é OPCIONAL - se não fornecido, será gerado automaticamente no formato BR-YYYY-NNN'],
        ['• Se você fornecer um barcode, ele deve ser único (não pode estar duplicado)'],
        ['• A quantidade deve ser maior que zero'],
        ['• A data pode estar no formato DD/MM/YYYY ou YYYY-MM-DD'],
        ['• O locationID é OPCIONAL - se não fornecido, você poderá selecionar após o upload'],
        ['• Se locationID não for fornecido, será necessário selecionar uma localização inicial após o upload'],
        ['• O sistema validará todos os dados antes de importar'],
        ['• O sistema verificará duplicidade por barcode (apenas se fornecido)'],
        ['• Nenhum dado pessoal do paciente será exposto (LGPD)'],
      ];
      
      const instructionsSheet = workbook.addWorksheet('Instruções');
      instructionsData.forEach((row) => instructionsSheet.addRow(row));
      instructionsSheet.getColumn(1).width = 80;
      
      // ========== ABA DE DADOS (TEMPLATE) ==========
      // Headers conforme RF004
      // quality usa ids MIABIS canônicos
      // barcode é opcional - será gerado automaticamente se não fornecido
      const headers = [
        'participantId',
        'sampleType',
        'sampleOrigin',
        'extractionProtocol',
        'barcode (opcional - será gerado automaticamente se não fornecido)',
        'registeredAt',
        'quantity',
        'quality (MIABIS GOOD, COMPROMISED ou UNKNOWN)',
        'locationID (opcional - pode ser selecionado após upload)',
        'linkedProject',
        'specimenStatus'
      ];
      
      // Linha de exemplo (primeira linha de dados) - usa valores do banco
      const exampleRow = [
        '12345678',              // participantId (8 dígitos)
        (sampleTypes.length > 0 && (sampleTypes[0]?.id || sampleTypes[0]?.description)) ? (sampleTypes[0].id || sampleTypes[0].description) : SPECIMEN_TYPES[0].id,                // sampleType
        (sampleOrigins.length > 0 && (sampleOrigins[0]?.id || sampleOrigins[0]?.description)) ? (sampleOrigins[0].id || sampleOrigins[0].description) : SAMPLE_ORIGINS[0].id,                // sampleOrigin
        (extractionProtocols.length > 0 && (extractionProtocols[0]?.id || extractionProtocols[0]?.description)) ? (extractionProtocols[0].id || extractionProtocols[0].description) : EXTRACTION_PROTOCOLS[0].id,                // extractionProtocol
        '',                      // barcode (opcional - deixado vazio para demonstrar geração automática)
        new Date().toLocaleDateString('pt-BR'),            // registeredAt
        '500.5',                 // quantity (µL)
        MIABIS_QUALITY[0].id,                     // quality (ID)
        '',                      // locationID (opcional - deixado vazio no exemplo)
        'Projeto Genoma',        // linkedProject
        'available'              // specimenStatus
      ];
      
      // Cria planilha apenas com headers e exemplo
      const dataSheet = workbook.addWorksheet('Amostras');
      dataSheet.addRow(headers);
      dataSheet.addRow(exampleRow);
      
      // Cria aba de referência com valores válidos
      if (sampleTypes.length > 0 || sampleOrigins.length > 0 || extractionProtocols.length > 0) {
        const referenceData = [];
        referenceData.push(['REFERÊNCIA DE VALORES VÁLIDOS']);
        referenceData.push([]);
        
        if (sampleTypes.length > 0) {
          referenceData.push(['Tipo de Amostra (sampleType):']);
          referenceData.push(['Id']);
          sampleTypes.forEach(type => {
            referenceData.push([type?.id || type?.description || type?.name || 'N/A']);
          });
          referenceData.push([]);
        }
        
        if (sampleOrigins.length > 0) {
          referenceData.push(['Origem (sampleOrigin):']);
          referenceData.push(['Id']);
          sampleOrigins.forEach(origin => {
            referenceData.push([origin?.id || origin?.description || origin?.name || 'N/A']);
          });
          referenceData.push([]);
        }
        
        if (extractionProtocols.length > 0) {
          referenceData.push(['Protocolo de Extração (extractionProtocol):']);
          referenceData.push(['Id']);
          extractionProtocols.forEach(protocol => {
            referenceData.push([protocol?.id || protocol?.description || protocol?.name || 'N/A']);
          });
        }
        
        const referenceSheet = workbook.addWorksheet('Valores Válidos');
        referenceData.forEach((row) => referenceSheet.addRow(row));
        referenceSheet.getColumn(1).width = 50;
      }
      
      // Ajusta largura das colunas
      const colWidths = headers.map((header, idx) => {
        const maxLength = Math.max(
          header.length,
          exampleRow[idx]?.toString().length || 0,
          15
        );
        return { wch: Math.min(maxLength + 2, 40) };
      });
      dataSheet.columns = colWidths.map((col) => ({ width: col.wch }));
      dataSheet.views = [{ state: 'frozen', ySplit: 1 }];

      const buffer = await workbook.xlsx.writeBuffer();

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="amostras_template.xlsx"');
      res.send(Buffer.from(buffer));

    } catch (error) {
      logger.error('Erro ao gerar template Excel de amostras:', error);
      if (error.stack) {
        logger.error('Rastreamento:', error.stack);
      }
      return res.status(500).json({
        success: false,
        error: 'Erro ao gerar template',
        message: error.message || 'Erro desconhecido ao gerar template Excel'
      });
    }
  }
}

module.exports = new ImportLGPDController();

