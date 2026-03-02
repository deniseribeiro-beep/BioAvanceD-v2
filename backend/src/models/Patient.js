/**
 * Modelo de validação e estrutura para Patient
 * Baseado no Diagrama de Classes
 */
class PatientModel {
  /**
   * Valida e estrutura os dados de um paciente
   */
  static validate(data) {
    const errors = [];

    // Campos obrigatórios
    if (!data.patientName || typeof data.patientName !== 'string') {
      errors.push('Nome do paciente (patientName) é obrigatório e deve ser um texto válido');
    } else if (data.patientName.trim().length === 0) {
      errors.push('Nome do paciente (patientName) não pode estar vazio');
    }

    // birthDate pode ser Date ou string (formato DD/MM/YYYY ou ISO)
    if (!data.birthDate) {
      errors.push('Data de nascimento (birthDate) é obrigatória');
    } else {
      const isValidDate = data.birthDate instanceof Date || 
                         (typeof data.birthDate === 'string' && data.birthDate.length > 0);
      if (!isValidDate) {
        errors.push('Data de nascimento (birthDate) deve ser uma data válida no formato DD/MM/YYYY ou YYYY-MM-DD');
      } else if (data.birthDate instanceof Date && isNaN(data.birthDate.getTime())) {
        errors.push('Data de nascimento (birthDate) é inválida');
      }
    }

    if (!data.sex || !['M', 'F', 'O'].includes(data.sex)) {
      const sexValue = data.sex ? `"${data.sex}"` : 'vazio';
      errors.push(`Sexo (sex) é obrigatório e deve ser M (Masculino), F (Feminino) ou O (Outro). Valor recebido: ${sexValue}`);
    }

    // recordNumber pode ser number, string ou null
    if (data.recordNumber !== undefined && data.recordNumber !== null && typeof data.recordNumber !== 'number' && typeof data.recordNumber !== 'string') {
      errors.push(`Número do prontuário (recordNumber) deve ser um número ou texto. Tipo recebido: ${typeof data.recordNumber}`);
    }

    if (data.cpf !== undefined && data.cpf !== null) {
      if (typeof data.cpf !== 'string' && typeof data.cpf !== 'number') {
        errors.push('CPF (cpf) deve ser texto ou número');
      } else {
        const normalizedCpf = String(data.cpf).replace(/\D/g, '');
        if (normalizedCpf.length > 0 && normalizedCpf.length !== 11) {
          errors.push('CPF (cpf) deve conter 11 dígitos');
        }
      }
    }

    if (data.clinicalUnit && typeof data.clinicalUnit !== 'string') {
      errors.push('clinicalUnit deve ser string');
    }

    // Validações numéricas
    if (data.weight !== undefined && data.weight !== null) {
      if (typeof data.weight !== 'number') {
        errors.push(`Peso (weight) deve ser um número. Valor recebido: "${data.weight}" (tipo: ${typeof data.weight})`);
      } else if (data.weight < 0) {
        errors.push(`Peso (weight) deve ser maior ou igual a zero. Valor recebido: ${data.weight}`);
      }
    }

    if (data.heightCm !== undefined && data.heightCm !== null) {
      if (typeof data.heightCm !== 'number') {
        errors.push(`Altura (heightCm) deve ser um número em centímetros. Valor recebido: "${data.heightCm}" (tipo: ${typeof data.heightCm})`);
      } else if (data.heightCm < 0) {
        errors.push(`Altura (heightCm) deve ser maior ou igual a zero. Valor recebido: ${data.heightCm}`);
      }
    }

    if (data.lysoGb3 !== undefined && data.lysoGb3 !== null && typeof data.lysoGb3 !== 'number') {
      errors.push(`Lyso-Gb3 (lysoGb3) deve ser um número. Valor recebido: "${data.lysoGb3}" (tipo: ${typeof data.lysoGb3})`);
    }

    // Validações booleanas
    const booleanFields = [
      { field: 'hypertension', label: 'Hipertensão' },
      { field: 'obesity', label: 'Obesidade' },
      { field: 'diabetesType1', label: 'Diabetes Tipo 1' },
      { field: 'diabetesType2', label: 'Diabetes Tipo 2' },
      { field: 'copd', label: 'DPOC' },
      { field: 'ckd', label: 'DRC' },
      { field: 'smoking', label: 'Tabagismo' },
      { field: 'alcoholUse', label: 'Uso de Álcool' },
      { field: 'asthma', label: 'Asma' },
      { field: 'antibioticUse', label: 'Uso de Antibióticos' },
      { field: 'insulinUse', label: 'Uso de Insulina' },
      { field: 'antiviralUse', label: 'Uso de Antivirais' }
    ];

    booleanFields.forEach(({ field, label }) => {
      if (data[field] !== undefined && data[field] !== null && typeof data[field] !== 'boolean') {
        errors.push(`${label} (${field}) deve ser true ou false. Valor recebido: "${data[field]}" (tipo: ${typeof data[field]})`);
      }
    });

    // geneticVariant é String
    if (data.geneticVariant !== undefined && data.geneticVariant !== null && typeof data.geneticVariant !== 'string') {
      errors.push(`Variante genética (geneticVariant) deve ser um texto. Valor recebido: "${data.geneticVariant}" (tipo: ${typeof data.geneticVariant})`);
    }

    // alphaGal é Float (pode ser null)
    if (data.alphaGal !== undefined && data.alphaGal !== null && typeof data.alphaGal !== 'number') {
      errors.push(`α-Galactosidase (alphaGal) deve ser um número decimal (U/mL) ou vazio. Valor recebido: "${data.alphaGal}" (tipo: ${typeof data.alphaGal})`);
    }

    // icdCode é String
    if (data.icdCode !== undefined && data.icdCode !== null && typeof data.icdCode !== 'string') {
      errors.push(`Código CID (icdCode) deve ser um texto. Valor recebido: "${data.icdCode}" (tipo: ${typeof data.icdCode})`);
    }

    // status de consentimento
    if (data.status !== undefined && data.status !== null) {
      const allowedStatuses = ['PENDING_CONSENT', 'ACTIVE', 'INACTIVE'];
      if (!allowedStatuses.includes(data.status)) {
        errors.push(`status inválido. Valores permitidos: ${allowedStatuses.join(', ')}`);
      }
    }

    if (data.consentToken !== undefined && data.consentToken !== null && typeof data.consentToken !== 'string') {
      errors.push('consentToken deve ser string');
    }

    if (data.consentAcceptedAt !== undefined && data.consentAcceptedAt !== null) {
      const acceptedAt = new Date(data.consentAcceptedAt);
      if (Number.isNaN(acceptedAt.getTime())) {
        errors.push('consentAcceptedAt deve ser uma data válida');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Estrutura padrão de um documento Patient
   */
  static create(data) {
    // Converte birthDate para Date se for string
    let birthDate = data.birthDate;
    if (typeof birthDate === 'string') {
      // Tenta parsear formato DD/MM/YYYY
      const parts = birthDate.split('/');
      if (parts.length === 3) {
        birthDate = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      } else {
        birthDate = new Date(birthDate);
      }
    }
    
    // Converte height (metros) para heightCm (centímetros) se fornecido
    // IMPORTANTE: Remove o campo height antes de salvar (não deve ser persistido)
    let heightCm = data.heightCm || null;
    if (data.height !== undefined && data.height !== null && !heightCm) {
      // Se height foi fornecido e heightCm não, converte metros para centímetros
      const heightValue = parseFloat(data.height);
      if (!isNaN(heightValue) && heightValue > 0) {
        // Se o valor for menor que 3, assume que está em metros
        heightCm = heightValue < 3 ? heightValue * 100 : heightValue;
      }
    }
    
    // Remove o campo height se existir (não deve ser salvo no banco)
    const patientData = { ...data };
    delete patientData.height;
    
    return {
      patientID: patientData.patientID || null,
      patientName: patientData.patientName,
      birthDate: birthDate instanceof Date ? birthDate : new Date(birthDate),
      sex: patientData.sex,
      weight: patientData.weight || null,
      heightCm: heightCm,
      recordNumber: patientData.recordNumber || null,
      cpf: patientData.cpf || null,
      clinicalUnit: patientData.clinicalUnit || null,
      unitAcronym: patientData.unitAcronym || null,
      diagnosticHypothesis: patientData.diagnosticHypothesis || null,
      icdCode: patientData.icdCode || null, // String conforme dicionário
      hypertension: patientData.hypertension || false,
      obesity: patientData.obesity || false,
      diabetesType1: patientData.diabetesType1 || false,
      diabetesType2: patientData.diabetesType2 || false,
      copd: patientData.copd || false,
      ckd: patientData.ckd || false,
      smoking: patientData.smoking || false,
      alcoholUse: patientData.alcoholUse || false,
      asthma: patientData.asthma || false,
      antibioticUse: patientData.antibioticUse || false,
      insulinUse: patientData.insulinUse || false,
      antiviralUse: patientData.antiviralUse || false,
      geneticVariant: patientData.geneticVariant || null, // String - código da variante genética
      alphaGal: patientData.alphaGal || null, // Float U/mL - Resultado de α-Galactosidase
      lysoGb3: patientData.lysoGb3 || null, // Float ng/mL - Resultado de Lyso-Gb3
      notes: patientData.notes || null,
      status: patientData.status || 'PENDING_CONSENT',
      consentToken: patientData.consentToken || null,
      consentTokenCreatedAt: patientData.consentTokenCreatedAt ? new Date(patientData.consentTokenCreatedAt) : null,
      consentTokenExpiresAt: patientData.consentTokenExpiresAt ? new Date(patientData.consentTokenExpiresAt) : null,
      consentNotifiedAt: patientData.consentNotifiedAt ? new Date(patientData.consentNotifiedAt) : null,
      consentAcceptedAt: patientData.consentAcceptedAt ? new Date(patientData.consentAcceptedAt) : null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  /**
   * Valida unidade clínica
   */
  static validateUnit(clinicalUnit) {
    // Implementar validação conforme regras de negócio
    return clinicalUnit && typeof clinicalUnit === 'string' && clinicalUnit.length > 0;
  }

  /**
   * Gera sigla da unidade
   */
  static fillAcronym(clinicalUnit) {
    if (!clinicalUnit) return null;

    const map = {
      'Cardiologia': 'CARDIO',
      'Oncologia': 'ONCO',
      'Genética': 'GEN'
    };

    const normalized = clinicalUnit.trim();
    const mapped = map[normalized];

    if (mapped) {
      return mapped.toUpperCase();
    }

    const fallback = normalized.replace(/\s+/g, '').substring(0, 3);
    return fallback.toUpperCase();
  }
}

module.exports = PatientModel;

