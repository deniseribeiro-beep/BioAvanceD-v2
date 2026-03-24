export const VALIDATION_PATTERNS = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  patientId: /^\d{8}$/,
  cpf: /^\d{11}$/,
  numericCode6: /^\d{6}$/,
  phoneDigits: /^\d{10,15}$/,
  username: /^[a-zA-Z0-9._-]{3,30}$/,
  password: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{12,}$/,
  safeText: /^[a-zA-Z0-9\s\-._@áéíóúãõçÁÉÍÓÚÃÕÇ]*$/,
};

export const VALIDATION_MESSAGES = {
  required: 'Campo obrigatório',
  email: 'Informe um email válido',
  patientId: 'Informe um identificador de paciente com 8 dígitos',
  cpf: 'Informe um CPF com 11 dígitos',
  numericCode6: 'Informe um código numérico de 6 dígitos',
  phoneDigits: 'Informe entre 10 e 15 dígitos',
  username: 'Use 3 a 30 caracteres válidos para o usuário',
  password: 'A senha deve ter 12 caracteres, com maiúscula, minúscula, número e símbolo',
  safeText: 'O texto contém caracteres não permitidos',
};

export const VALIDATION_RULES = {
  name: {
    minLength: 2,
    maxLength: 120,
  },
  username: {
    minLength: 3,
    maxLength: 30,
    pattern: VALIDATION_PATTERNS.username,
  },
  password: {
    minLength: 12,
    maxLength: 128,
    pattern: VALIDATION_PATTERNS.password,
  },
  patientId: {
    length: 8,
    pattern: VALIDATION_PATTERNS.patientId,
  },
  cpf: {
    length: 11,
    pattern: VALIDATION_PATTERNS.cpf,
  },
  mfaCode: {
    length: 6,
    pattern: VALIDATION_PATTERNS.numericCode6,
  },
  phone: {
    minLength: 10,
    maxLength: 15,
    pattern: VALIDATION_PATTERNS.phoneDigits,
  },
  birthDate: {
    maxLength: 10,
    pattern: /^(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})$/,
  },
  email: {
    maxLength: 255,
    pattern: VALIDATION_PATTERNS.email,
  },
  genericText: {
    maxLength: 1000,
    pattern: VALIDATION_PATTERNS.safeText,
  },
};

export const IMPORT_FILE_RULES = {
  allowedExtensions: ['csv', 'txt', 'xlsx', 'json'],
  allowedMimeTypes: [
    'text/csv',
    'text/plain',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/json',
  ],
  maxSizeBytes: 100 * 1024 * 1024,
};

export function getValidationRule(key) {
  return VALIDATION_RULES[key] || null;
}

export function getPatternFor(key) {
  return getValidationRule(key)?.pattern || undefined;
}

export function getMaxLengthFor(key) {
  return getValidationRule(key)?.maxLength || getValidationRule(key)?.length || undefined;
}

export function getMinLengthFor(key) {
  return getValidationRule(key)?.minLength || undefined;
}
