import React from 'react';
import AsyncTypeaheadDictionary from './AsyncTypeaheadDictionary';
import { SemanticCascadeState, SemanticCoding, useSemanticCascade } from '../hooks/useSemanticCascade';

type CascadingSuggestionProps = {
  onChange?: (value: SemanticCascadeState) => void;
};

export default function CascadingSuggestion({ onChange }: CascadingSuggestionProps) {
  const {
    state,
    loadingSuggest,
    searchError,
    suggestError,
    searchDiseases,
    loadCascadeByDisease,
    retryLoadCascade,
  } = useSemanticCascade();

  const handleDiseaseSelect = async (disease: SemanticCoding) => {
    const nextState = await loadCascadeByDisease(disease);
    onChange?.(nextState);
  };

  return (
    <div>
      <h4>Buscar Doenca ORPHA</h4>
      <AsyncTypeaheadDictionary onSearch={searchDiseases} onSelect={handleDiseaseSelect} />
      {searchError && <div style={{ marginTop: 8, color: '#b45309' }}>{searchError}</div>}
      {loadingSuggest && (
        <div style={{ marginTop: 12 }}>
          <div style={{ height: 14, width: 220, background: '#e5e7eb', borderRadius: 4, marginBottom: 8 }} />
          <div style={{ height: 10, width: '100%', background: '#f3f4f6', borderRadius: 4, marginBottom: 6 }} />
          <div style={{ height: 10, width: '90%', background: '#f3f4f6', borderRadius: 4, marginBottom: 6 }} />
          <div style={{ height: 10, width: '80%', background: '#f3f4f6', borderRadius: 4 }} />
        </div>
      )}
      {!loadingSuggest && suggestError && (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ color: '#b91c1c' }}>{suggestError}</span>
          <button type="button" onClick={() => void retryLoadCascade()}>
            Tentar novamente
          </button>
        </div>
      )}
      {state.disease && (
        <div style={{ marginTop: 16 }}>
          <div>
            <strong>Doenca:</strong> {state.disease.display} ({state.disease.code})
          </div>
          <h5>Fenotipos (HPO) sugeridos:</h5>
          <div>
            {state.phenotypes.map((phenotype) => (
              <span key={`${phenotype.system}:${phenotype.code}`} style={{ border: '1px solid #ccc', borderRadius: 4, padding: '2px 8px', margin: 2, display: 'inline-block' }}>
                {phenotype.display} ({phenotype.code})
              </span>
            ))}
          </div>
          <h5>Biomarcadores sugeridos:</h5>
          <div>
            {state.biomarkers.map((biomarker) => (
              <span key={`${biomarker.system}:${biomarker.code}`} style={{ border: '1px solid #ccc', borderRadius: 4, padding: '2px 8px', margin: 2, display: 'inline-block' }}>
                {biomarker.display} ({biomarker.code})
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
