/**
 * Script de Limpeza Completa do Projeto BioAdvanceD
 * Remove cache, arquivos temporários e código não utilizado
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  success: (msg) => console.log(`[✅] ${msg}`),
};

const rootDir = path.resolve(__dirname, '..');
const backendDir = path.join(rootDir, 'backend');

let totalSpaceFreed = 0;
let filesRemovedCount = 0;
let dirsRemovedCount = 0;

/**
 * Calcula tamanho de arquivo/diretório
 */
function getSize(targetPath) {
  try {
    const stats = fs.statSync(targetPath);
    if (stats.isFile()) {
      return stats.size;
    } else if (stats.isDirectory()) {
      let size = 0;
      const files = fs.readdirSync(targetPath);
      for (const file of files) {
        const filePath = path.join(targetPath, file);
        size += getSize(filePath);
      }
      return size;
    }
  } catch (error) {
    return 0;
  }
  return 0;
}

/**
 * Formata bytes
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Remove arquivo ou diretório
 */
function removePath(targetPath, description = '') {
  if (!fs.existsSync(targetPath)) {
    return;
  }

  try {
    const size = getSize(targetPath);
    const stats = fs.statSync(targetPath);

    if (stats.isDirectory()) {
      fs.rmSync(targetPath, { recursive: true, force: true });
      dirsRemovedCount++;
      logger.success(`Removido diretório: ${targetPath} (${formatBytes(size)}) ${description}`);
    } else {
      fs.unlinkSync(targetPath);
      filesRemovedCount++;
      logger.success(`Removido arquivo: ${targetPath} (${formatBytes(size)}) ${description}`);
    }

    totalSpaceFreed += size;
  } catch (error) {
    logger.error(`Erro ao remover ${targetPath}: ${error.message}`);
  }
}

/**
 * Limpa cache do npm
 */
function cleanNpmCache() {
  try {
    logger.info('Limpando cache do npm...');
    execSync('npm cache clean --force', { stdio: 'inherit' });
    logger.success('Cache do npm limpo');
  } catch (error) {
    logger.warn(`Erro ao limpar cache do npm: ${error.message}`);
  }
}

/**
 * Limpa arquivos de build
 */
function cleanBuildFiles() {
  logger.info('Limpando arquivos de build...');
  
  const buildDirs = [
    path.join(rootDir, 'dist'),
    path.join(rootDir, 'build'),
    path.join(backendDir, 'dist'),
    path.join(backendDir, 'build'),
  ];

  buildDirs.forEach(dir => removePath(dir, '(build)'));
}

/**
 * Limpa cache do Vite
 */
function cleanViteCache() {
  logger.info('Limpando cache do Vite...');
  removePath(path.join(rootDir, '.vite'), '(cache Vite)');
  removePath(path.join(rootDir, 'node_modules', '.vite'), '(cache Vite)');
}

/**
 * Limpa arquivos temporários
 */
function cleanTempFiles() {
  logger.info('Limpando arquivos temporários...');
  
  // Uploads temporários
  const tempUploads = path.join(backendDir, 'uploads', 'temp');
  if (fs.existsSync(tempUploads)) {
    const files = fs.readdirSync(tempUploads);
    files.forEach(file => {
      const filePath = path.join(tempUploads, file);
      removePath(filePath, '(temp)');
    });
  }

  // Arquivos .tmp e .temp
  function findTempFiles(dir) {
    if (!fs.existsSync(dir)) return;
    
    const items = fs.readdirSync(dir);
    items.forEach(item => {
      const itemPath = path.join(dir, item);
      try {
        const stats = fs.statSync(itemPath);
        if (stats.isDirectory() && !itemPath.includes('node_modules')) {
          findTempFiles(itemPath);
        } else if (stats.isFile() && (item.endsWith('.tmp') || item.endsWith('.temp'))) {
          removePath(itemPath, '(temp)');
        }
      } catch (error) {
        // Ignora erros de acesso
      }
    });
  }

  findTempFiles(rootDir);
}

/**
 * Limpa arquivos de log
 */
function cleanLogFiles() {
  logger.info('Limpando arquivos de log...');
  
  const logFiles = [
    path.join(rootDir, 'npm-debug.log'),
    path.join(rootDir, 'yarn-debug.log'),
    path.join(rootDir, 'yarn-error.log'),
    path.join(backendDir, 'npm-debug.log'),
    path.join(backendDir, 'yarn-debug.log'),
    path.join(backendDir, 'yarn-error.log'),
  ];

  logFiles.forEach(file => removePath(file, '(log)'));
}

/**
 * Limpa arquivos do sistema operacional
 */
function cleanOSFiles() {
  logger.info('Limpando arquivos do sistema operacional...');
  
  function findOSFiles(dir) {
    if (!fs.existsSync(dir)) return;
    
    const items = fs.readdirSync(dir);
    items.forEach(item => {
      const itemPath = path.join(dir, item);
      try {
        const stats = fs.statSync(itemPath);
        if (stats.isDirectory() && !itemPath.includes('node_modules')) {
          findOSFiles(itemPath);
        } else if (stats.isFile() && (item === '.DS_Store' || item === 'Thumbs.db')) {
          removePath(itemPath, '(OS)');
        }
      } catch (error) {
        // Ignora erros de acesso
      }
    });
  }

  findOSFiles(rootDir);
}

/**
 * Limpa documentação duplicada/antiga
 */
function cleanDocumentation() {
  logger.info('Analisando documentação...');
  
  const backendDocs = [
    'AUDITORIA_REDIS_WORKERS_FINAL.md',
    'CONFIGURACAO_REDIS_CLOUD.md',
    'CORRECAO_ALERTAS.md',
    'CORRECOES_REDIS_WORKER.md',
    'IMPLEMENTACAO_REDIS_PACOTE.md',
    'RESUMO_CORRECOES_REDIS.md',
  ];

  // Mantém apenas os mais importantes
  const keepDocs = [
    'README.md',
    'ESTRUTURA_PROJETO.md',
    'ROTAS_API.md',
    'SEED_DATABASE.md',
  ];

  backendDocs.forEach(doc => {
    const docPath = path.join(backendDir, doc);
    if (fs.existsSync(docPath) && !keepDocs.includes(doc)) {
      logger.warn(`Documentação duplicada encontrada: ${doc}`);
      // Não remove automaticamente, apenas avisa
    }
  });
}

/**
 * Verifica código não utilizado
 */
function checkUnusedCode() {
  logger.info('Verificando código não utilizado...');
  
  // redis-alternative.js - verifica se é usado
  const redisAlternative = path.join(backendDir, 'src', 'config', 'redis-alternative.js');
  if (fs.existsSync(redisAlternative)) {
    // Verifica se é importado em algum lugar
    const searchTerm = 'redis-alternative';
    let isUsed = false;
    
    function searchInFiles(dir) {
      if (!fs.existsSync(dir)) return;
      
      const items = fs.readdirSync(dir);
      items.forEach(item => {
        const itemPath = path.join(dir, item);
        try {
          const stats = fs.statSync(itemPath);
          if (stats.isDirectory() && !itemPath.includes('node_modules')) {
            searchInFiles(itemPath);
          } else if (stats.isFile() && (item.endsWith('.js') || item.endsWith('.ts'))) {
            const content = fs.readFileSync(itemPath, 'utf8');
            if (content.includes(searchTerm)) {
              isUsed = true;
            }
          }
        } catch (error) {
          // Ignora erros
        }
      });
    }

    searchInFiles(backendDir);
    
    if (!isUsed) {
      logger.warn(`Código não utilizado encontrado: redis-alternative.js`);
      logger.warn('  (Não removido automaticamente - revise manualmente)');
    }
  }
}

/**
 * Limpa cache do node_modules
 */
function cleanNodeModulesCache() {
  logger.info('Limpando cache dentro de node_modules...');
  
  const cacheDirs = [
    path.join(rootDir, 'node_modules', '.cache'),
    path.join(backendDir, 'node_modules', '.cache'),
  ];

  cacheDirs.forEach(dir => removePath(dir, '(cache)'));
}

/**
 * Limpa arquivos .env.local
 */
function cleanEnvLocal() {
  logger.info('Limpando arquivos .env.local...');
  
  const envFiles = [
    path.join(rootDir, '.env.local'),
    path.join(backendDir, '.env.local'),
  ];

  envFiles.forEach(file => {
    if (fs.existsSync(file)) {
      logger.warn(`Arquivo .env.local encontrado: ${file}`);
      logger.warn('  (Não removido automaticamente por segurança)');
    }
  });
}

/**
 * Função principal
 */
async function cleanup() {
  logger.info('🧹 INICIANDO LIMPEZA COMPLETA DO BIOADVANCED');
  logger.info('='.repeat(60));
  logger.info('');

  // Limpeza de cache
  cleanNpmCache();
  cleanViteCache();
  cleanNodeModulesCache();
  logger.info('');

  // Limpeza de build
  cleanBuildFiles();
  logger.info('');

  // Limpeza de temporários
  cleanTempFiles();
  logger.info('');

  // Limpeza de logs
  cleanLogFiles();
  logger.info('');

  // Limpeza de arquivos do sistema
  cleanOSFiles();
  logger.info('');

  // Análise de documentação
  cleanDocumentation();
  logger.info('');

  // Verificação de código não utilizado
  checkUnusedCode();
  logger.info('');

  // Verificação de .env.local
  cleanEnvLocal();
  logger.info('');

  // Resumo
  logger.info('='.repeat(60));
  logger.info('📊 RESUMO DA LIMPEZA');
  logger.info('='.repeat(60));
  logger.info(`✅ Arquivos removidos: ${filesRemovedCount}`);
  logger.info(`✅ Diretórios removidos: ${dirsRemovedCount}`);
  logger.info(`✅ Espaço liberado: ${formatBytes(totalSpaceFreed)}`);
  logger.info('');
  logger.info('💡 Dica: Execute "npm install" se necessário após a limpeza');
  logger.info('');
}

// Executa limpeza
cleanup().catch(error => {
  logger.error('Erro durante limpeza:', error);
  process.exit(1);
});

