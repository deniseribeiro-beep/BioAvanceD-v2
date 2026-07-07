import React, { useState } from 'react';
import { apiClient } from '../api/client';
import { extractResponseItems } from '../api/response.adapters';

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
      const response = await apiClient.get('/hpo/search', {
        params: { q: query },
        suppressErrorToast: true,
      });
      const data = extractResponseItems(response);
      setResults(
        data.slice(0, 10).map((doc) => ({
          hpoId: String(doc.hpoId || doc.id || doc.code || doc.codigo || '').trim(),
          label: String(doc.label || doc.display || doc.name || doc.descricao || doc.description || '').trim(),
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
