import { useLanguage } from '../contexts/LanguageContext';
import { Globe } from 'lucide-react';
import './LanguageSelector.css';

export default function LanguageSelector() {
  const { language, setLanguage, t } = useLanguage();
  const selectId = 'language-selector';

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLang = e.target.value as 'pt-BR' | 'en-US' | 'es-ES';
    setLanguage(newLang);
  };

  return (
    <div className="language-selector" data-testid="language-selector-container">
      <Globe size={18} />
      <label htmlFor={selectId} className="sr-only">
        {t('app.language')}
      </label>
      <select
        id={selectId}
        name="language"
        data-testid="language-selector"
        value={language}
        onChange={handleLanguageChange}
        className="language-select"
        aria-label={t('app.language')}
      >
        <option value="pt-BR" data-testid="language-option-pt-BR">{t('app.portuguese')}</option>
        <option value="en-US" data-testid="language-option-en-US">{t('app.english')}</option>
        <option value="es-ES" data-testid="language-option-es-ES">{t('app.spanish')}</option>
      </select>
    </div>
  );
}

