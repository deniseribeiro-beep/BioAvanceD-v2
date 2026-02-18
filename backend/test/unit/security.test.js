/**
 * test/unit/security.test.js
 * Testes unitários para utilitários de segurança
 * 
 * Execução: node test/unit/security.test.js
 */

const assert = require('assert');
const {
  sanitizeInput,
  validateCPF,
  validateEmail,
  sanitizeSensitiveData,
  escapeString,
  validateStructuredInput
} = require('../../src/utils/security');

/**
 * TESTES PARA sanitizeInput()
 * Testa prevenção de XSS e remoção de scripts
 */
function testSanitizeInputXSSPrevention() {
  console.log('  ✓ Teste A: Remover <script> tags');
  
  const input = 'Hello <script>alert("XSS")</script> World';
  const result = sanitizeInput(input);
  
  assert.strictEqual(
    result.includes('<script>'),
    false,
    'Esperava que <script> fosse removido'
  );
  assert.strictEqual(
    result.includes('alert'),
    false,
    'Esperava que conteúdo de script fosse removido'
  );
  assert.ok(result.includes('Hello'), 'Texto legítimo deve ser preservado');
  assert.ok(result.includes('World'), 'Texto legítimo deve ser preservado');
}

function testSanitizeInputEventHandlers() {
  console.log('  ✓ Teste B: Remover event handlers');
  
  const input = '<img src=x onerror="alert(\'XSS\')">';
  const result = sanitizeInput(input);
  
  assert.strictEqual(
    result.includes('onerror'),
    false,
    'Event handlers devem ser removidos'
  );
}

function testSanitizeInputHTMLTags() {
  console.log('  ✓ Teste C: Remover tags HTML');
  
  const input = '<b>Bold</b> <i>Italic</i> <div>Content</div>';
  const result = sanitizeInput(input);
  
  assert.strictEqual(
    result.includes('<'),
    false,
    'Tags HTML devem ser removidas'
  );
  assert.ok(result.includes('Bold'), 'Conteúdo deve ser preservado');
}

function testSanitizeInputMaxLength() {
  console.log('  ✓ Teste D: Limitar tamanho máximo (DoS prevention)');
  
  const longInput = 'a'.repeat(2000);
  const result = sanitizeInput(longInput);
  
  assert.ok(
    result.length <= 1000,
    `Esperava máximo 1000 chars, recebeu ${result.length}`
  );
}

function testSanitizeInputEmptyInput() {
  console.log('  ✓ Teste E: Lidar com entrada vazia/nula');
  
  assert.strictEqual(sanitizeInput(''), '');
  assert.strictEqual(sanitizeInput(null), '');
  assert.strictEqual(sanitizeInput(undefined), '');
  assert.strictEqual(sanitizeInput(123), '');
}

/**
 * TESTES PARA validateCPF()
 * Valida algoritmo de dígito verificador
 */
function testValidateCPFValid() {
  console.log('  ✓ Teste A: CPF válido');
  
  // CPF válido: 123.456.789-09 (dígitos calculados corretamente)
  // Na verdade, vou usar um CPF que sei que é válido
  // Algoritmo: sum de (digit * peso), resto % 11
  // Vou criar um que funciona
  const validCPF = '11144477735'; // CPF válido (números reais de teste)
  
  const result = validateCPF(validCPF);
  assert.strictEqual(result, true, 'Deveria aceitar CPF válido');
}

function testValidateCPFInvalidFormat() {
  console.log('  ✓ Teste B: CPF com formato inválido');
  
  const inputs = [
    '123',        // Muito curto
    'abcdefghijk', // Não é número
    '',           // Vazio
    null,         // Nulo
    undefined,    // Undefined
    '12345678901234' // Muito longo
  ];

  inputs.forEach((input, idx) => {
    const result = validateCPF(input);
    assert.strictEqual(
      result,
      false,
      `Input ${idx} deveria ser inválido`
    );
  });
}

function testValidateCPFSequential() {
  console.log('  ✓ Teste C: Rejeitar CPFs sequenciais (todos dígitos iguais)');
  
  const sequentialCPFs = [
    '00000000000',
    '11111111111',
    '22222222222',
    '33333333333',
    '99999999999'
  ];

  sequentialCPFs.forEach(cpf => {
    const result = validateCPF(cpf);
    assert.strictEqual(
      result,
      false,
      `CPF ${cpf} deveria ser rejeitado (sequencial)`
    );
  });
}

function testValidateCPFWithFormatting() {
  console.log('  ✓ Teste D: Aceitar CPF com formatação (pontos e hífens)');
  
  // Mesmo CPF em diferentes formatos
  const cpf = '11144477735';
  const formatted1 = '111.444.777-35';
  const formatted2 = '111-444-777-35';
  
  const result1 = validateCPF(cpf);
  const result2 = validateCPF(formatted1);
  const result3 = validateCPF(formatted2);
  
  assert.strictEqual(result1, result2, 'CPF com e sem formatação devem ter mesmo resultado');
  assert.strictEqual(result1, result3, 'CPF com formatação alternativa deve funcionar');
}

function testValidateCPFChecksumValidation() {
  console.log('  ✓ Teste E: Validar dígitos verificadores');
  
  // CPF válido
  const validCPF = '11144477735';
  assert.strictEqual(validateCPF(validCPF), true);
  
  // Alterar último dígito (deve falhar)
  const invalidLastDigit = '11144477736';
  assert.strictEqual(validateCPF(invalidLastDigit), false);
  
  // Alterar penúltimo dígito (deve falhar)
  const invalidFirstCheckDigit = '11144477745';
  assert.strictEqual(validateCPF(invalidFirstCheckDigit), false);
}

/**
 * TESTES PARA validateEmail()
 */
function testValidateEmail() {
  console.log('  ✓ Teste A: Emails válidos');
  
  const validEmails = [
    'user@example.com',
    'test.name@domain.co.uk',
    'user+tag@example.org'
  ];

  validEmails.forEach(email => {
    assert.strictEqual(
      validateEmail(email),
      true,
      `Email ${email} deveria ser válido`
    );
  });
}

function testValidateEmailInvalid() {
  console.log('  ✓ Teste B: Emails inválidos');
  
  const invalidEmails = [
    'notanemail',
    '@example.com',
    'user@',
    'user @example.com',
    '',
    null
  ];

  invalidEmails.forEach(email => {
    assert.strictEqual(
      validateEmail(email),
      false,
      `Email ${email} deveria ser inválido`
    );
  });
}

/**
 * TESTES PARA sanitizeSensitiveData()
 */
function testSanitizeSensitiveData() {
  console.log('  ✓ Teste A: Redacionar dados sensíveis');
  
  const data = {
    name: 'João Silva',
    cpf: '11144477735',
    password: 'senhaSecreto123',
    email: 'joao@example.com',
    token: 'jwt-token-longo'
  };

  const redacted = sanitizeSensitiveData(data);

  assert.strictEqual(redacted.name, 'João Silva', 'Nome não deve ser redacionado');
  assert.strictEqual(redacted.email, 'joao@example.com', 'Email não deve ser redacionado');
  assert.strictEqual(redacted.cpf, '***REDATADO***', 'CPF deve ser redacionado');
  assert.strictEqual(redacted.password, '***REDATADO***', 'Password deve ser redacionado');
  assert.strictEqual(redacted.token, '***REDATADO***', 'Token deve ser redacionado');
}

function testSanitizeSensitiveDataCustomFields() {
  console.log('  ✓ Teste B: Redacionar campos customizados');
  
  const data = {
    patientID: '123',
    sensitive_info: 'dados-privados',
    normal_field: 'valor-normal'
  };

  const redacted = sanitizeSensitiveData(data, ['sensitive_info']);

  assert.strictEqual(redacted.sensitive_info, '***REDATADO***');
  assert.strictEqual(redacted.normal_field, 'valor-normal');
  assert.strictEqual(redacted.patientID, '123');
}

/**
 * TESTES PARA escapeString()
 */
function testEscapeString() {
  console.log('  ✓ Teste A: Escapar caracteres especiais MongoDB');
  
  const input = 'test.$problematic.field';
  const result = escapeString(input);
  
  assert.ok(
    result.includes('\\$') || !result.startsWith('test.$'),
    'Caracteres $ devem ser escapados'
  );
}

function testEscapeStringEmpty() {
  console.log('  ✓ Teste B: Lidar com strings vazias');
  
  assert.strictEqual(escapeString(''), '');
  assert.strictEqual(escapeString(null), '');
  assert.strictEqual(escapeString(undefined), '');
}

/**
 * TESTES PARA validateStructuredInput()
 */
function testValidateStructuredInput() {
  console.log('  ✓ Teste A: Validar entrada estruturada');
  
  const data = {
    patientName: 'João Silva',
    email: 'joao@example.com',
    age: 30,
    active: true,
    medicalHistory: ['diabetes', 'hipertensão']
  };

  const allowedFields = ['patientName', 'email', 'age', 'active', 'medicalHistory'];
  const result = validateStructuredInput(data, allowedFields);

  assert.strictEqual(result.isValid, true);
  assert.strictEqual(result.errors.length, 0);
  assert.ok(result.cleanData.patientName);
}

function testValidateStructuredInputXSSInContent() {
  console.log('  ✓ Teste B: Sanitizar XSS em entrada estruturada');
  
  const data = {
    patientName: 'João<script>alert("xss")</script>Silva',
    email: 'joao@example.com'
  };

  const allowedFields = ['patientName', 'email'];
  const result = validateStructuredInput(data, allowedFields);

  assert.strictEqual(result.isValid, true);
  assert.ok(!result.cleanData.patientName.includes('<script>'));
  assert.ok(result.cleanData.patientName.includes('João'));
}

// ===================================================================
// RUNNER
// ===================================================================

function runTests() {
  console.log('\n📋 SUITE DE TESTES: Security Utilities');
  console.log('==========================================\n');

  try {
    console.log('🧹 sanitizeInput() - Prevenção de XSS:');
    testSanitizeInputXSSPrevention();
    testSanitizeInputEventHandlers();
    testSanitizeInputHTMLTags();
    testSanitizeInputMaxLength();
    testSanitizeInputEmptyInput();
    console.log('  ✅ 5/5 testes passaram\n');

    console.log('🔐 validateCPF() - Validação de CPF:');
    testValidateCPFValid();
    testValidateCPFInvalidFormat();
    testValidateCPFSequential();
    testValidateCPFWithFormatting();
    testValidateCPFChecksumValidation();
    console.log('  ✅ 5/5 testes passaram\n');

    console.log('📧 validateEmail() - Validação de Email:');
    testValidateEmail();
    testValidateEmailInvalid();
    console.log('  ✅ 2/2 testes passaram\n');

    console.log('🔒 sanitizeSensitiveData() - Redação de Dados:');
    testSanitizeSensitiveData();
    testSanitizeSensitiveDataCustomFields();
    console.log('  ✅ 2/2 testes passaram\n');

    console.log('🛡️  escapeString() - Escape de Caracteres:');
    testEscapeString();
    testEscapeStringEmpty();
    console.log('  ✅ 2/2 testes passaram\n');

    console.log('📝 validateStructuredInput() - Validação Estruturada:');
    testValidateStructuredInput();
    testValidateStructuredInputXSSInContent();
    console.log('  ✅ 2/2 testes passaram\n');

    console.log('✅ TODOS OS TESTES PASSARAM!');
    console.log('==========================================\n');

  } catch (error) {
    console.error('\n❌ TESTE FALHOU:');
    console.error(error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Executar se for o arquivo principal
if (require.main === module) {
  runTests();
}

module.exports = {
  testSanitizeInputXSSPrevention,
  testValidateCPFValid,
  testValidateEmail,
  testSanitizeSensitiveData,
  testEscapeString,
  testValidateStructuredInput
};
