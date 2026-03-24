/**
 * Modelo de validação e estrutura para Patient
 * Baseado no Diagrama de Classes
 */
class PatientModel {
  static isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const normalized = email.trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
  }

  static normalizePhone(phone) {
    if (phone === undefined || phone === null) return null;
    const digits = String(phone).replace(/\D/g, '').trim();
    if (!digits) return null;
    if (digits.length < 10 || digits.length > 15) return null;
    return digits;
  }

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

    if (!data.consentTemplateId || typeof data.consentTemplateId !== 'string' || data.consentTemplateId.trim().length === 0) {
      errors.push('Template de consentimento (consentTemplateId) é obrigatório');
    }

    const isDeceased = data.isDeceased === true;

    if (!data.email || typeof data.email !== 'string' || data.email.trim().length === 0) {
      if (!isDeceased) {
        errors.push('Email (email) é obrigatório');
      }
    } else if (!PatientModel.isValidEmail(data.email)) {
      errors.push('Email (email) inválido');
    }

    if (isDeceased) {
      if (!data.representativeEmail || typeof data.representativeEmail !== 'string' || data.representativeEmail.trim().length === 0) {
        errors.push('Email do representante legal (representativeEmail) é obrigatório');
      } else if (!PatientModel.isValidEmail(data.representativeEmail)) {
        errors.push('Email do representante legal (representativeEmail) inválido');
      }
    }

    if (data.phone !== undefined && data.phone !== null) {
      const normalizedPhone = PatientModel.normalizePhone(data.phone);
      if (!normalizedPhone) {
        errors.push('Telefone (phone) inválido. Informe de 10 a 15 dígitos');
      }
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

    if (data.clinicalUnitId !== undefined && data.clinicalUnitId !== null && typeof data.clinicalUnitId !== 'string') {
      errors.push('clinicalUnitId deve ser string');
    }

    if (data.isDeceased !== undefined && data.isDeceased !== null && typeof data.isDeceased !== 'boolean') {
      errors.push('isDeceased deve ser boolean');
    }

    if (data.representativeName !== undefined && data.representativeName !== null && typeof data.representativeName !== 'string') {
      errors.push('representativeName deve ser string');
    }

    if (data.representativeCpf !== undefined && data.representativeCpf !== null) {
      if (typeof data.representativeCpf !== 'string' && typeof data.representativeCpf !== 'number') {
        errors.push('representativeCpf deve ser texto ou número');
      } else {
        const normalizedRepresentativeCpf = String(data.representativeCpf).replace(/\D/g, '');
        if (normalizedRepresentativeCpf.length > 0 && normalizedRepresentativeCpf.length !== 11) {
          errors.push('representativeCpf deve conter 11 dígitos');
        }
      }
    }

    if (data.representativePhone !== undefined && data.representativePhone !== null) {
      const normalizedRepresentativePhone = PatientModel.normalizePhone(data.representativePhone);
      if (!normalizedRepresentativePhone) {
        errors.push('representativePhone inválido. Informe de 10 a 15 dígitos');
      }
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
    } else if (typeof data.lysoGb3 === 'number' && data.lysoGb3 < 0) {
      errors.push('Lyso-Gb3 (lysoGb3) não pode ser negativo');
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
    } else if (typeof data.alphaGal === 'number' && data.alphaGal < 0) {
      errors.push('α-Galactosidase (alphaGal) não pode ser negativa');
    }

    // icdCode é String
    if (data.icdCode !== undefined && data.icdCode !== null && typeof data.icdCode !== 'string') {
      errors.push(`Código CID (icdCode) deve ser um texto. Valor recebido: "${data.icdCode}" (tipo: ${typeof data.icdCode})`);
    }

    if (data.orphaCode !== undefined && data.orphaCode !== null && typeof data.orphaCode !== 'string') {
      errors.push(`Código ORPHA (orphaCode) deve ser um texto. Valor recebido: "${data.orphaCode}" (tipo: ${typeof data.orphaCode})`);
    }

    if (data.omimCode !== undefined && data.omimCode !== null && typeof data.omimCode !== 'string') {
      errors.push(`Código OMIM (omimCode) deve ser um texto. Valor recebido: "${data.omimCode}" (tipo: ${typeof data.omimCode})`);
    }

    if (data.icdReference !== undefined && data.icdReference !== null) {
      if (typeof data.icdReference !== 'object' || Array.isArray(data.icdReference)) {
        errors.push('icdReference deve ser um objeto válido');
      } else {
        const referenceFields = ['cidId', 'Codigo_Tabulacao', 'Codigos_CID10', 'Descricao', 'ORPHA', 'OMIM'];
        referenceFields.forEach((field) => {
          if (data.icdReference[field] !== undefined && data.icdReference[field] !== null && typeof data.icdReference[field] !== 'string') {
            errors.push(`icdReference.${field} deve ser string`);
          }
        });
      }
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

    const normalizedEmail = typeof patientData.email === 'string' ? patientData.email.trim().toLowerCase() : null;
    const normalizedPhone = PatientModel.normalizePhone(patientData.phone);
    
    return {
      patientID: patientData.patientID || null,
      patientName: patientData.patientName,
      email: normalizedEmail,
      phone: normalizedPhone,
      birthDate: birthDate instanceof Date ? birthDate : new Date(birthDate),
      sex: patientData.sex,
      weight: patientData.weight || null,
      heightCm: heightCm,
      recordNumber: patientData.recordNumber || null,
      cpf: patientData.cpf || null,
      clinicalUnitId: patientData.clinicalUnitId || null,
      clinicalUnit: patientData.clinicalUnit || null,
      unitAcronym: patientData.unitAcronym || null,
      isDeceased: Boolean(patientData.isDeceased),
      representativeName: patientData.representativeName || null,
      representativeEmail: patientData.representativeEmail || null,
      representativeCpf: patientData.representativeCpf || null,
      representativePhone: PatientModel.normalizePhone(patientData.representativePhone),
      diagnosticHypothesis: patientData.diagnosticHypothesis || null,
      icdCode: patientData.icdCode || null, // String conforme dicionário
      orphaCode: patientData.orphaCode || patientData.orpha_code || null,
      omimCode: patientData.omimCode || patientData.omim_code || null,
      icdReference: patientData.icdReference || null,
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
      consentTemplateId: patientData.consentTemplateId || null,
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

    const stopWords = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'OF', 'THE', 'DEL', 'LA', 'EL', 'Y']);
    const normalized = String(clinicalUnit)
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();

    if (!normalized) return null;

    const words = normalized.split(/\s+/).filter(Boolean);
    const relevantWords = words.filter((word) => !stopWords.has(word));
    const source = relevantWords.length > 0 ? relevantWords : words;

    const initials = source.map((word) => word[0]).join('').slice(0, 6);
    return initials || null;
  }
}

module.exports = PatientModel;

