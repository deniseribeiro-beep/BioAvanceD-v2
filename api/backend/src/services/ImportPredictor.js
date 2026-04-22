class ImportPredictor {
  constructor() {
    this.bioFields = [
      'patientName',
      'email',
      'cpf',
      'birthDate',
      'isDeceased',
      'representativeName',
      'representativeEmail',
      'representativeCpf',
      'phone',
      'sex',
      'recordNumber',
      'clinicalUnit',
      'unitAcronym'
    ];

    this.canonicalHeaderMap = {
      patientname: 'patientName',
      nomepaciente: 'patientName',
      name: 'patientName',
      email: 'email',
      cpf: 'cpf',
      birthdate: 'birthDate',
      datanascimento: 'birthDate',
      sexo: 'sex',
      sex: 'sex',
      phone: 'phone',
      telefone: 'phone',
      celular: 'phone',
      isdeceased: 'isDeceased',
      falecido: 'isDeceased',
      representativeemail: 'representativeEmail',
      responsavelemail: 'representativeEmail',
      representativecpf: 'representativeCpf',
      responsavelcpf: 'representativeCpf',
      representativename: 'representativeName',
      responsavelnome: 'representativeName',
      recordnumber: 'recordNumber',
      prontuario: 'recordNumber',
      clinicalunit: 'clinicalUnit',
      unidadeclinica: 'clinicalUnit',
      unitacronym: 'unitAcronym',
      siglaunidade: 'unitAcronym',
      heightcm: 'heightCm',
      weight: 'weight',
      diagnostichypothesis: 'diagnosticHypothesis',
      icdcode: 'icdCode',
      hypertension: 'hypertension',
      obesity: 'obesity',
      diabetestype1: 'diabetesType1',
      diabetestype2: 'diabetesType2',
      copd: 'copd',
      ckd: 'ckd',
      smoking: 'smoking',
      alcoholuse: 'alcoholUse',
      asthma: 'asthma',
      antibioticuse: 'antibioticUse',
      insulinuse: 'insulinUse',
      antiviraluse: 'antiviralUse',
      geneticvariant: 'geneticVariant',
      alphagal: 'alphaGal',
      lysogb3: 'lysoGb3',
      notes: 'notes'
    };
  }

  normalizeHeader(header) {
    return String(header || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  normalizeValue(value) {
    return String(value ?? '').trim();
  }

  isEmail(value) {
    return /@/.test(this.normalizeValue(value));
  }

  isCpfCandidate(value) {
    const digits = this.normalizeValue(value).replace(/\D/g, '');
    return digits.length === 11 || digits.length === 14;
  }

  isDateCandidate(value) {
    const text = this.normalizeValue(value);
    if (!text) return false;

    const iso = /^\d{4}-\d{2}-\d{2}$/;
    const br = /^\d{2}[/-]\d{2}[/-]\d{4}$/;
    return iso.test(text) || br.test(text);
  }

  headerSuggestsDeceased(header) {
    const normalized = this.normalizeHeader(header);
    return normalized.includes('status') || normalized.includes('vivo') || normalized.includes('obito') || normalized.includes('óbito') || normalized.includes('falecido');
  }

  headerSuggestsRepresentative(header) {
    const normalized = this.normalizeHeader(header);
    return normalized.includes('responsavel') || normalized.includes('representante');
  }

  headerSuggestsName(header) {
    const normalized = this.normalizeHeader(header);
    return normalized.includes('nome') || normalized.includes('name');
  }

  headerSuggestsBirthDate(header) {
    const normalized = this.normalizeHeader(header);
    return normalized.includes('nascimento') || normalized.includes('birth') || normalized.includes('data');
  }

  headerSuggestsCpf(header) {
    const normalized = this.normalizeHeader(header);
    return normalized.includes('cpf') || normalized.includes('cnpj') || normalized.includes('documento');
  }

  headerSuggestsUnit(header) {
    const normalized = this.normalizeHeader(header);
    return normalized.includes('unidade') || normalized.includes('unit') || normalized.includes('clinica') || normalized.includes('clínica');
  }

  inferField(header, sampleValue) {
    const normalizedHeader = this.normalizeHeader(header).replace(/[^a-z0-9]/g, '');
    if (this.canonicalHeaderMap[normalizedHeader]) {
      return {
        targetField: this.canonicalHeaderMap[normalizedHeader],
        confidence: 0.99,
        reason: 'Mapeamento direto por nome de coluna'
      };
    }

    if (this.headerSuggestsDeceased(header)) {
      return { targetField: 'isDeceased', confidence: 0.95, reason: 'Header contém status/vivo/óbito' };
    }

    if (this.isEmail(sampleValue)) {
      if (this.headerSuggestsRepresentative(header)) {
        return { targetField: 'representativeEmail', confidence: 0.94, reason: 'Valor contém @ e header sugere responsável' };
      }
      return { targetField: 'email', confidence: 0.92, reason: 'Valor contém @' };
    }

    if (this.isCpfCandidate(sampleValue) || this.headerSuggestsCpf(header)) {
      if (this.headerSuggestsRepresentative(header)) {
        return { targetField: 'representativeCpf', confidence: 0.9, reason: '11/14 dígitos com header de representante' };
      }
      return { targetField: 'cpf', confidence: 0.9, reason: 'Valor aparenta CPF/CNPJ' };
    }

    if (this.isDateCandidate(sampleValue) || this.headerSuggestsBirthDate(header)) {
      return { targetField: 'birthDate', confidence: 0.89, reason: 'Padrão de data ISO/BR detectado' };
    }

    if (this.headerSuggestsRepresentative(header) && this.headerSuggestsName(header)) {
      return { targetField: 'representativeName', confidence: 0.88, reason: 'Header sugere nome do responsável' };
    }

    if (this.headerSuggestsUnit(header)) {
      return { targetField: 'clinicalUnit', confidence: 0.85, reason: 'Header sugere unidade clínica' };
    }

    if (this.headerSuggestsName(header)) {
      return { targetField: 'patientName', confidence: 0.82, reason: 'Header sugere nome do paciente' };
    }

    if (this.normalizeHeader(header).includes('sexo')) {
      return { targetField: 'sex', confidence: 0.8, reason: 'Header sugere sexo' };
    }

    if (this.normalizeHeader(header).includes('telefone') || this.normalizeHeader(header).includes('phone') || this.normalizeHeader(header).includes('celular')) {
      return { targetField: 'phone', confidence: 0.78, reason: 'Header sugere telefone' };
    }

    if (this.normalizeHeader(header).includes('prontuario') || this.normalizeHeader(header).includes('record') || this.normalizeHeader(header).includes('matricula')) {
      return { targetField: 'recordNumber', confidence: 0.76, reason: 'Header sugere prontuário' };
    }

    return { targetField: null, confidence: 0, reason: 'Sem inferência suficiente' };
  }

  predict(headers = [], firstRow = {}) {
    const suggestions = headers.map((sourceColumn) => {
      const sampleValue = firstRow[sourceColumn];
      const inference = this.inferField(sourceColumn, sampleValue);
      return {
        sourceColumn,
        sampleValue: sampleValue ?? null,
        ...inference
      };
    });

    const suggestedMapping = suggestions.reduce((acc, item) => {
      if (item.targetField) {
        acc[item.sourceColumn] = item.targetField;
      }
      return acc;
    }, {});

    return {
      userColumns: headers,
      bioFields: this.bioFields,
      suggestions,
      suggestedMapping
    };
  }
}

module.exports = new ImportPredictor();
