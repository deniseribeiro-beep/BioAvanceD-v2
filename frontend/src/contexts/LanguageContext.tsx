import { createContext, useContext, useState, useMemo, useCallback, ReactNode } from 'react';
import { setLanguage, getLanguage, initLanguage, Language } from '../i18n';
import ptBR from '../i18n/pt-BR.json';
import enUS from '../i18n/en-US.json';
import esES from '../i18n/es-ES.json';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, fallback?: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Inicializa o idioma apenas uma vez no useState
  const [language, setLanguageState] = useState<Language>(() => {
    // Inicializa o idioma do localStorage ou navegador
    return initLanguage();
  });

  // Remove useEffect duplicado que causava re-renderizações desnecessárias
  // O idioma já é inicializado no useState acima

  const handleSetLanguage = useCallback((lang: Language) => {
    setLanguage(lang);
    setLanguageState(lang);
    // Força re-render de todos os componentes que usam traduções
    // Mas apenas se o idioma realmente mudou
    if (lang !== language) {
      window.dispatchEvent(new Event('languagechange'));
    }
  }, [language]);

  // Recria a função t quando o idioma muda
  const t = useMemo(() => {
    return (key: string, fallback?: string) => {
      // Usa o idioma atual do estado, não da variável global
      const keys = key.split('.');
      const dictMap: Record<Language, any> = {
        'pt-BR': ptBR,
        'en-US': enUS,
        'es-ES': esES,
      };
      const langTranslations = dictMap[language] || ptBR;

      let value: any = langTranslations;
      for (const k of keys) {
        if (value && typeof value === 'object' && k in value) {
          value = value[k];
        } else {
          // Fallback para pt-BR
          if (language !== 'pt-BR') {
            let ptValue: any = ptBR;
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
    };
  }, [language]);

  // Memoiza o valor do contexto para evitar re-renderizações desnecessárias
  const contextValue = useMemo(() => ({
    language,
    setLanguage: handleSetLanguage,
    t
  }), [language, handleSetLanguage, t]);

  return (
    <LanguageContext.Provider value={contextValue}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}

