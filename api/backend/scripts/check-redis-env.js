/**
 * Script para verificar e corrigir configuração Redis no .env
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');

console.log('🔍 Verificando configuração Redis...\n');

// Verifica se arquivo existe
if (!fs.existsSync(envPath)) {
  console.error('❌ Arquivo .env não encontrado em:', envPath);
  process.exit(1);
}

// Lê conteúdo do arquivo
const content = fs.readFileSync(envPath, 'utf8');
const lines = content.split('\n');

console.log('📄 Conteúdo do .env relacionado ao Redis:');
const redisLines = lines.filter(l => l.trim() && (l.includes('REDIS') || l.includes('redis')));
if (redisLines.length === 0) {
  console.log('  ⚠️ Nenhuma variável REDIS encontrada!');
} else {
  redisLines.forEach((line, idx) => {
    // Oculta senha
    const safeLine = line.includes('PASSWORD') 
      ? line.replace(/=.*/, '=***OCULTO***')
      : line;
    console.log(`  ${idx + 1}. ${safeLine.trim()}`);
  });
}

console.log('\n🔍 Variáveis carregadas pelo dotenv:');
console.log('  REDIS_HOST:', process.env.REDIS_HOST || '❌ NÃO DEFINIDO');
console.log('  REDIS_PORT:', process.env.REDIS_PORT || '❌ NÃO DEFINIDO');
// Em dev/local, senha e TLS não são obrigatórios
console.log('  REDIS_URL:', process.env.REDIS_URL || '❌ NÃO DEFINIDO');

// Verifica problemas
console.log('\n📋 Diagnóstico:');
const problems = [];

if (!process.env.REDIS_HOST && !process.env.REDIS_URL) {
  problems.push('❌ REDIS_HOST ou REDIS_URL não está definido');
}

if (process.env.REDIS_URL && !process.env.REDIS_HOST) {
  problems.push('⚠️ REDIS_URL está definido, mas REDIS_HOST não. O código precisa de REDIS_HOST.');
  // Tenta extrair host e porta do REDIS_URL
  const url = process.env.REDIS_URL;
  const match = url.match(/^redis[s]?:\/\/(?:.*@)?([^:]+):(\d+)/);
  if (match) {
  }
}

if (!process.env.REDIS_PORT && !process.env.REDIS_URL) {
  problems.push('❌ REDIS_PORT não está definido');
}


// Em dev/local, senha e TLS não são obrigatórios


if (problems.length === 0) {
  console.log('✅ Configuração parece correta!');
} else {
  console.log('Problemas encontrados:');
  problems.forEach(p => console.log(`  ${p}`));
}


