#!/usr/bin/env node

/**
 * Script de Limpeza e Auditoria do BioAdvanceD
 * Remove arquivos desnecessários, cache e dados temporários
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function getSize(path) {
  try {
    const stats = fs.statSync(path);
    return stats.isDirectory() ? getDirSize(path) : stats.size;
  } catch {
    return 0;
  }
}

function getDirSize(dirPath) {
  let size = 0;
  try {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      try {
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
          size += getDirSize(filePath);
        } else {
          size += stats.size;
        }
      } catch {
        // Ignora erros de acesso
      }
    }
  } catch {
    // Ignora erros
  }
  return size;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function deleteFileOrDir(filePath) {
  try {
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      fs.rmSync(filePath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(filePath);
    }
    return true;
  } catch (error) {
    return false;
  }
}

class CleanupAuditor {
  constructor() {
    this.rootDir = path.resolve(__dirname, '..');
    this.backendDir = path.join(this.rootDir, 'backend');
    this.frontendDir = this.rootDir;
    this.stats = {
      filesDeleted: 0,
      dirsDeleted: 0,
      spaceFreed: 0,
      errors: [],
    };
  }

  // 1. Limpar arquivos temporários de upload
  cleanUploadTemp() {
    log('\n📁 Limpando arquivos temporários de upload...', 'cyan');
    const tempDir = path.join(this.backendDir, 'uploads', 'temp');
    
    if (!fs.existsSync(tempDir)) {
      log('  ⚠️  Diretório temp não existe', 'yellow');
      return;
    }

    try {
      const files = fs.readdirSync(tempDir);
      let deleted = 0;
      let space = 0;

      for (const file of files) {
        if (file === '.gitkeep') continue;
        
        const filePath = path.join(tempDir, file);
        const size = getSize(filePath);
        
        if (deleteFileOrDir(filePath)) {
          deleted++;
          space += size;
          log(`  ✅ Removido: ${file} (${formatBytes(size)})`, 'green');
        }
      }

      if (deleted === 0) {
        log('  ✅ Nenhum arquivo temporário encontrado', 'green');
      } else {
        this.stats.filesDeleted += deleted;
        this.stats.spaceFreed += space;
        log(`  ✅ ${deleted} arquivo(s) removido(s), ${formatBytes(space)} liberado(s)`, 'green');
      }
    } catch (error) {
      log(`  ❌ Erro ao limpar temp: ${error.message}`, 'red');
      this.stats.errors.push(`temp: ${error.message}`);
    }
  }

  // 2. Limpar cache do npm
  cleanNpmCache() {
    log('\n📦 Limpando cache do npm...', 'cyan');
    try {
      const cacheDir = path.join(process.env.APPDATA || process.env.HOME, '.npm');
      if (fs.existsSync(cacheDir)) {
        const size = getDirSize(cacheDir);
        log(`  ℹ️  Cache npm encontrado: ${formatBytes(size)}`, 'blue');
        log('  💡 Execute manualmente: npm cache clean --force', 'yellow');
      }
    } catch (error) {
      log(`  ⚠️  Não foi possível verificar cache npm: ${error.message}`, 'yellow');
    }
  }

  // 3. Limpar arquivos de build
  cleanBuildFiles() {
    log('\n🏗️  Limpando arquivos de build...', 'cyan');
    const buildDirs = [
      path.join(this.frontendDir, 'dist'),
      path.join(this.frontendDir, 'dist-ssr'),
      path.join(this.backendDir, 'build'),
    ];

    for (const buildDir of buildDirs) {
      if (fs.existsSync(buildDir)) {
        const size = getDirSize(buildDir);
        if (deleteFileOrDir(buildDir)) {
          this.stats.dirsDeleted++;
          this.stats.spaceFreed += size;
          log(`  ✅ Removido: ${path.basename(buildDir)} (${formatBytes(size)})`, 'green');
        } else {
          log(`  ❌ Erro ao remover: ${buildDir}`, 'red');
          this.stats.errors.push(`build: ${buildDir}`);
        }
      }
    }
  }

  // 4. Limpar logs
  cleanLogs() {
    log('\n📋 Limpando arquivos de log...', 'cyan');
    const logPatterns = ['*.log', 'npm-debug.log*', 'yarn-debug.log*', 'yarn-error.log*'];
    const searchDirs = [this.rootDir, this.backendDir];

    let deleted = 0;
    let space = 0;

    for (const dir of searchDirs) {
      try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          if (file.endsWith('.log') || file.includes('debug.log') || file.includes('error.log')) {
            const filePath = path.join(dir, file);
            const size = getSize(filePath);
            if (deleteFileOrDir(filePath)) {
              deleted++;
              space += size;
              log(`  ✅ Removido: ${file} (${formatBytes(size)})`, 'green');
            }
          }
        }
      } catch (error) {
        // Ignora erros
      }
    }

    if (deleted === 0) {
      log('  ✅ Nenhum arquivo de log encontrado', 'green');
    } else {
      this.stats.filesDeleted += deleted;
      this.stats.spaceFreed += space;
    }
  }

  // 5. Limpar arquivos do sistema operacional
  cleanOSFiles() {
    log('\n🖥️  Limpando arquivos do sistema operacional...', 'cyan');
    const osFiles = ['.DS_Store', 'Thumbs.db', 'desktop.ini'];
    const searchDirs = [this.rootDir, this.backendDir, this.frontendDir];

    let deleted = 0;
    let space = 0;

    for (const dir of searchDirs) {
      try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          if (osFiles.includes(file)) {
            const filePath = path.join(dir, file);
            const size = getSize(filePath);
            if (deleteFileOrDir(filePath)) {
              deleted++;
              space += size;
              log(`  ✅ Removido: ${file}`, 'green');
            }
          }
        }
      } catch (error) {
        // Ignora erros
      }
    }

    if (deleted === 0) {
      log('  ✅ Nenhum arquivo do sistema encontrado', 'green');
    } else {
      this.stats.filesDeleted += deleted;
      this.stats.spaceFreed += space;
    }
  }

  // 6. Limpar cache do Vite
  cleanViteCache() {
    log('\n⚡ Limpando cache do Vite...', 'cyan');
    const viteCacheDirs = [
      path.join(this.frontendDir, '.vite'),
      path.join(this.frontendDir, 'node_modules', '.vite'),
    ];

    for (const cacheDir of viteCacheDirs) {
      if (fs.existsSync(cacheDir)) {
        const size = getDirSize(cacheDir);
        if (deleteFileOrDir(cacheDir)) {
          this.stats.dirsDeleted++;
          this.stats.spaceFreed += size;
          log(`  ✅ Removido: .vite (${formatBytes(size)})`, 'green');
        }
      }
    }
  }

  // 7. Verificar tamanho do node_modules
  auditNodeModules() {
    log('\n📊 Auditando node_modules...', 'cyan');
    const nodeModulesDirs = [
      path.join(this.rootDir, 'node_modules'),
      path.join(this.backendDir, 'node_modules'),
    ];

    for (const nmDir of nodeModulesDirs) {
      if (fs.existsSync(nmDir)) {
        const size = getDirSize(nmDir);
        log(`  📦 ${path.relative(this.rootDir, nmDir)}: ${formatBytes(size)}`, 'blue');
      }
    }
  }

  // 8. Verificar arquivos duplicados de documentação
  auditDocumentation() {
    log('\n📚 Auditando documentação...', 'cyan');
    const docFiles = fs.readdirSync(this.rootDir).filter(f => f.endsWith('.md'));
    log(`  📄 Total de arquivos .md: ${docFiles.length}`, 'blue');
    
    // Verifica arquivos similares
    const similarDocs = [];
    for (let i = 0; i < docFiles.length; i++) {
      for (let j = i + 1; j < docFiles.length; j++) {
        const file1 = docFiles[i].toLowerCase();
        const file2 = docFiles[j].toLowerCase();
        if (file1.includes(file2.substring(0, 10)) || file2.includes(file1.substring(0, 10))) {
          similarDocs.push([docFiles[i], docFiles[j]]);
        }
      }
    }

    if (similarDocs.length > 0) {
      log('  ⚠️  Arquivos de documentação similares encontrados:', 'yellow');
      similarDocs.forEach(([f1, f2]) => {
        log(`     - ${f1} ↔ ${f2}`, 'yellow');
      });
    } else {
      log('  ✅ Nenhum arquivo duplicado encontrado', 'green');
    }
  }

  // 9. Limpar arquivos .env.local e backups
  cleanEnvFiles() {
    log('\n🔐 Limpando arquivos .env locais...', 'cyan');
    const envFiles = ['.env.local', '.env.development.local', '.env.production.local'];
    const searchDirs = [this.rootDir, this.backendDir];

    let deleted = 0;
    for (const dir of searchDirs) {
      for (const envFile of envFiles) {
        const filePath = path.join(dir, envFile);
        if (fs.existsSync(filePath)) {
          log(`  ⚠️  Encontrado: ${envFile} (não removido por segurança)`, 'yellow');
        }
      }
    }
  }

  // 10. Resumo final
  printSummary() {
    log('\n' + '='.repeat(60), 'cyan');
    log('📊 RESUMO DA LIMPEZA', 'cyan');
    log('='.repeat(60), 'cyan');
    log(`✅ Arquivos removidos: ${this.stats.filesDeleted}`, 'green');
    log(`✅ Diretórios removidos: ${this.stats.dirsDeleted}`, 'green');
    log(`✅ Espaço liberado: ${formatBytes(this.stats.spaceFreed)}`, 'green');
    
    if (this.stats.errors.length > 0) {
      log(`\n⚠️  Erros encontrados: ${this.stats.errors.length}`, 'yellow');
      this.stats.errors.forEach(err => {
        log(`   - ${err}`, 'yellow');
      });
    }
    
    log('\n' + '='.repeat(60), 'cyan');
  }

  // Executa todas as limpezas
  async run() {
    log('🧹 INICIANDO LIMPEZA E AUDITORIA DO BIOADVANCED', 'cyan');
    log('='.repeat(60), 'cyan');

    this.cleanUploadTemp();
    this.cleanBuildFiles();
    this.cleanLogs();
    this.cleanOSFiles();
    this.cleanViteCache();
    this.cleanNpmCache();
    this.auditNodeModules();
    this.auditDocumentation();
    this.cleanEnvFiles();

    this.printSummary();
  }
}

// Executa se chamado diretamente
if (require.main === module) {
  const auditor = new CleanupAuditor();
  auditor.run().catch(console.error);
}

module.exports = CleanupAuditor;

