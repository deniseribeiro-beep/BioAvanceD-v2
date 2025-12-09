#!/usr/bin/env node

/**
 * Script para encontrar porta disponível
 * Uso: node scripts/find-port.js [porta_inicial]
 */

const portManager = require('../src/utils/portManager');

async function main() {
  const startPort = parseInt(process.argv[2] || '3000', 10);
  
  console.log(`🔍 Procurando porta disponível a partir de ${startPort}...`);
  
  const availablePort = await portManager.findAvailablePort(startPort);
  
  if (availablePort) {
    console.log(`✅ Porta disponível encontrada: ${availablePort}`);
    console.log(`\n💡 Configure no .env:`);
    console.log(`   PORT=${availablePort}`);
  } else {
    console.log(`❌ Não foi possível encontrar porta disponível próxima a ${startPort}`);
    console.log(`💡 Tente uma porta mais alta ou encerre processos que estão usando as portas`);
  }
}

main().catch(console.error);

