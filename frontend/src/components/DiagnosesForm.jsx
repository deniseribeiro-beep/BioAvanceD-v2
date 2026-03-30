import React, { useState } from 'react';
import HPOAutocomplete from './HPOAutocomplete';

// DiagnosesForm: Formulário dinâmico para múltiplos diagnósticos, cada um com seus fenótipos HPO
export default function DiagnosesForm({ value = [], onChange }) {
  // Atualiza o array de diagnósticos
  const setDiagnoses = (next) => onChange?.(next);

  // Adiciona novo diagnóstico
  const addDiagnosis = () => setDiagnoses([
    ...value,
    {
      isMainDiagnosis: value.length === 0, // O primeiro é principal por padrão
      disease: { cid: '', orpha: '', omim: '', name: '' },
      phenotypes: []
    }
  ]);

  // Remove diagnóstico
  const removeDiagnosis = (idx) => setDiagnoses(value.filter((_, i) => i !== idx));

  // Atualiza campo do diagnóstico
  const updateDiagnosis = (idx, field, fieldValue) => {
    const next = value.map((d, i) => i === idx ? { ...d, [field]: fieldValue } : d);
    setDiagnoses(next);
  };

  // Atualiza doença
  const updateDisease = (idx, diseaseField, diseaseValue) => {
    const next = value.map((d, i) =>
      i === idx ? { ...d, disease: { ...d.disease, [diseaseField]: diseaseValue } } : d
    );
    setDiagnoses(next);
  };

  // Adiciona fenótipo HPO
  const addPhenotype = (idx, pheno) => {
    const next = value.map((d, i) =>
      i === idx
        ? { ...d, phenotypes: d.phenotypes.some(p => p.hpoId === pheno.hpoId) ? d.phenotypes : [...d.phenotypes, pheno] }
        : d
    );
    setDiagnoses(next);
  };

  // Remove fenótipo HPO
  const removePhenotype = (idx, hpoId) => {
    const next = value.map((d, i) =>
      i === idx ? { ...d, phenotypes: d.phenotypes.filter(p => p.hpoId !== hpoId) } : d
    );
    setDiagnoses(next);
  };

  // Define diagnóstico principal
  const setMainDiagnosis = (idx) => {
    const next = value.map((d, i) => ({ ...d, isMainDiagnosis: i === idx }));
    setDiagnoses(next);
  };

  return (
    <div>
      <h3>Diagnósticos</h3>
      {value.map((diag, idx) => (
        <div key={idx} style={{ border: '1px solid #ccc', borderRadius: 8, padding: 16, marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <label>
              <input
                type="radio"
                checked={diag.isMainDiagnosis}
                onChange={() => setMainDiagnosis(idx)}
                name="mainDiagnosis"
              /> Diagnóstico Principal
            </label>
            <button type="button" onClick={() => removeDiagnosis(idx)} style={{ color: '#c00', marginLeft: 'auto' }}>
              Remover Diagnóstico
            </button>
          </div>
          <div style={{ marginTop: 12 }}>
            <label>
              CID:
              <input
                type="text"
                value={diag.disease.cid}
                onChange={e => updateDisease(idx, 'cid', e.target.value)}
                placeholder="Ex: E75.2"
                style={{ marginLeft: 8 }}
              />
            </label>
            <label style={{ marginLeft: 16 }}>
              Orpha:
              <input
                type="text"
                value={diag.disease.orpha}
                onChange={e => updateDisease(idx, 'orpha', e.target.value)}
                placeholder="Ex: ORPHA:324"
                style={{ marginLeft: 8 }}
              />
            </label>
            <label style={{ marginLeft: 16 }}>
              OMIM:
              <input
                type="text"
                value={diag.disease.omim}
                onChange={e => updateDisease(idx, 'omim', e.target.value)}
                placeholder="Ex: OMIM:301500"
                style={{ marginLeft: 8 }}
              />
            </label>
            <label style={{ marginLeft: 16 }}>
              Nome:
              <input
                type="text"
                value={diag.disease.name}
                onChange={e => updateDisease(idx, 'name', e.target.value)}
                placeholder="Nome da doença"
                style={{ marginLeft: 8 }}
              />
            </label>
          </div>
          <div style={{ marginTop: 16 }}>
            <strong>Fenótipos HPO:</strong>
            <HPOAutocomplete onSelect={pheno => addPhenotype(idx, pheno)} placeholder="Buscar fenótipo HPO..." />
            <ul style={{ marginTop: 8 }}>
              {diag.phenotypes.map(pheno => (
                <li key={pheno.hpoId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{pheno.label} <span style={{ color: '#888' }}>({pheno.hpoId})</span></span>
                  <button type="button" onClick={() => removePhenotype(idx, pheno.hpoId)} style={{ color: '#c00' }}>Remover</button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}
      <button type="button" onClick={addDiagnosis} style={{ background: '#1976d2', color: '#fff', borderRadius: 6, padding: '8px 16px' }}>
        + Adicionar Diagnóstico
      </button>
    </div>
  );
}
