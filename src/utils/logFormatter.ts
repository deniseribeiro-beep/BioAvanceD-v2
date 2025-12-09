/**
 * Utilitário para formatar dados de logs para exibição
 * Trata tipos especiais e objetos complexos de forma legível
 */

/**
 * Formata um valor para exibição em JSON de forma legível
 * Trata tipos especiais como ObjectId, Date, Buffer, etc.
 */
export function formatLogValue(value: any, indent: number = 0): string {
  if (value === null) {
    return 'null';
  }

  if (value === undefined) {
    return 'undefined';
  }

  // Trata objetos com _type especial (vindos da serialização do backend)
  if (typeof value === 'object' && value._type) {
    switch (value._type) {
      case 'ObjectId':
        return `ObjectId("${value._value}")`;
      case 'Date':
        return `Date("${value._value}")` + (value._formatted ? ` // ${value._formatted}` : '');
      case 'Buffer':
        return `Buffer(${value._size} bytes)`;
      default:
        return JSON.stringify(value, null, 2);
    }
  }

  // Trata Date
  if (value instanceof Date) {
    const iso = value.toISOString();
    const formatted = value.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    return `Date("${iso}") // ${formatted}`;
  }

  // Trata arrays
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    const items = value.map((item, index) => {
      const formatted = formatLogValue(item, indent + 1);
      const indentation = '  '.repeat(indent + 1);
      return `${indentation}${formatted}${index < value.length - 1 ? ',' : ''}`;
    });
    const arrayIndent = '  '.repeat(indent);
    return `[\n${items.join('\n')}\n${arrayIndent}]`;
  }

  // Trata objetos
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      return '{}';
    }
    const items = keys.map((key, index) => {
      const formatted = formatLogValue(value[key], indent + 1);
      const indentation = '  '.repeat(indent + 1);
      const comma = index < keys.length - 1 ? ',' : '';
      return `${indentation}"${key}": ${formatted}${comma}`;
    });
    const objIndent = '  '.repeat(indent);
    return `{\n${items.join('\n')}\n${objIndent}}`;
  }

  // Valores primitivos
  if (typeof value === 'string') {
    // Escapa caracteres especiais em strings
    return JSON.stringify(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return String(value);
}

/**
 * Formata um objeto/valor para JSON legível com suporte a tipos especiais
 */
export function formatLogJSON(value: any): string {
  try {
    // Primeiro tenta fazer um parse profundo para tratar tipos especiais
    const processed = processValue(value, new Set());
    const jsonStr = JSON.stringify(processed, null, 2);
    
    // Se JSON.stringify retornar undefined ou null, tenta método alternativo
    if (!jsonStr || jsonStr === 'null' || jsonStr === 'undefined') {
      return formatLogValue(value, 0);
    }
    
    return jsonStr;
  } catch (error) {
    console.warn('Erro ao formatar JSON, tentando método alternativo:', error);
    try {
      // Se falhar, usa formatação personalizada
      return formatLogValue(value, 0);
    } catch (e) {
      // Se ainda falhar, retorna representação simples
      return String(value);
    }
  }
}

/**
 * Processa um valor recursivamente, convertendo tipos especiais
 */
function processValue(value: any, visited: Set<any> = new Set(), depth: number = 0): any {
  // Proteção contra profundidade excessiva
  if (depth > 10) {
    return '[Profundidade máxima atingida]';
  }

  // Proteção contra referências circulares
  if (typeof value === 'object' && value !== null) {
    try {
      if (visited.has(value)) {
        return '[Referência circular]';
      }
      visited.add(value);
    } catch (e) {
      // Se não puder adicionar ao Set (ex: valor primitivo), continua
    }
  }

  // Trata objetos com _type especial
  if (typeof value === 'object' && value !== null && value._type) {
    switch (value._type) {
      case 'ObjectId':
        return `ObjectId("${value._value}")`;
      case 'Date':
        return value._formatted 
          ? `Date(${value._value}) // ${value._formatted}`
          : `Date(${value._value})`;
      case 'Buffer':
        return `Buffer(${value._size} bytes)`;
      default:
        return value;
    }
  }

  // Trata Date
  if (value instanceof Date) {
    const formatted = value.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    return {
      _type: 'Date',
      _value: value.toISOString(),
      _formatted: formatted
    };
  }

  // Trata arrays
  if (Array.isArray(value)) {
    try {
      return value.map(item => processValue(item, visited, depth + 1));
    } catch (e) {
      return '[Erro ao processar array]';
    }
  }

  // Trata objetos
  if (typeof value === 'object' && value !== null) {
    try {
      const processed: any = {};
      for (const key in value) {
        try {
          if (value.hasOwnProperty(key) && !key.startsWith('$') && key !== '__proto__') {
            processed[key] = processValue(value[key], visited, depth + 1);
          }
        } catch (e) {
          processed[key] = '[Erro ao processar propriedade]';
        }
      }
      return processed;
    } catch (e) {
      return '[Erro ao processar objeto]';
    }
  }

  return value;
}

/**
 * Formata payload para exibição
 */
export function formatPayload(payload: any): string {
  try {
    if (!payload) {
      return 'N/A';
    }

    return formatLogJSON(payload);
  } catch (error) {
    console.error('Erro ao formatar payload:', error);
    try {
      // Tenta formatar de forma mais simples
      return JSON.stringify(payload, null, 2);
    } catch (e) {
      return String(payload);
    }
  }
}

/**
 * Formata metadata para exibição
 */
export function formatMetadata(metadata: any): string {
  try {
    if (!metadata) {
      return 'N/A';
    }

    return formatLogJSON(metadata);
  } catch (error) {
    console.error('Erro ao formatar metadata:', error);
    try {
      // Tenta formatar de forma mais simples
      return JSON.stringify(metadata, null, 2);
    } catch (e) {
      return String(metadata);
    }
  }
}

/**
 * Extrai informações legíveis de um payload
 * Útil para exibir informações resumidas
 */
export function extractPayloadSummary(payload: any): string {
  try {
    if (!payload) {
      return 'N/A';
    }

    if (typeof payload === 'string') {
      return payload.length > 100 ? payload.substring(0, 100) + '...' : payload;
    }

    if (typeof payload !== 'object') {
      return String(payload);
    }

    // Trata arrays
    if (Array.isArray(payload)) {
      return `[${payload.length} item(s)]`;
    }

    // Tenta extrair informações úteis
    const keys = Object.keys(payload);
    if (keys.length === 0) {
      return '{}';
    }

    // Para objetos pequenos, mostra todas as chaves
    if (keys.length <= 5) {
      const summary = keys.slice(0, 5).map(key => {
        try {
          const value = payload[key];
          let valueStr = '...';
          if (value === null) {
            valueStr = 'null';
          } else if (value === undefined) {
            valueStr = 'undefined';
          } else if (typeof value === 'string') {
            valueStr = value.length <= 30 ? `"${value}"` : `"${value.substring(0, 30)}..."`;
          } else if (typeof value === 'number' || typeof value === 'boolean') {
            valueStr = String(value);
          } else if (typeof value === 'object') {
            if (value._type) {
              valueStr = `${value._type}(${value._value || value._size || ''})`;
            } else if (Array.isArray(value)) {
              valueStr = `[${value.length} item(s)]`;
            } else {
              valueStr = '{...}';
            }
          } else {
            valueStr = String(value);
          }
          return `${key}: ${valueStr}`;
        } catch (e) {
          return `${key}: [erro]`;
        }
      }).join(', ');
      return `{ ${summary} }`;
    }

    // Para objetos grandes, mostra apenas o número de propriedades
    return `{ ${keys.length} propriedades... }`;
  } catch (error) {
    console.error('Erro ao extrair resumo do payload:', error);
    return '[Erro ao processar payload]';
  }
}

