import React, { useState, useRef, useEffect } from 'react';
import Spinner from './UI/Spinner';

interface CidItem {
  _id?: string;
  Codigo_Tabulacao?: string;
  Descricao?: string;
  Codigos_CID10?: string;
}

interface CidAsyncAutocompleteProps {
  value: CidItem | null;
  onChange: (cid: CidItem | null) => void;
  placeholder?: string;
}

const CidAsyncAutocomplete: React.FC<CidAsyncAutocompleteProps> = ({ value, onChange, placeholder }) => {
  const [inputValue, setInputValue] = useState('');
  const [options, setOptions] = useState<CidItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [noResults, setNoResults] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (inputValue.length < 2) {
      setOptions([]);
      setNoResults(false);
      setShowDropdown(false);
      return;
    }
    setIsLoading(true);
    setNoResults(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetch(`/api/cid/search?q=${encodeURIComponent(inputValue)}`)
        .then((res) => res.json())
        .then((data) => {
          setOptions(data || []);
          setNoResults((data || []).length === 0);
          setShowDropdown(true);
        })
        .catch(() => {
          setOptions([]);
          setNoResults(true);
        })
        .finally(() => setIsLoading(false));
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [inputValue]);

  const handleSelect = (cid: CidItem) => {
    onChange(cid);
    setInputValue(cid.Codigo_Tabulacao + ' - ' + cid.Descricao);
    setShowDropdown(false);
  };

  return (
    <div style={{ position: 'relative', width: 350 }}>
      <input
        type="text"
        value={inputValue}
        placeholder={placeholder || 'Buscar CID...'}
        onChange={e => {
          setInputValue(e.target.value);
          setShowDropdown(true);
        }}
        onFocus={() => inputValue.length >= 2 && setShowDropdown(true)}
        style={{ width: '100%', padding: '8px', borderRadius: 4, border: '1px solid #ccc' }}
      />
      {isLoading && (
        <div style={{ position: 'absolute', right: 10, top: 10, fontSize: 12 }}><Spinner size="sm" label="Buscando..." /></div>
      )}
      {showDropdown && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          background: '#fff',
          border: '1px solid #ccc',
          borderTop: 'none',
          zIndex: 10,
          maxHeight: 220,
          overflowY: 'auto',
        }}>
          {noResults ? (
            <div style={{ padding: 8, color: '#888' }}>Nenhum código encontrado</div>
          ) : (
            options.map((cid) => (
              <div
                key={cid._id || cid.Codigo_Tabulacao}
                style={{ padding: 8, cursor: 'pointer', borderBottom: '1px solid #eee' }}
                onClick={() => handleSelect(cid)}
              >
                <strong>{cid.Codigo_Tabulacao}</strong> - {cid.Descricao}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default CidAsyncAutocomplete;
