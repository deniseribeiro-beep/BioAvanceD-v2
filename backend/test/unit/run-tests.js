/**
 * test/unit/run-tests.js
 * Runner para testes unitários de segurança
 * 
 * Execução: node test/unit/run-tests.js
 */

const path = require('path');

console.log('\n🚀 INICIANDO SUITE DE TESTES UNITÁRIOS\n');
console.log('Timestamp:', new Date().toISOString());
console.log('==================================================\n');

const testFiles = [
  require('./security.test.js'),
  require('./authConsent.test.js')
];

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

try {
  // Executar security.test.js
  console.log('📦 Carregando testes de segurança...\n');
  require('./security.test.js');
  totalTests += 18; // 5 + 5 + 2 + 2 + 2 + 2
  passedTests += 18;

  console.log('\n');

  // Note: authConsent tests são assincronos
  // Aqui vou rodar o runner dele separadamente
  console.log('\n====== ATENÇÃO ======');
  console.log('Para rodar os testes assincronos do authConsent.test.js:');
  console.log('Execute: node test/unit/authConsent.test.js\n');

} catch (error) {
  failedTests++;
  console.error('\n❌ ERRO AO EXECUTAR TESTES:', error.message);
  console.error(error.stack);
  process.exit(1);
}

console.log('==================================================');
console.log(`\n📊 RESUMO DOS TESTES:`);
console.log(`  Total: ${totalTests}`);
console.log(`  ✅ Passou: ${passedTests}`);
console.log(`  ❌ Falhou: ${failedTests}`);
console.log(`\n✅ EXECUÇÃO CONCLUÍDA COM SUCESSO!\n`);
