import Modal from '../UI/Modal';

const TEMPLATE_COLUMNS = [
  {
    name: 'patient_cpf',
    required: true,
    summary: 'CPF do paciente',
    rules: [
      'Obrigatório.',
      'Deve conter 11 dígitos.',
      'Pontos e hífen são aceitos na entrada, mas o backend remove a pontuação.',
      'Use apenas números no arquivo final para reduzir erro humano.',
    ],
  },
  {
    name: 'patient_name',
    required: true,
    summary: 'Nome completo do paciente',
    rules: [
      'Obrigatório.',
      'Texto livre com nome completo.',
      'Não deixe em branco nem use abreviações.',
    ],
  },
  {
    name: 'patient_dob',
    required: true,
    summary: 'Data de nascimento',
    rules: [
      'Obrigatório.',
      'Formato exigido: YYYY-MM-DD.',
      'Padrão ISO 8601.',
      'Evite formatos locais como DD/MM/YYYY no template.',
    ],
  },
  {
    name: 'patient_sex',
    required: true,
    summary: 'Sexo biológico',
    rules: [
      'Obrigatório.',
      'Valores aceitos pela importação atual: M, F e O.',
      'Use M para masculino, F para feminino e O para outro.',
      'O valor U não é aceito pela validação atual do backend.',
    ],
  },
  {
    name: 'consent_status',
    required: true,
    summary: 'Status de consentimento',
    rules: [
      'Campo de governança do template v1.',
      'Valores sugeridos: ACTIVE, PENDING e REVOKED.',
      'Este campo orienta o pesquisador sobre a situação do consentimento.',
      'Mantenha o valor em caixa alta.',
    ],
  },
  {
    name: 'sample_ext_id',
    required: false,
    summary: 'Identificador externo da amostra',
    rules: [
      'Opcional, mas recomendado.',
      'Use o código físico do tubo ou o identificador externo disponível.',
      'Se ficar vazio, o sistema pode gerar um código automaticamente no fluxo de importação.',
      'Se informado, deve ser único.',
    ],
  },
  {
    name: 'sample_type',
    required: true,
    summary: 'Tipo de amostra',
    rules: [
      'Obrigatório.',
      'Deve corresponder a um tipo cadastrado/aceito no backend.',
      'Valores atualmente suportados incluem: Sangue, Urina, Saliva, Tecido, DNA, RNA, Plasma, Soro, Eritrócitos, DBS e Líquido Cefalorraquidiano.',
      'No template v1, DBS é o valor de exemplo usado com frequência.',
    ],
  },
  {
    name: 'collection_date',
    required: true,
    summary: 'Data de coleta',
    rules: [
      'Obrigatório.',
      'Formato exigido: YYYY-MM-DD.',
      'Use a mesma convenção ISO 8601 adotada para patient_dob.',
    ],
  },
  {
    name: 'alpha_gal_value',
    required: true,
    summary: 'Resultado de alpha-Galactosidase',
    rules: [
      'Obrigatório.',
      'Valor numérico decimal.',
      'Use ponto como separador decimal, por exemplo 1.2.',
      'Não use vírgula para decimal nem inclua unidade no valor.',
      'A unidade clínica esperada é U/mL.',
    ],
  },
  {
    name: 'lyso_gb3_value',
    required: true,
    summary: 'Resultado de Lyso-GB3',
    rules: [
      'Obrigatório.',
      'Valor numérico decimal.',
      'Use ponto como separador decimal, por exemplo 14.5.',
      'Não use vírgula para decimal nem inclua unidade no valor.',
    ],
  },
];

function SectionList({ title, items }) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: '0.9rem',
        background: 'var(--surface)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '0.95rem 1rem',
          borderBottom: '1px solid var(--border)',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.9), rgba(248,250,252,0.9))',
        }}
      >
        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)' }}>{title}</div>
      </div>

      <div style={{ padding: '0.85rem 1rem 1rem', display: 'grid', gap: '0.75rem' }}>
        {items.map((item) => (
          <details
            key={item.name}
            open={item.required}
            style={{
              border: '1px solid var(--border)',
              borderRadius: '0.8rem',
              background: '#fff',
              overflow: 'hidden',
            }}
          >
            <summary
              style={{
                cursor: 'pointer',
                listStyle: 'none',
                padding: '0.85rem 0.95rem',
                display: 'flex',
                justifyContent: 'space-between',
                gap: '0.75rem',
                alignItems: 'center',
                color: 'var(--text)',
                fontWeight: 600,
              }}
            >
              <span>{item.name}</span>
              <span
                style={{
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: item.required ? 'var(--primary)' : 'var(--text-light)',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.required ? 'Obrigatório' : 'Opcional'}
              </span>
            </summary>
            <div style={{ padding: '0 0.95rem 0.95rem', color: 'var(--text-light)', display: 'grid', gap: '0.55rem' }}>
              <div style={{ fontSize: '0.92rem', color: 'var(--text)' }}>{item.summary}</div>
              <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'grid', gap: '0.35rem' }}>
                {item.rules.map((rule) => (
                  <li key={rule} style={{ fontSize: '0.88rem', lineHeight: 1.45 }}>
                    {rule}
                  </li>
                ))}
              </ul>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

export default function DataDictionaryModal({ isOpen, onClose }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Dicionário de Dados - Importação em Lote">
      <div style={{ display: 'grid', gap: '1rem' }}>
        <section
          style={{
            border: '1px solid var(--border)',
            borderRadius: '1rem',
            padding: '1rem',
            background: 'linear-gradient(180deg, rgba(248,250,252,0.9), rgba(255,255,255,1))',
            display: 'grid',
            gap: '0.75rem',
          }}
        >
          <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text)' }}>Contrato do template v1</div>
          <p style={{ margin: 0, color: 'var(--text-light)', fontSize: '0.9rem', lineHeight: 1.6 }}>
            Cada linha representa um paciente com sua amostra e seus biomarcadores. O objetivo deste dicionário é
            reduzir erro de preenchimento antes do envio do CSV.
          </p>
          <div
            style={{
              display: 'grid',
              gap: '0.45rem',
              fontSize: '0.88rem',
              color: 'var(--text-light)',
            }}
          >
            <div>• Cabeçalhos sem espaços e sem acentos.</div>
            <div>• Datas no padrão YYYY-MM-DD.</div>
            <div>• Biomarcadores com ponto decimal.</div>
            <div>• Sexo aceito na validação atual: M, F ou O.</div>
          </div>
        </section>

        <SectionList title="Campos do template" items={TEMPLATE_COLUMNS} />

        <section
          style={{
            border: '1px solid var(--border)',
            borderRadius: '1rem',
            padding: '1rem',
            background: 'rgba(248,250,252,0.8)',
            display: 'grid',
            gap: '0.5rem',
          }}
        >
          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text)' }}>Boas práticas</div>
          <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'grid', gap: '0.4rem', color: 'var(--text-light)' }}>
            <li>Use UTF-8 no CSV.</li>
            <li>Não deixe células com fórmulas ou separadores regionais inconsistentes.</li>
            <li>Preencha apenas o conteúdo bruto esperado por coluna.</li>
            <li>Evite espaços extras antes ou depois dos valores.</li>
          </ul>
        </section>
      </div>
    </Modal>
  );
}