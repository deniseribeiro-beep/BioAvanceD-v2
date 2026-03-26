import React, { useState } from 'react';
import Select from './UI/Select'; // fallback para evitar erro de import
import Button from './UI/Button';
import Toast from './UI/Toast';

// Tentar import correto para estrutura do projeto
// @ts-ignore
import SelectFallback from '../components/UI/Select';
// @ts-ignore
import ButtonFallback from '../components/UI/Button';
// @ts-ignore
import ToastFallback from '../components/UI/Toast';

const SelectComponent = SelectFallback || Select;
const ButtonComponent = ButtonFallback || Button;
const ToastComponent = ToastFallback || Toast;

// Simulated data
const patients = [
  { id: '1', label: 'João da Silva - CPF: 111.***.***-11' },
  { id: '2', label: 'Maria Oliveira - CPF: 222.***.***-22' },
];

const samplesByPatient = {
  '1': [
    { id: 's1', label: 'BIO-2024-001 - Sangue Periférico' },
    { id: 's2', label: 'BIO-2024-002 - Plasma' },
  ],
  '2': [
    { id: 's3', label: 'BIO-2024-003 - Soro' },
  ],
};

const tcles = [
  { id: 't1', label: 'TCLE Padrão Genética - v2.0' },
  { id: 't2', label: 'TCLE Oncologia - v1.5' },
];

const ClinicalLinker: React.FC = () => {
  const [patientId, setPatientId] = useState('');
  const [sampleId, setSampleId] = useState('');
  const [tcleId, setTcleId] = useState('');
  const [showToast, setShowToast] = useState(false);

  const handlePatientChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setPatientId(e.target.value);
    setSampleId('');
  };

  const handleSampleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSampleId(e.target.value);
  };

  const handleTcleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setTcleId(e.target.value);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Simulate sending payload
    const payload = { patientId, sampleId, tcleId };
    // Simulate API call
    setTimeout(() => {
      setShowToast(true);
      setTimeout(() => setShowToast(false), 3000);
    }, 500);
    // console.log('Payload enviado:', payload);
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-md mx-auto p-6 bg-white rounded shadow">
      <h2 className="text-xl font-bold mb-4">Vínculo Clínico</h2>
      <div className="mb-4">
        <label className="block mb-1 font-medium">Paciente</label>
        <SelectComponent
          value={patientId}
          onChange={handlePatientChange}
          required
          options={[
            { value: '', label: 'Selecione um paciente' },
            ...patients.map((p) => ({ value: p.id, label: p.label })),
          ]}
        />
      </div>
      <div className="mb-4">
        <label className="block mb-1 font-medium">Amostra</label>
        <SelectComponent
          value={sampleId}
          onChange={handleSampleChange}
          required
          disabled={!patientId}
          options={[
            { value: '', label: 'Selecione uma amostra' },
            ...(patientId && samplesByPatient[patientId]
              ? samplesByPatient[patientId].map((s) => ({ value: s.id, label: s.label }))
              : []),
          ]}
        />
      </div>
      <div className="mb-4">
        <label className="block mb-1 font-medium">TCLE</label>
        <SelectComponent
          value={tcleId}
          onChange={handleTcleChange}
          required
          options={[
            { value: '', label: 'Selecione um TCLE' },
            ...tcles.map((t) => ({ value: t.id, label: t.label })),
          ]}
        />
      </div>
      <ButtonComponent type="submit" className="w-full" disabled={!patientId || !sampleId || !tcleId}
        >Gerar Vínculo e Solicitar Assinatura</ButtonComponent>
      {showToast && (
        <ToastComponent
          type="success"
          message="Vínculo gerado e solicitação enviada com sucesso!"
          onClose={() => setShowToast(false)}
        />
      )}
    </form>
  );
};

export default ClinicalLinker;
