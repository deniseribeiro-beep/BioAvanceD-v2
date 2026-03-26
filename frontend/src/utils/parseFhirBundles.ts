// Utilitário para parsear múltiplos bundles FHIR e gerar linhas para Data Grid de preview de importação
// Local: frontend/src/utils/parseFhirBundles.ts

interface FlatPreviewRow {
  identificador: string;
  nomePaciente: string;
  diagnostico?: string;
  tipoAmostra?: string;
  volume?: string;
  tipoImportacao: 'NOVO_CADASTRO' | 'ATUALIZACAO_AMOSTRA';
  estado?: string;
}

interface FhirResource {
  resourceType: string;
  id: string;
  [key: string]: any;
}

export function parseFhirBundles(bundles: any[]): FlatPreviewRow[] {
  // Agrupar todos os recursos por tipo
  const allEntries = bundles.flatMap(bundle => Array.isArray(bundle.entry) ? bundle.entry : []);
  const resourcesByType: Record<string, FhirResource[]> = allEntries.reduce((acc, entry) => {
    const res = entry.resource;
    if (!res || !res.resourceType) return acc;
    if (!acc[res.resourceType]) acc[res.resourceType] = [];
    acc[res.resourceType].push(res);
    return acc;
  }, {} as Record<string, FhirResource[]>);

  // Indexar pacientes por id
  const patients = (resourcesByType['Patient'] || []);
  const patientMap = patients.reduce((acc, p) => {
    acc[p.id] = p;
    return acc;
  }, {} as Record<string, FhirResource>);

  // Indexar conditions por patient
  const conditions = (resourcesByType['Condition'] || []);
  const conditionByPatient: Record<string, FhirResource> = {};
  conditions.forEach(cond => {
    const ref = cond.subject?.reference;
    if (ref && ref.startsWith('Patient/')) {
      const pid = ref.split('/')[1];
      conditionByPatient[pid] = cond;
    }
  });

  // Indexar specimens por patient
  const specimens = (resourcesByType['Specimen'] || []);
  const specimensByPatient: Record<string, FhirResource[]> = {};
  specimens.forEach(spec => {
    const ref = spec.subject?.reference;
    if (ref && ref.startsWith('Patient/')) {
      const pid = ref.split('/')[1];
      if (!specimensByPatient[pid]) specimensByPatient[pid] = [];
      specimensByPatient[pid].push(spec);
    }
  });

  // Montar linhas para cada paciente
  const rows: FlatPreviewRow[] = [];
  // Pacientes com dados demográficos (NOVO_CADASTRO)
  patients.forEach(patient => {
    const identificador = patient.identifier?.[0]?.value || patient.id;
    const nomePaciente = [
      ...(patient.name?.[0]?.given || []),
      patient.name?.[0]?.family || ''
    ].join(' ').trim();
    const cond = conditionByPatient[patient.id];
    const diagnostico = cond?.code?.coding?.[0]?.display || cond?.code?.text || undefined;
    const specs = specimensByPatient[patient.id] || [];
    if (specs.length === 0) {
      rows.push({
        identificador,
        nomePaciente,
        diagnostico,
        tipoImportacao: 'NOVO_CADASTRO',
      });
    } else {
      specs.forEach(spec => {
        const tipoAmostra = spec.type?.text || spec.type?.coding?.[0]?.display;
        const volume = spec.collection?.quantity?.value && spec.collection?.quantity?.unit
          ? `${spec.collection.quantity.value} ${spec.collection.quantity.unit}`
          : undefined;
        rows.push({
          identificador,
          nomePaciente,
          diagnostico,
          tipoAmostra,
          volume,
          tipoImportacao: 'NOVO_CADASTRO',
        });
      });
    }
  });

  // Specimens sem Patient (ATUALIZACAO_AMOSTRA ou ERRO_REFERENCIA)
  specimens.forEach(spec => {
    const ref = spec.subject?.reference;
    if (!ref || !ref.startsWith('Patient/')) {
      rows.push({
        identificador: '',
        nomePaciente: '',
        tipoAmostra: spec.type?.text || spec.type?.coding?.[0]?.display,
        volume: spec.collection?.quantity?.value && spec.collection?.quantity?.unit
          ? `${spec.collection.quantity.value} ${spec.collection.quantity.unit}`
          : undefined,
        tipoImportacao: 'ATUALIZACAO_AMOSTRA',
        estado: 'ERRO_REFERENCIA',
      });
      return;
    }
    const pid = ref.split('/')[1];
    if (!patientMap[pid]) {
      // Specimen para paciente não carregado
      rows.push({
        identificador: pid,
        nomePaciente: '',
        tipoAmostra: spec.type?.text || spec.type?.coding?.[0]?.display,
        volume: spec.collection?.quantity?.value && spec.collection?.quantity?.unit
          ? `${spec.collection.quantity.value} ${spec.collection.quantity.unit}`
          : undefined,
        tipoImportacao: 'ATUALIZACAO_AMOSTRA',
        estado: 'ERRO_REFERENCIA',
      });
    }
  });

  // Conditions sem Patient (ignorar)

  return rows;
}
