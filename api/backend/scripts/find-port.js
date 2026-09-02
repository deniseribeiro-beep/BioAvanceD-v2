#!/usr/bin/env node

/**
 * Script para encontrar uma porta disponível a partir de uma porta inicial
 * Uso: node scripts/find-port.js [porta_inicial]
 */

const portManager = require('../src/utils/portManager');

const DEFAULT_START_PORT = 3000;

async function main() {
  const arg = process.argv[2];
  const startPort = arg === undefined ? DEFAULT_START_PORT : Number(arg);

  if (!Number.isInteger(startPort) || startPort < 1 || startPort > 65535) {
    console.error(`❌ Porta inicial inválida: ${arg}`);
    console.error('   Uso: npm run find-port [porta_inicial]');
    process.exitCode = 1;
    return;
  }

  console.log(`🔍 Procurando porta disponível a partir de ${startPort}...\n`);

  const port = await portManager.findAvailablePort(startPort);

  if (port === null) {
    console.log(`🔴 Nenhuma porta disponível encontrada próxima a ${startPort}`);
    process.exitCode = 1;
    return;
  }

  if (port === startPort) {
    console.log(`🟢 Porta ${port}: ✅ Disponível`);
  } else {
    console.log(`🟢 Porta ${port}: ✅ Disponível (alternativa a ${startPort})`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
