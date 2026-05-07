import React, { useState, useMemo } from 'react';

/**
 * HPOAutocomplete - Componente de busca/autocomplete para termos HPO
 * Props:
 *   onSelect: (item: { hpoId: string, label: string }) => void
 */
export default function HPOAutocomplete({ onSelect, placeholder = 'Buscar fenótipo HPO...' }) {
  const [input, setInput] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [debounceTimer, setDebounceTimer] = useState(null);

  const getApiBaseUrl = () => {
    const configured = import.meta.env.VITE_API_BASE_URL;
    if (configured) {
      return String(configured).replace(/\/$/, '').replace(/\/api$/, '');
    }

    const hostname = window.location.hostname;
    const protocol = window.location.protocol;
    return `${protocol}//${hostname}:3000`;
  };

  // Debounce para evitar requisições excessivas
  const handleInputChange = (e) => {
    const value = e.target.value;
    setInput(value);
    setError('');
    setResults([]);
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!value.trim()) return;
    setDebounceTimer(setTimeout(() => searchHPO(value), 400));
  };

  const searchHPO = async (query) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/hpo/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error('Erro ao buscar termos HPO');
      const data = await res.json();
      setResults(
        (Array.isArray(data) ? data : []).slice(0, 10).map((doc) => ({
          hpoId: doc.hpoId || doc.id,
          label: doc.label,
        }))
        .filter((doc) => doc.hpoId && doc.label)
      );
    } catch (err) {
      setError('Erro ao buscar termos HPO');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="hpo-autocomplete">
      <input
        type="text"
        value={input}
        onChange={handleInputChange}
        placeholder={placeholder}
        className="hpo-autocomplete__input"
        autoComplete="off"
      />
      {loading && <div className="hpo-autocomplete__loading">Buscando...</div>}
      {error && <div className="hpo-autocomplete__error">{error}</div>}
      {results.length > 0 && (
        <ul className="hpo-autocomplete__results">
          {results.map((item) => (
            <li
              key={item.hpoId}
              className="hpo-autocomplete__result"
              onClick={() => {
                onSelect(item);
                setInput(`${item.label} (${item.hpoId})`);
                setResults([]);
              }}
            >
              <strong>{item.label}</strong> <span style={{ color: '#888' }}>{item.hpoId}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
