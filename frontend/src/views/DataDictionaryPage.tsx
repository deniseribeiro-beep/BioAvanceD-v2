import { useMemo } from 'react';
import { FileDown, Printer } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

export default function DataDictionaryPage() {
  const { t } = useLanguage();
  const atcLevels = useMemo(() => ([
    {
      level: t('dictionary.atc.level1', 'Nível 1'),
      code: 'A',
      description: t('dictionary.atc.level1Description', 'Grupo anatômico principal'),
      example: t('dictionary.atc.level1Example', 'A - Trato alimentar e metabolismo'),
    },
    {
      level: t('dictionary.atc.level2', 'Nível 2'),
      code: 'A16',
      description: t('dictionary.atc.level2Description', 'Subgrupo terapêutico'),
      example: t('dictionary.atc.level2Example', 'A16 - Outros produtos para trato alimentar e metabolismo'),
    },
    {
      level: t('dictionary.atc.level3', 'Nível 3'),
      code: 'A16A',
      description: t('dictionary.atc.level3Description', 'Subgrupo farmacológico'),
      example: t('dictionary.atc.level3Example', 'A16A - Outros produtos para doenças metabólicas'),
    },
    {
      level: t('dictionary.atc.level4', 'Nível 4'),
      code: 'A16AX',
      description: t('dictionary.atc.level4Description', 'Subgrupo químico'),
      example: t('dictionary.atc.level4Example', 'A16AX - Outros produtos'),
    },
    {
      level: t('dictionary.atc.level5', 'Nível 5'),
      code: 'A16AX14',
      description: t('dictionary.atc.level5Description', 'Substância química específica'),
      example: t('dictionary.atc.level5Example', 'A16AX14 - Migalastat'),
    },
  ]), [t]);
  const sprecFluidAxes = useMemo(() => ([
    { axis: t('dictionary.sprec.fluid.axis1', 'Eixo 1'), label: t('dictionary.sprec.fluid.label1', 'Tipo de amostra') },
    { axis: t('dictionary.sprec.fluid.axis2', 'Eixo 2'), label: t('dictionary.sprec.fluid.label2', 'Recipiente primário') },
    { axis: t('dictionary.sprec.fluid.axis3', 'Eixo 3'), label: t('dictionary.sprec.fluid.label3', 'Pré-centrifugação') },
    { axis: t('dictionary.sprec.fluid.axis4', 'Eixo 4'), label: t('dictionary.sprec.fluid.label4', 'Centrifugação') },
    { axis: t('dictionary.sprec.fluid.axis5', 'Eixo 5'), label: t('dictionary.sprec.fluid.label5', 'Segunda centrifugação') },
    { axis: t('dictionary.sprec.fluid.axis6', 'Eixo 6'), label: t('dictionary.sprec.fluid.label6', 'Atraso pós-centrifugação') },
    { axis: t('dictionary.sprec.fluid.axis7', 'Eixo 7'), label: t('dictionary.sprec.fluid.label7', 'Armazenamento de longo prazo') },
  ]), [t]);
  const sprecSolidAxes = useMemo(() => ([
    { axis: t('dictionary.sprec.solid.axis1', 'Eixo 1'), label: t('dictionary.sprec.solid.label1', 'Tipo de tecido/espécime sólido') },
    { axis: t('dictionary.sprec.solid.axis2', 'Eixo 2'), label: t('dictionary.sprec.solid.label2', 'Tipo de estabilização/fixação') },
    { axis: t('dictionary.sprec.solid.axis3', 'Eixo 3'), label: t('dictionary.sprec.solid.label3', 'Atraso frio até preservação') },
    { axis: t('dictionary.sprec.solid.axis4', 'Eixo 4'), label: t('dictionary.sprec.solid.label4', 'Tipo de processamento') },
    { axis: t('dictionary.sprec.solid.axis5', 'Eixo 5'), label: t('dictionary.sprec.solid.label5', 'Condição de armazenamento') },
    { axis: t('dictionary.sprec.solid.axis6', 'Eixo 6'), label: t('dictionary.sprec.solid.label6', 'Temperatura de armazenamento') },
    { axis: t('dictionary.sprec.solid.axis7', 'Eixo 7'), label: t('dictionary.sprec.solid.label7', 'Formato final de preservação') },
  ]), [t]);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="page-shell dictionary-document-page">
      <header className="page-header dictionary-doc-header no-print">
        <div>
          <h1 className="page-title">{t('dictionary.title', 'Dicionário de Dados Integrado')}</h1>
          <p className="page-subtitle">
            {t('dictionary.subtitle', 'Documento técnico de referência para pesquisa, auditoria e conformidade do biobanco. Consulta MIABIS, Orphadata, ATC, SPREC e cadeia de custódia.')}
          </p>
        </div>

        <button type="button" className="print-button" onClick={handlePrint}>
          <Printer size={16} />
          {t('dictionary.exportPdf', 'Exportar para PDF / Imprimir')}
        </button>
      </header>

      <main className="dictionary-article prose max-w-none" id="dictionary-print-root">
        <section className="doc-section" id="indice">
          <h2>{t('dictionary.index.title', 'Índice')}</h2>
          <nav className="doc-index">
            <a href="#miabis">{t('dictionary.index.miabis', '1. MIABIS 2.0')}</a>
            <a href="#orpha">{t('dictionary.index.orpha', '2. Orphadata e Validação Clínica')}</a>
            <a href="#atc">{t('dictionary.index.atc', '3. Sistema Farmacológico ATC (OMS) e ChEMBL')}</a>
            <a href="#sprec">{t('dictionary.index.sprec', '4. Qualidade de Amostra (SPREC)')}</a>
            <a href="#merkle">{t('dictionary.index.merkle', '5. Cadeia de Custódia e Merkle Tree')}</a>
          </nav>
        </section>

        <section className="doc-section" id="miabis">
          <h2>{t('dictionary.miabis.title', '1. MIABIS 2.0 (Minimum Information About Biobank Data Sharing)')}</h2>
          <p>
            {t('dictionary.miabis.p1', 'O BioAvanceD-v2 adota MIABIS 2.0 como base de interoperabilidade para descrição de pacientes, espécimes e metadados de qualidade. O modelo operacional é relacional e orientado a rastreabilidade, com cardinalidade de Paciente -> N Amostras.')}
          </p>
          <p>
            {t('dictionary.miabis.p2', 'Para garantir idempotência no cadastro clínico, o sistema aplica Match Heurístico: busca por patientID ou por combinação de Nome Normalizado + Data de Nascimento. A normalização remove acentuação, padroniza caixa e espaços. Quando há correspondência, os novos dados são vinculados ao paciente existente, evitando duplicação.')}
          </p>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Entidade</th>
                  <th>{t('dictionary.miabis.table.relation', 'Relação')}</th>
                  <th>{t('dictionary.miabis.table.rule', 'Regra de Governança')}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{t('dictionary.miabis.table.patient', 'Paciente')}</td>
                  <td>{t('dictionary.miabis.table.patientRel', '1:N Amostras')}</td>
                  <td>{t('dictionary.miabis.table.patientRule', 'Identificação idempotente por patientID ou Nome Normalizado + Data de Nascimento')}</td>
                </tr>
                <tr>
                  <td>{t('dictionary.miabis.table.sample', 'Amostra')}</td>
                  <td>{t('dictionary.miabis.table.sampleRel', 'N:1 Paciente')}</td>
                  <td>{t('dictionary.miabis.table.sampleRule', 'Vinculação obrigatória a paciente válido antes de consolidar registro')}</td>
                </tr>
                <tr>
                  <td>{t('dictionary.miabis.table.meta', 'Metadados MIABIS')}</td>
                  <td>{t('dictionary.miabis.table.metaRel', '1:1 por amostra')}</td>
                  <td>{t('dictionary.miabis.table.metaRule', 'Validação de tipo, origem, protocolo, qualidade e unidade institucional')}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="doc-section" id="orpha">
          <h2>{t('dictionary.orpha.title', '2. Orphadata e Validação Clínica')}</h2>
          <p>
            {t('dictionary.orpha.p1', 'O domínio clínico usa ontologias da Orphanet para mapear diagnóstico raro, códigos correlatos e contexto semântico para análise. A camada de validação clínica utiliza um grafo de regras para condicionar o estado operacional da amostra ao preenchimento clínico mínimo exigido.')}
          </p>
          <p>
            {t('dictionary.orpha.p2', 'Na prática, amostras com diagnóstico raro sem biomarcadores obrigatórios permanecem com restrição de completude até que os dados clínicos sejam fornecidos, preservando qualidade e rastreabilidade regulatória.')}
          </p>

          <ul>
            <li>{t('dictionary.orpha.bullet1', 'Fonte ontológica principal: Orphanet (ORPHA).')}</li>
            <li>{t('dictionary.orpha.bullet2', 'Relações complementares: CID-10 e OMIM para interoperabilidade clínica.')}</li>
            <li>{t('dictionary.orpha.bullet3', 'Regra de bloqueio qualitativo: ausência de biomarcadores obrigatórios degrada status de validação.')}</li>
          </ul>
        </section>

        <section className="doc-section" id="atc">
          <h2>{t('dictionary.atc.title', '3. Sistema Farmacológico ATC (OMS) e ChEMBL')}</h2>
          <p>
            {t('dictionary.atc.p1', 'O módulo farmacológico utiliza classificação ATC da OMS e consulta externa ChEMBL apenas como fallback, seguindo padrão de redundância local compatível com o dicionário Orpha.')}
          </p>

          <h3>{t('dictionary.atc.hierarchyTitle', '3.1 Hierarquia ATC')}</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('dictionary.atc.table.level', 'Nível')}</th>
                  <th>{t('dictionary.atc.table.format', 'Formato')}</th>
                  <th>{t('dictionary.atc.table.meaning', 'Significado')}</th>
                  <th>{t('dictionary.atc.table.example', 'Exemplo')}</th>
                </tr>
              </thead>
              <tbody>
                {atcLevels.map((item) => (
                  <tr key={item.level}>
                    <td>{item.level}</td>
                    <td>{item.code}</td>
                    <td>{item.description}</td>
                    <td>{item.example}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>{t('dictionary.atc.cacheTitle', '3.2 Cache-Aside Local-First')}</h3>
          <ol>
            <li>
              <strong>{t('dictionary.atc.cache1Title', 'Busca local primeiro')}</strong>: {t('dictionary.atc.cache1Body', 'consulta MongoDB por generic_name e atc_code com regex case-insensitive.')}
            </li>
            <li>
              <strong>{t('dictionary.atc.cache2Title', 'Fallback externo')}</strong>: {t('dictionary.atc.cache2Body', 'sem resultado local, consulta API ChEMBL.')}
            </li>
            <li>
              <strong>{t('dictionary.atc.cache3Title', 'Redundância por upsert')}</strong>: {t('dictionary.atc.cache3Body', 'resposta externa é normalizada e persistida localmente antes de ser devolvida ao frontend.')}
            </li>
            <li>
              <strong>{t('dictionary.atc.cache4Title', 'Contrato unificado')}</strong>: {t('dictionary.atc.cache4Body', 'o autocomplete recebe payload estável para renderização contínua.')}
            </li>
          </ol>
        </section>

        <section className="doc-section" id="sprec">
          <h2>{t('dictionary.sprec.title', '4. Qualidade de Amostra (SPREC)')}</h2>
          <p>
            {t('dictionary.sprec.p1', 'O código SPREC consolida os metadados pré-analíticos críticos da amostra. O BioAvanceD-v2 registra sete eixos para fluidos e sete eixos para sólidos, garantindo reprodutibilidade laboratorial e auditoria de cadeia pré-analítica.')}
          </p>

          <h3>{t('dictionary.sprec.fluidTitle', '4.1 SPREC - Fluidos (7 eixos)')}</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('dictionary.sprec.table.axis', 'Eixo')}</th>
                  <th>{t('dictionary.sprec.table.description', 'Descrição')}</th>
                </tr>
              </thead>
              <tbody>
                {sprecFluidAxes.map((axis) => (
                  <tr key={`fluid-${axis.axis}`}>
                    <td>{axis.axis}</td>
                    <td>{axis.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>{t('dictionary.sprec.solidTitle', '4.2 SPREC - Sólidos (7 eixos)')}</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('dictionary.sprec.table.axis', 'Eixo')}</th>
                  <th>{t('dictionary.sprec.table.description', 'Descrição')}</th>
                </tr>
              </thead>
              <tbody>
                {sprecSolidAxes.map((axis) => (
                  <tr key={`solid-${axis.axis}`}>
                    <td>{axis.axis}</td>
                    <td>{axis.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="doc-section" id="merkle">
          <h2>{t('dictionary.merkle.title', '5. Cadeia de Custódia e Merkle Tree')}</h2>
          <p>
            {t('dictionary.merkle.p1', 'A integridade da amostra é assegurada por hash criptográfico SHA-256 e encadeamento de evidências para verificação posterior. Cada alteração relevante gera recomputação de assinatura conforme políticas de governança.')}
          </p>

          <p>
            <strong>{t('dictionary.merkle.payloadTitle', 'Payload canônico do hash da amostra:')}</strong>
          </p>

          <pre className="hash-formula">
{`SHA256(
  patient_identity_verified
  + sprec_metadata
  + clinical_ontology_orpha
  + pharmacology_atc
)`}
          </pre>

          <p>
            {t('dictionary.merkle.p2', 'Esse modelo preserva consistência entre cadastro clínico, qualidade pré-analítica e farmacologia, permitindo auditoria técnica ponta a ponta em ambiente regulado.')}
          </p>
        </section>
      </main>

      <button type="button" className="floating-print no-print" onClick={handlePrint}>
        <FileDown size={16} />
        {t('dictionary.exportPdfShort', 'Exportar PDF')}
      </button>
    </div>
  );
}
