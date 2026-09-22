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

const patients: Array<{ id: string; label: string }> = [];
const samplesByPatient: Record<string, Array<{ id: string; label: string }>> = {};
const tcles: Array<{ id: string; label: string }> = [];

const ClinicalLinker: React.FC = () => {
  const [participantId, setParticipantId] = useState('');
  const [specimenId, setSpecimenId] = useState('');
  const [tcleId, setTcleId] = useState('');
  const [showToast, setShowToast] = useState(false);

  const handlePatientChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setParticipantId(e.target.value);
    setSpecimenId('');
  };

  const handleSampleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSpecimenId(e.target.value);
  };

  const handleTcleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setTcleId(e.target.value);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = { participantId, specimenId, tcleId };
    void payload;
    setShowToast(false);
    // console.log('Payload enviado:', payload);
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-md mx-auto p-6 bg-white rounded shadow">
      <h2 className="text-xl font-bold mb-4">Vínculo Clínico</h2>
      <div className="mb-4">
        <label className="block mb-1 font-medium">Paciente</label>
        <SelectComponent
          value={participantId}
          onChange={handlePatientChange}
          required
          options={[
            { value: '', label: 'Selecione um paciente' },
            ...patients.map((p) => ({ value: p.id, label: p.label })),
          ]}
        />
        {patients.length === 0 && <p className="text-sm text-gray-500 mt-1">Nenhum paciente cadastrado.</p>}
      </div>
      <div className="mb-4">
        <label className="block mb-1 font-medium">Amostra</label>
        <SelectComponent
          value={specimenId}
          onChange={handleSampleChange}
          required
          disabled={!participantId}
          options={[
            { value: '', label: 'Selecione uma amostra' },
            ...(participantId && samplesByPatient[participantId]
              ? samplesByPatient[participantId].map((s) => ({ value: s.id, label: s.label }))
              : []),
          ]}
        />
        {participantId && !samplesByPatient[participantId]?.length && <p className="text-sm text-gray-500 mt-1">Nenhuma amostra vinculada.</p>}
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
        {tcles.length === 0 && <p className="text-sm text-gray-500 mt-1">Nenhum TCLE disponível.</p>}
      </div>
      <ButtonComponent type="submit" className="w-full" disabled={!participantId || !specimenId || !tcleId}
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
