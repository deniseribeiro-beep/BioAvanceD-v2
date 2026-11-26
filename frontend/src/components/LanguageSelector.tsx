import { useLanguage } from '../contexts/LanguageContext';
import { Globe } from 'lucide-react';

export default function LanguageSelector() {
  const { language, setLanguage, t } = useLanguage();
  const selectId = 'language-selector';

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLang = e.target.value as 'pt-BR' | 'en-US' | 'es-ES';
    setLanguage(newLang);
  };

  return (
    <div
      className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-muted-foreground"
      data-testid="language-selector-container"
    >
      <Globe size={16} aria-hidden="true" />
      <label htmlFor={selectId} className="sr-only">
        {t('app.language')}
      </label>
      <select
        id={selectId}
        name="language"
        data-testid="language-selector"
        value={language}
        onChange={handleLanguageChange}
        className="border-0 bg-transparent text-sm text-foreground focus:outline-none focus:ring-0"
        aria-label={t('app.language')}
      >
        <option value="pt-BR" data-testid="language-option-pt-BR">
          {t('app.portuguese')}
        </option>
        <option value="en-US" data-testid="language-option-en-US">
          {t('app.english')}
        </option>
        <option value="es-ES" data-testid="language-option-es-ES">
          {t('app.spanish')}
        </option>
      </select>
    </div>
  );
}
