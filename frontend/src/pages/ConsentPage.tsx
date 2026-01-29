import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ConsentForm from '../components/ConsentForm';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import { consentService, patientService } from '../services/api';
import { ConsentTemplate } from '../types/models';
import { useToast } from '../components/UI/ToastContainer';
import './ConsentPage.css';

export default function ConsentPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [patientName, setPatientName] = useState('Paciente');
  const [template, setTemplate] = useState<ConsentTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const patientId = useMemo(() => id || '', [id]);

  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [patientResponse, templateResponse] = await Promise.all([
          patientService.getById(patientId),
          consentService.getActiveTemplate()
        ]);

        const patientPayload = (patientResponse as any)?.data?.data ?? (patientResponse as any)?.data;
        const name = patientPayload?.patientName || patientPayload?.patientID || patientId;

        if (isMounted) {
          setPatientName(name ? String(name) : 'Paciente');
          setTemplate(templateResponse.data?.data || null);
        }
      } catch (fetchError: any) {
        if (isMounted) {
          setError(fetchError?.message || 'Erro ao carregar dados do consentimento');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    if (patientId) {
      fetchData();
    } else {
      setLoading(false);
      setError('Paciente não identificado');
    }

    return () => {
      isMounted = false;
    };
  }, [patientId]);

  const handleSubmit = async (payload: { responses: Record<string, boolean>; signatureName: string }) => {
    if (!template?._id) return;

    try {
      await consentService.createPatientConsent({
        patientId,
        templateId: template._id,
        responses: payload.responses,
        signatureName: payload.signatureName
      } as any);

      showToast('Consentimento registrado com sucesso', 'success');
      navigate('/patients');
    } catch (submitError: any) {
      showToast(submitError?.message || 'Erro ao registrar consentimento', 'error');
    }
  };

  const handleCancel = () => {
    navigate('/patients');
  };

  if (loading) {
    return (
      <div className="consent-page">
        <Card>
          <div className="consent-page-status">Carregando consentimento...</div>
        </Card>
      </div>
    );
  }

  if (error || !template) {
    return (
      <div className="consent-page">
        <Card title="Consentimento">
          <div className="consent-page-error">
            {error || 'Nenhum termo ativo encontrado.'}
          </div>
          <Button variant="secondary" onClick={handleCancel}>
            Voltar
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="consent-page">
      <ConsentForm
        patientName={patientName}
        templateText={template.content}
        permissions={template.permissions || []}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
    </div>
  );
}
