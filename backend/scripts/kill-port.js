#!/usr/bin/env node

/**
 * Script para encerrar processo em uma porta (Windows)
 * Uso: node scripts/kill-port.js [porta]
 */

const portManager = require('../src/utils/portManager');

async function main() {
  const port = parseInt(process.argv[2] || '3000', 10);
  
  console.log(`🔍 Verificando porta ${port}...`);
  
  const process = await portManager.getProcessUsingPort(port);
  
  if (process) {
    console.log(`📌 Processo encontrado:`);
    console.log(`   PID: ${process.pid}`);
    if (process.processName) {
      console.log(`   Nome: ${process.processName}`);
    }
    
    console.log(`\n🔄 Tentando encerrar processo...`);
    const killed = await portManager.killProcessOnPort(port);
    
    if (killed) {
      console.log(`✅ Processo encerrado com sucesso!`);
      console.log(`💡 Porta ${port} deve estar disponível agora.`);
    } else {
      console.log(`❌ Não foi possível encerrar o processo.`);
      console.log(`💡 Tente encerrar manualmente:`);
      console.log(`   taskkill /PID ${process.pid} /F`);
    }
  } else {
    console.log(`✅ Porta ${port} não está em uso ou não foi possível identificar o processo.`);
  }
}

main().catch(console.error);

