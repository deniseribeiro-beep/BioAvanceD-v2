import React, { useMemo, useState } from 'react';
import { SemanticCoding } from '../hooks/useSemanticCascade';

type AsyncTypeaheadDictionaryProps = {
  onSearch: (query: string) => Promise<SemanticCoding[]>;
  onSelect: (coding: SemanticCoding) => void;
  placeholder?: string;
};

export default function AsyncTypeaheadDictionary({ onSearch, onSelect, placeholder }: AsyncTypeaheadDictionaryProps) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<SemanticCoding[]>([]);
  const [loading, setLoading] = useState(false);

  const inputPlaceholder = useMemo(() => placeholder || 'Buscar doença ORPHA...', [placeholder]);

  const handleSearch = async (value: string) => {
    setQuery(value);
    const trimmed = String(value || '').trim();
    if (!trimmed) {
      setOptions([]);
      return;
    }

    setLoading(true);
    try {
      const nextOptions = await onSearch(trimmed);
      setOptions(Array.isArray(nextOptions) ? nextOptions : []);
    } catch {
      setOptions([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(event) => handleSearch(event.target.value)}
        placeholder={inputPlaceholder}
        autoComplete="off"
      />
      {loading && <div>Carregando...</div>}
      <ul>
        {options.map((option) => (
          <li
            key={`${option.system}:${option.code}`}
            onClick={() => onSelect(option)}
            style={{ cursor: 'pointer' }}
          >
            {option.display} ({option.code})
          </li>
        ))}
      </ul>
    </div>
  );
}
