import ptBR from './pt-BR.json';
import enUS from './en-US.json';
import esES from './es-ES.json';

export type Language = 'pt-BR' | 'en-US' | 'es-ES';

const translations: Record<Language, any> = {
  'pt-BR': ptBR,
  'en-US': enUS,
  'es-ES': esES,
};

let currentLanguage: Language = 'pt-BR';

/**
 * Define o idioma atual do sistema
 */
export function setLanguage(lang: Language): void {
  if (translations[lang]) {
    currentLanguage = lang;
    // Salva no localStorage para persistência
    if (typeof window !== 'undefined') {
      localStorage.setItem('app_language', lang);
    }
  }
}

/**
 * Retorna o idioma atual
 */
export function getLanguage(): Language {
  return currentLanguage;
}

/**
 * Inicializa o idioma a partir do localStorage ou navegador
 */
export function initLanguage(): Language {
  if (typeof window === 'undefined') {
    return 'pt-BR';
  }

  // Tenta carregar do localStorage
  const savedLang = localStorage.getItem('app_language') as Language;
  if (savedLang && translations[savedLang]) {
    currentLanguage = savedLang;
    return savedLang;
  }

  // Tenta detectar do navegador
  const browserLang = navigator.language || (navigator as any).userLanguage;
  if (browserLang) {
    if (browserLang.startsWith('en')) {
      currentLanguage = 'en-US';
      return 'en-US';
    }
    if (browserLang.startsWith('es')) {
      currentLanguage = 'es-ES';
      return 'es-ES';
    }
    if (browserLang.startsWith('pt')) {
      currentLanguage = 'pt-BR';
      return 'pt-BR';
    }
  }

  // Padrão: pt-BR
  currentLanguage = 'pt-BR';
  return 'pt-BR';
}

/**
 * Função de tradução com fallback automático
 * @param key - Chave de tradução (ex: "auth.login" ou "common.save")
 * @param fallback - Texto de fallback caso a chave não exista (opcional)
 * @returns Texto traduzido
 */
export function t(key: string, fallback?: string): string {
  const keys = key.split('.');
  let value: any = translations[currentLanguage];

  // Navega pela estrutura do objeto
  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = value[k];
    } else {
      // Fallback para pt-BR se não encontrar no idioma atual
      if (currentLanguage !== 'pt-BR') {
        let ptValue: any = translations['pt-BR'];
        for (const ptKey of keys) {
          if (ptValue && typeof ptValue === 'object' && ptKey in ptValue) {
            ptValue = ptValue[ptKey];
          } else {
            return fallback || key;
          }
        }
        return ptValue || fallback || key;
      }
      return fallback || key;
    }
  }

  return typeof value === 'string' ? value : (fallback || key);
}

// Inicializa o idioma ao carregar o módulo
if (typeof window !== 'undefined') {
  initLanguage();
}

export default {
  setLanguage,
  getLanguage,
  initLanguage,
  t,
};

