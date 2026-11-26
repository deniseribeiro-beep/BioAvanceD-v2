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
  currentLanguage = lang;
  // Salva no localStorage para persistência
  localStorage.setItem('app_language', lang);
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
  // Tenta carregar do localStorage
  const savedLang = localStorage.getItem('app_language') as Language;
  if (savedLang && translations[savedLang]) {
    currentLanguage = savedLang;
    return savedLang;
  }

  // Tenta detectar do navegador
  const browserLang = navigator.language;
  if (browserLang.startsWith('en')) {
    currentLanguage = 'en-US';
    return 'en-US';
  }
  if (browserLang.startsWith('es')) {
    currentLanguage = 'es-ES';
    return 'es-ES';
  }

  // Padrão: pt-BR
  currentLanguage = 'pt-BR';
  return 'pt-BR';
}

// Inicializa o idioma ao carregar o módulo
initLanguage();
