import { useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import EntityFormPageShell from '../components/UI/EntityFormPageShell';
import { useQualityDescriptions } from '../hooks/useQualityDescriptions';
import { SampleWithQualityDescription } from '../types/models';

const LIST_PATH = '/quality-descriptions';

export default function QualityDescriptionFormPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const { qualities, createQuality, updateQuality } = useQualityDescriptions();
  const isNew = !id;

  const editingQuality = useMemo(() => {
    const fromState = (location.state as { quality?: SampleWithQualityDescription } | null)?.quality;
    if (fromState) return fromState;
    if (!id) return null;
    return qualities.find((q) => String(q.id) === id) ?? null;
  }, [location.state, qualities, id]);

  const title = editingQuality ? 'Editar Descrição' : 'Nova Descrição';

  return (
    <EntityFormPageShell title={title} backTo={LIST_PATH} testId="quality-description-form-page">
      {id && !editingQuality ? (
        <p>Carregando...</p>
      ) : (
        <QualityDescriptionFormFields
          quality={isNew ? null : editingQuality}
          onSave={async (data) => {
            try {
              if (editingQuality && !isNew) {
                await updateQuality(String(editingQuality.id), data);
              } else {
                await createQuality(data);
              }
              navigate(LIST_PATH);
            } catch (err: any) {
              alert(err.message);
            }
          }}
          onCancel={() => navigate(LIST_PATH)}
        />
      )}
    </EntityFormPageShell>
  );
}

export function QualityDescriptionFormFields({
  quality,
  onSave,
  onCancel,
}: {
  quality: SampleWithQualityDescription | null;
  onSave: (data: Partial<SampleWithQualityDescription>) => void;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState<Partial<SampleWithQualityDescription>>(
    quality || {
      description: '',
    }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="form" data-testid="quality-description-form">
      <div className="form-grid">
        <Input
          label="Descrição"
          data-testid="quality-description-input"
          value={formData.description || ''}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          required
        />
      </div>
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" data-testid="quality-description-form-submit">
          Salvar
        </Button>
      </div>
    </form>
  );
}
