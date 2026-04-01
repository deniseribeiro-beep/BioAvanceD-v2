
import React, { useState } from 'react';
import axios from 'axios';
import { z } from 'zod';
import CascadingSuggestion from '../../../components/CascadingSuggestion';
import { SemanticCascadeState } from '../../../hooks/useSemanticCascade';

const Step1Schema = z.object({
  pseudoId: z.string().min(4, 'ID obrigatório'),
  tcleAccepted: z.boolean(),
});
const Step2Schema = z.object({
  orpha: z.object({
    system: z.string().min(1),
    code: z.string().min(1),
    display: z.string().min(1),
  }),
  hpo: z.array(z.object({
    system: z.string().min(1),
    code: z.string().min(1),
    display: z.string().min(1),
  })).min(1, 'Selecione pelo menos um fenotipo'),
});
const Step3Schema = z.object({
  volume: z.number().positive('Volume obrigatório'),
  aditivo: z.enum(['EDTA', 'Heparina', 'Outro']),
  tempoIsquemia: z.number().min(0, 'Tempo obrigatório'),
  temperatura: z.number(),
});
const Step4Schema = z.object({
  freezer: z.string().min(1, 'Obrigatório'),
  rack: z.string().min(1, 'Obrigatório'),
  caixa: z.string().min(1, 'Obrigatório'),
  posicao: z.string().min(1, 'Obrigatório'),
});

export default function IntakeWizardPage() {
  const [step, setStep] = useState(1);
  const [data, setData] = useState({});
  const [errors, setErrors] = useState({});

  const handleSemanticChange = (semantic: SemanticCascadeState) => {
    setData((prev) => ({
      ...prev,
      orpha: semantic.disease,
      hpo: semantic.phenotypes,
      biomarkers: semantic.biomarkers,
    }));
  };

  function calcularQualidade(tempoIsquemia, temperatura) {
    if (tempoIsquemia <= 30 && temperatura <= 8) return 'Ótima';
    if (tempoIsquemia <= 60 && temperatura <= 20) return 'Subótima';
    return 'Ruim';
  }

  function handleNext(values) {
    let schema;
    if (step === 1) schema = Step1Schema;
    if (step === 2) schema = Step2Schema;
    if (step === 3) schema = Step3Schema;
    if (step === 4) schema = Step4Schema;
    const result = schema.safeParse(values);
    if (!result.success) {
      setErrors(result.error.flatten().fieldErrors);
      return;
    }
    setData(prev => ({ ...prev, ...values }));
    setErrors({});
    if (step < 4) setStep(step + 1);
    else submitAll({ ...data, ...values });
  }

  async function submitAll(finalData) {
    // Monta um Bundle FHIR mínimo para envio
    const bundle = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: finalData.pseudoId,
            name: [{ text: finalData.pseudoId }],
            extension: [
              { url: 'http://bioavanced.local/StructureDefinition/tcleAccepted', valueBoolean: finalData.tcleAccepted }
            ]
          }
        },
        {
          resource: {
            resourceType: 'Specimen',
            id: `${finalData.pseudoId}-sample`,
            subject: { reference: `Patient/${finalData.pseudoId}` },
            type: {
              coding: [
                { system: finalData.orpha?.system, code: finalData.orpha?.code, display: finalData.orpha?.display }
              ]
            },
            extension: [
              { url: 'http://bioavanced.local/StructureDefinition/volume', valueQuantity: { value: finalData.volume, unit: 'ml' } },
              { url: 'http://bioavanced.local/StructureDefinition/aditivo', valueString: finalData.aditivo },
              { url: 'http://bioavanced.local/StructureDefinition/tempoIsquemia', valueInteger: finalData.tempoIsquemia },
              { url: 'http://bioavanced.local/StructureDefinition/temperatura', valueDecimal: finalData.temperatura }
            ]
          }
        },
        ...((finalData.hpo || []).map((h, idx) => ({
          resource: {
            resourceType: 'Observation',
            id: `${finalData.pseudoId}-obs${idx}`,
            subject: { reference: `Specimen/${finalData.pseudoId}-sample` },
            code: { coding: [{ system: h.system, code: h.code, display: h.display }] }
          }
        })))
      ]
    };
    try {
      const resp = await axios.post('/api/import/fhir-intelligent', bundle);
      alert('Importação FHIR inteligente realizada! ' + JSON.stringify(resp.data));
    } catch (err) {
      alert('Erro ao importar FHIR: ' + (err?.response?.data?.error || err.message));
    }
  }

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <h2>Wizard de Cadastro de Amostra</h2>
      {step === 1 && (
        <div>
          <h3>Passo 1: Identificação & e-Consent</h3>
          <input placeholder="ID Pseudonimizado" onChange={e => setData(d => ({ ...d, pseudoId: e.target.value }))} />
          <label>
            <input type="checkbox" onChange={e => setData(d => ({ ...d, tcleAccepted: e.target.checked }))} /> TCLE Aceito
          </label>
          {/* Aqui pode-se checar status de quarentena via API */}
          <button onClick={() => handleNext({ pseudoId: data.pseudoId, tcleAccepted: data.tcleAccepted })}>Próximo</button>
          {errors.pseudoId && <div style={{ color: 'red' }}>{errors.pseudoId}</div>}
        </div>
      )}
      {step === 2 && (
        <div>
          <h3>Passo 2: Anotacao Clinica</h3>
          <CascadingSuggestion onChange={handleSemanticChange} />
          {/* O Zod barra submissao se nao houver codigo ORPHA/HPO */}
          <button onClick={() => handleNext({ orpha: data.orpha, hpo: data.hpo })}>Próximo</button>
          {errors.orpha && <div style={{ color: 'red' }}>{errors.orpha}</div>}
        </div>
      )}
      {step === 3 && (
        <div>
          <h3>Passo 3: Dados Pré-Analíticos</h3>
          <input type="number" placeholder="Volume (ml)" onChange={e => setData(d => ({ ...d, volume: Number(e.target.value) }))} />
          <label htmlFor="aditivo-select">Aditivo</label>
          <select id="aditivo-select" onChange={e => setData(d => ({ ...d, aditivo: e.target.value }))}>
            <option value="">Selecione aditivo</option>
            <option value="EDTA">EDTA</option>
            <option value="Heparina">Heparina</option>
            <option value="Outro">Outro</option>
          </select>
          <input type="number" placeholder="Tempo de Isquemia (min)" onChange={e => setData(d => ({ ...d, tempoIsquemia: Number(e.target.value) }))} />
          <input type="number" placeholder="Temperatura (°C)" onChange={e => setData(d => ({ ...d, temperatura: Number(e.target.value) }))} />
          <div>Status de Qualidade: {calcularQualidade(data.tempoIsquemia, data.temperatura)}</div>
          <button onClick={() => handleNext({ volume: data.volume, aditivo: data.aditivo, tempoIsquemia: data.tempoIsquemia, temperatura: data.temperatura })}>Próximo</button>
          {errors.volume && <div style={{ color: 'red' }}>{errors.volume}</div>}
        </div>
      )}
      {step === 4 && (
        <div>
          <h3>Passo 4: Chain of Custody e Localização</h3>
          <input placeholder="Freezer" onChange={e => setData(d => ({ ...d, freezer: e.target.value }))} />
          <input placeholder="Rack" onChange={e => setData(d => ({ ...d, rack: e.target.value }))} />
          <input placeholder="Caixa" onChange={e => setData(d => ({ ...d, caixa: e.target.value }))} />
          <input placeholder="Posição" onChange={e => setData(d => ({ ...d, posicao: e.target.value }))} />
          <button onClick={() => handleNext({ freezer: data.freezer, rack: data.rack, caixa: data.caixa, posicao: data.posicao })}>Finalizar</button>
          {errors.freezer && <div style={{ color: 'red' }}>{errors.freezer}</div>}
        </div>
      )}
    </div>
  );
}