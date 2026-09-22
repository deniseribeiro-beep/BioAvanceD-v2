/**
 * Validador de CSV para importação de amostras
 * Valida estrutura e campos obrigatórios antes de enviar ao backend
 */

export interface CSVValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  rowCount: number;
  headers: string[];
  sampleRows: any[];
}

/**
 * Campos obrigatórios para importação de amostras
 */
const REQUIRED_FIELDS = ['participantId', 'sampleType', 'sampleOrigin'];

/**
 * Campos opcionais mas recomendados
 */
const RECOMMENDED_FIELDS = ['extractionProtocol', 'quantity', 'quality', 'linkedProject', 'registeredAt'];

/**
 * Valida arquivo CSV antes de enviar
 */
export async function validateCSVFile(file: File): Promise<CSVValidationResult> {
  const result: CSVValidationResult = {
    isValid: true,
    errors: [],
    warnings: [],
    rowCount: 0,
    headers: [],
    sampleRows: [],
  };

  try {
    // Valida extensão
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.csv')) {
      result.isValid = false;
      result.errors.push('Arquivo deve ser CSV (.csv)');
      return result;
    }

    // Valida tamanho (máximo 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      result.isValid = false;
      result.errors.push('Arquivo muito grande. Tamanho máximo: 10MB');
      return result;
    }

    // Lê arquivo
    const text = await file.text();
    const lines = text.split('\n').filter(line => line.trim() !== '');

    if (lines.length < 2) {
      result.isValid = false;
      result.errors.push('Arquivo CSV deve conter pelo menos um cabeçalho e uma linha de dados');
      return result;
    }

    // Parse cabeçalho
    const headers = parseCSVLine(lines[0]);
    result.headers = headers.map(h => h.trim());

    // Valida campos obrigatórios
    const missingFields = REQUIRED_FIELDS.filter(field => !result.headers.includes(field));
    if (missingFields.length > 0) {
      result.isValid = false;
      result.errors.push(`Campos obrigatórios ausentes: ${missingFields.join(', ')}`);
    }

    // Verifica campos recomendados
    const missingRecommended = RECOMMENDED_FIELDS.filter(field => !result.headers.includes(field));
    if (missingRecommended.length > 0) {
      result.warnings.push(`Campos recomendados ausentes: ${missingRecommended.join(', ')}`);
    }

    // Parse linhas de dados
    const dataLines = lines.slice(1);
    result.rowCount = dataLines.length;

    if (result.rowCount === 0) {
      result.isValid = false;
      result.errors.push('Arquivo CSV não contém dados (apenas cabeçalho)');
      return result;
    }

    // Valida cada linha
    for (let i = 0; i < dataLines.length; i++) {
      const line = dataLines[i];
      const rowNumber = i + 2; // +2 porque linha 1 é cabeçalho e começamos em 0
      const values = parseCSVLine(line);
      const row: any = {};

      // Cria objeto com valores
      headers.forEach((header, index) => {
        row[header.trim()] = values[index]?.trim() || '';
      });

      // Valida campos obrigatórios na linha
      for (const field of REQUIRED_FIELDS) {
        if (!row[field] || row[field].trim() === '') {
          result.errors.push(`Linha ${rowNumber}: Campo obrigatório '${field}' está vazio`);
          result.isValid = false;
        }
      }

      // Valida formato do participantId canônico (8 dígitos)
      if (row.participantId) {
        const participantId = String(row.participantId).trim();
        if (!/^\d{8}$/.test(participantId)) {
          result.errors.push(`Linha ${rowNumber}: participantId deve ter exatamente 8 dígitos numéricos`);
          result.isValid = false;
        }
      }

      // Valida quantity (se presente)
      if (row.quantity) {
        const quantity = parseFloat(row.quantity);
        if (isNaN(quantity) || quantity <= 0) {
          result.errors.push(`Linha ${rowNumber}: quantity deve ser um número maior que zero`);
          result.isValid = false;
        }
      }

      // Valida quality (se presente) - deve ser 0, 1 ou 2
      if (row.quality !== undefined && row.quality !== null && row.quality !== '') {
        const quality = parseInt(row.quality);
        if (isNaN(quality) || (quality !== 0 && quality !== 1 && quality !== 2)) {
          result.errors.push(`Linha ${rowNumber}: quality deve ser 0 (Não avaliada), 1 (Adequada) ou 2 (Inadequada)`);
          result.isValid = false;
        }
      }

      result.sampleRows.push(row);
    }

    // Limita número de erros exibidos
    if (result.errors.length > 20) {
      const remaining = result.errors.length - 20;
      result.errors = result.errors.slice(0, 20);
      result.errors.push(`... e mais ${remaining} erro(s). Corrija os erros acima primeiro.`);
    }

  } catch (error: any) {
    result.isValid = false;
    result.errors.push(`Erro ao processar arquivo CSV: ${error.message}`);
  }

  return result;
}

/**
 * Parse uma linha CSV (suporta valores entre aspas)
 */
function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Aspas duplas escapadas
        current += '"';
        i++; // Pula próximo caractere
      } else {
        // Toggle aspas
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // Separador fora de aspas
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  // Adiciona último valor
  values.push(current);

  return values;
}

/**
 * Valida estrutura básica do CSV
 */
export function validateCSVStructure(text: string): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!text || text.trim() === '') {
    errors.push('Arquivo CSV está vazio');
    return { isValid: false, errors };
  }

  const lines = text.split('\n').filter(line => line.trim() !== '');
  if (lines.length < 2) {
    errors.push('Arquivo CSV deve conter pelo menos um cabeçalho e uma linha de dados');
    return { isValid: false, errors };
  }

  // Verifica se tem vírgulas (separador CSV)
  if (!lines[0].includes(',') && !lines[0].includes(';')) {
    errors.push('Arquivo não parece ser um CSV válido (sem separadores)');
    return { isValid: false, errors };
  }

  return { isValid: true, errors: [] };
}

