#!/usr/bin/env node

/**
 * Script para verificar portas em uso
 * Uso: node scripts/check-ports.js
 */

const portManager = require('../src/utils/portManager');

async function main() {
  const ports = [3000, 3001, 3002, 3003, 3004, 3005];
  
  console.log('🔍 Verificando portas...\n');
  
  for (const port of ports) {
    const available = await portManager.isPortAvailable(port);
    const status = available ? '✅ Disponível' : '❌ Em uso';
    const icon = available ? '🟢' : '🔴';
    
    if (!available) {
      const process = await portManager.getProcessUsingPort(port);
      if (process) {
        console.log(`${icon} Porta ${port}: ${status} - PID: ${process.pid}${process.processName ? ` (${process.processName})` : ''}`);
      } else {
        console.log(`${icon} Porta ${port}: ${status}`);
      }
    } else {
      console.log(`${icon} Porta ${port}: ${status}`);
    }
  }
  
  console.log('\n💡 Para encerrar processo em uma porta:');
  console.log('   npm run kill-port [porta]');
  console.log('\n💡 Para encontrar porta disponível:');
  console.log('   npm run find-port [porta_inicial]');
}

main().catch(console.error);

