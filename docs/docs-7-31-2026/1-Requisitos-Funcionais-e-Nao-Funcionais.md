**BIOAVANCED**

**Documento Unificado de Requisitos**

**Apêndice B - Requisitos Funcionais**

**Apêndice C - Requisitos Não Funcionais**

<table style="width:97%;">
<colgroup>
<col style="width: 97%" />
</colgroup>
<thead>
<tr>
<th><p><strong>Base canônica vigente</strong></p>
<blockquote>
<p>• BioAvanceD_Dicionario_Dados_Consolidado_v1.3.0_padronizado.xlsx:
929 elementos.</p>
<p>• Fase 1: Foundation Data Pipeline - preparação integral da estrutura
e dos mecanismos de controle.</p>
<p>• Fase 2: população de terminologias, ontologias, catálogos e demais
dados de referência externos.</p>
<p>• Fase 3: população de dados operacionais, clínicos, científicos,
laboratoriais, telemetria, arquivos, workflows e dados ômicos.</p>
<p>• IA, Assistente Inteligente e XAI permanecem em projeto futuro
separado.</p>
</blockquote></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

**Versão 3.0.1 \| 31 de julho de 2026**

*Substitui os Apêndices B e C v2.0 como referência consolidada.*

# 1. Controle documental

  -----------------------------------------------------------------------------------
  **Título**        BioAvanceD - Documento Unificado de Requisitos Funcionais e Não
                    Funcionais
  ----------------- -----------------------------------------------------------------
  **Versão**        3.0.1 - 31 de julho de 2026

  **Fonte           BioAvanceD_Dicionario_Dados_Consolidado_v1.3.0_padronizado.xlsx
  normativa**       

  **Escopo**        Requisitos funcionais e não funcionais coerentes com o Foundation
                    Data Pipeline e com as fases de população de dados.

  **Documentos      Apêndice B - Requisitos Funcionais v2.0 e Apêndice C - Requisitos
  substituídos**    Não Funcionais v2.0.

  **Regra de        A Fase 1 prepara integralmente o modelo; a Fase 2 popula dados de
  interpretação**   referência; a Fase 3 popula dados operacionais e científicos.

  **Status**        Referência única para modelagem, implementação, testes,
                    Lucidchart, Codex e rastreabilidade.
  -----------------------------------------------------------------------------------

# 2. Modelo de fases e regras de coerência

Este documento utiliza fases de preparação e população de dados. Elas
não representam subconjuntos do modelo: todas as entidades e variáveis
são preparadas estruturalmente na Fase 1. As fases seguintes utilizam
essa estrutura para carregar referências externas e dados operacionais
reais.

<table style="width:98%;">
<colgroup>
<col style="width: 8%" />
<col style="width: 19%" />
<col style="width: 40%" />
<col style="width: 30%" />
<col style="width: 0%" />
</colgroup>
<thead>
<tr>
<th><strong>Fase</strong></th>
<th><strong>Nome</strong></th>
<th><strong>Finalidade</strong></th>
<th colspan="2"><strong>Gate de saída</strong></th>
</tr>
</thead>
<tbody>
<tr>
<td>Fase 1</td>
<td>Foundation Data Pipeline</td>
<td>Preparar os 929 elementos do dicionário v1.3.0: contratos, schemas,
coleções, objetos embutidos, referências, índices, configurações,
mecanismos de importação, quarentena, outbox e controles de
execução.</td>
<td colspan="2">FoundationDataRun concluído; zero erro estrutural fatal;
zero elemento sem tratamento.</td>
</tr>
<tr>
<td>Fase 2</td>
<td>Reference Data Population</td>
<td>Importar e promover MONDO, HPO, ORPHA, CID, OMIM, HGNC, LOINC, UCUM,
ATC, DCB, DUO, Uberon, NCBI Taxonomy, EDAM e demais fontes
aprovadas.</td>
<td colspan="2">Releases ativas e validadas; proveniência, licença,
checksum, parser e mapping versionados.</td>
</tr>
<tr>
<td>Fase 3</td>
<td>Operational &amp; Scientific Data Population</td>
<td>Receber participantes, consentimentos, espécimes, dados clínicos,
telemetria, arquivos, datasets, ensaios, workflows e dados ômicos pelos
fluxos autorizados.</td>
<td colspan="2">Dados validados contra contratos canônicos, referências
ativas, políticas e consentimento.</td>
</tr>
<tr>
<td>Futuro</td>
<td>Projeto separado</td>
<td>IA, Assistente Inteligente, XAI e apoio à decisão clínica.</td>
<td colspan="2">Promoção formal em projeto, modelo, ética e documentação
próprios.</td>
</tr>
<tr>
<td colspan="4"><strong>Decisões permanentes<br />
• Não são admitidos recortes reduzidos de padrões como modelo-alvo; o
projeto utiliza todos os elementos incorporados ao dicionário
vigente.<br />
• MongoDB é a fonte operacional; Neo4j é projeção exclusiva do outbox;
InfluxDB armazena telemetria; Object Storage armazena binários; Redis é
transitório.<br />
• FHIR R4 é fronteira de interoperabilidade e não uma persistência
operacional paralela.<br />
• A Fase 1 não cria dados operacionais fictícios; ela prepara
integralmente a estrutura necessária para recebê-los.<br />
• RF014 identifica Políticas de segurança e permanece
vigente.</strong></td>
<td></td>
</tr>
</tbody>
</table>

# 3. Convenções de leitura

A coluna \"Aplicação\" informa quando o requisito é preparado ou
exercido. \"F1 estrutura / F3 operação\" significa que o contrato, a
persistência e os controles são preparados pelo Foundation Data
Pipeline, enquanto os registros reais surgem na ingestão operacional.
\"Transversal\" significa aplicação contínua nas três fases.

# APÊNDICE B - REQUISITOS FUNCIONAIS DA PLATAFORMA BIOAVANCED

Os requisitos funcionais abaixo foram reconciliados com o dicionário
consolidado v1.3.0 e com o novo ciclo de dados. O RF022 define o
Foundation Data Pipeline e o RF023 define o outbox e a projeção Neo4j;
RF028 e RF029 distinguem, respectivamente, a importação de dados de
referência da ingestão operacional e científica. O RF014 identifica
Políticas de segurança. A série funcional vigente encerra-se em RF029;
não existe RF030.

<table style="width:91%;">
<colgroup>
<col style="width: 4%" />
<col style="width: 11%" />
<col style="width: 23%" />
<col style="width: 8%" />
<col style="width: 42%" />
</colgroup>
<thead>
<tr>
<th><strong>ID</strong></th>
<th><strong>Módulo</strong></th>
<th><strong>Requisito funcional</strong></th>
<th><strong>Ator primário</strong></th>
<th><strong>Critérios de aceitação</strong></th>
</tr>
</thead>
<tbody>
<tr>
<td><strong>RF001</strong></td>
<td>Segurança e autenticação</td>
<td>O sistema deve autenticar usuários por credenciais protegidas por
hash seguro, RBAC, aplicar autenticação multifator conforme a política
de segurança e emitir sessões autenticadas, expiráveis e
revogáveis.</td>
<td>Usuário autenticável</td>
<td><p>1. Rejeitar o acesso quando a senha ou o fator adicional forem
inválidos.</p>
<p>2. Bloquear temporariamente a conta após o limite configurado de
tentativas malsucedidas.</p>
<p>3. Criar sessão com prazo de expiração e papéis associados.</p>
<p>4. Invalidar a sessão após logout, inativação da conta ou revogação
administrativa.</p>
<p>5. Registrar tentativas e decisões de autenticação em
AuditEvent.</p></td>
</tr>
<tr>
<td><strong>RF002</strong></td>
<td>Dashboard e autorização</td>
<td>O sistema deve apresentar dashboards, menus, indicadores e ações
conforme as permissões efetivas e o escopo de acesso do usuário
autenticado.</td>
<td>Usuário autenticado</td>
<td><p>1. O Técnico visualiza operações autorizadas de cadastro,
custódia e armazenamento.</p>
<p>2. O Coordenador visualiza indicadores operacionais, alertas e
relatórios de governança.</p>
<p>3. O Administrador visualiza segurança, usuários, auditoria e
configurações.</p>
<p>4. O Usuário Externo visualiza somente dados e relatórios previamente
autorizados.</p>
<p>5. O backend valida a permissão independentemente da ocultação da
função no frontend.</p></td>
</tr>
<tr>
<td><strong>RF003</strong></td>
<td>Gestão de usuários</td>
<td>O sistema deve permitir ao Administrador gerenciar o ciclo de vida
de contas de usuário, seus papéis, permissões, escopos, credenciais, MFA
e sessões.</td>
<td>Administrador</td>
<td><p>1. Validar unicidade de e-mail e username.</p>
<p>2. Aplicar a política de complexidade e histórico de senhas.</p>
<p>3. Atribuir papel com vigência e escopo institucional.</p>
<p>4. Inativar a conta sem excluir o histórico.</p>
<p>5. Revogar sessões e permitir redefinição controlada do MFA.</p>
<p>6. Auditar criação, edição, bloqueio, inativação e alterações de
papel.</p></td>
</tr>
<tr>
<td><strong>RF004</strong></td>
<td>Cadastro integrado do biobanco</td>
<td>O sistema deve disponibilizar um fluxo integrado para registro de
participantes, estudos, consentimentos e espécimes, aplicando validações
de consistência, regras pré-analíticas e bloqueios operacionais
versionados.</td>
<td>Técnico</td>
<td><p>1. Impedir o cadastro de espécime sem participantId válido.</p>
<p>2. Gerar specimenId único e imutável.</p>
<p>3. Exigir vínculo com estudo, protocolo e coleção quando
aplicável.</p>
<p>4. Validar tipo de material, origem, método de coleta e
processamento.</p>
<p>5. Registrar variáveis SPREC aplicáveis.</p>
<p>6. Bloquear operações incompatíveis com consentimento, protocolo ou
estado da amostra.</p></td>
</tr>
<tr>
<td><strong>RF005</strong></td>
<td>Participante e dados clínicos</td>
<td>O sistema deve registrar o participante de forma pseudonimizada,
manter a identidade civil em fronteira protegida e associar dados
clínicos, diagnósticos e fenotípicos estruturados por terminologias
versionadas.</td>
<td>Coordenador</td>
<td><p>1. Gerar participantId único.</p>
<p>2. Armazenar dados civis diretos somente em ParticipantIdentity.</p>
<p>3. Impedir a projeção de identificadores civis para o Neo4j.</p>
<p>4. Permitir codificação por HPO, ORPHA, CID, MONDO ou OMIM, somente
quando houver ReferenceDatasetRelease ativa e validada para o sistema e
a versão adotados.</p>
<p>5. Preservar código, sistema, versão e descrição da terminologia
utilizada.</p>
<p>6. Permitir texto narrativo apenas nos campos destinados a
observações complementares.</p></td>
</tr>
<tr>
<td><strong>RF006</strong></td>
<td>Rastreabilidade e cadeia de custódia</td>
<td>O sistema deve registrar a cadeia de custódia, movimentações,
retiradas, devoluções e consumo de quantidade de cada espécime por
eventos imutáveis.</td>
<td>Técnico</td>
<td><p>1. Registrar origem, destino, responsável, data, finalidade e
quantidade.</p>
<p>2. Alterar o estado para PARTIAL quando houver quantidade
remanescente.</p>
<p>3. Alterar o estado para DEPLETED quando a quantidade disponível for
zero.</p>
<p>4. Bloquear movimentação de espécime UNAVAILABLE, DESTROYED, DISPOSED
ou QUARANTINED.</p>
<p>5. Impedir alteração ou exclusão de eventos de custódia.</p>
<p>6. Atualizar a quantidade disponível por transação controlada.</p>
<p>7. Executar alocação, movimentação e liberação em transação MongoDB
real quando a operação alterar mais de um documento, em implantação
configurada como replica set; qualquer falha deve reverter integralmente
a operação.</p></td>
</tr>
<tr>
<td><strong>RF007</strong></td>
<td>Arquivos científicos e dados brutos</td>
<td>O sistema deve receber, validar e armazenar arquivos científicos
vinculados a espécimes, ensaios, estudos ou datasets, mantendo metadados
de integridade, acesso e proveniência.</td>
<td>Pesquisador</td>
<td><p>1. Validar os formatos permitidos pela política de upload.</p>
<p>2. Aplicar limite de tamanho configurável.</p>
<p>3. Calcular checksum do arquivo.</p>
<p>4. Armazenar o conteúdo em Object Storage.</p>
<p>5. Registrar URI, formato, tamanho, criptografia e restrições de
acesso.</p>
<p>6. Vincular o arquivo a specimenId, assayId, studyId ou
datasetId.</p>
<p>7. Auditar upload, acesso, substituição e remoção lógica.</p></td>
</tr>
<tr>
<td><strong>RF008</strong></td>
<td>Relatórios</td>
<td>O sistema deve gerar relatórios operacionais, gerenciais,
científicos e de auditoria conforme as permissões do usuário, com
filtros dinâmicos e exportações controladas.</td>
<td>Coordenador</td>
<td><p>1. Aplicar filtros por período, coleção, tipo, origem, estado e
localização.</p>
<p>2. Restringir os dados conforme AccessPolicy, papel e
consentimento.</p>
<p>3. Pseudonimizar ou omitir dados identificadores quando
necessário.</p>
<p>4. Exportar somente nos formatos habilitados.</p>
<p>5. Registrar o evento de exportação.</p>
<p>6. Permitir a criação de novos modelos de relatório sem depender de
uma lista fixa.</p>
<p>7. Derivar o escopo organizacional efetivo das atribuições vigentes
do usuário e aplicá-lo igualmente a linhas detalhadas, indicadores e
agregações, impedindo inferência ou exposição entre organizações,
biobancos, coleções ou estudos não autorizados.</p></td>
</tr>
<tr>
<td><strong>RF009</strong></td>
<td>Telemetria e monitoramento ambiental</td>
<td>O sistema deve coletar, validar e persistir telemetria de sensores
ambientais, identificar falhas e excursões e gerar eventos operacionais
associados aos equipamentos e locais afetados.</td>
<td>Sistema</td>
<td><p>1. Coletar leituras em intervalo configurável.</p>
<p>2. Persistir séries temporais no InfluxDB.</p>
<p>3. Vincular cada leitura ao Device e ao local de armazenamento.</p>
<p>4. Detectar leituras ausentes, inválidas ou fora da faixa.</p>
<p>5. Criar EnvironmentalExcursion quando aplicável.</p>
<p>6. Acionar alerta e avaliação de quarentena.</p>
<p>7. Preservar a leitura original e a regra utilizada na
decisão.</p></td>
</tr>
<tr>
<td><strong>RF010</strong></td>
<td>Consentimento eletrônico e dinâmico</td>
<td>O sistema deve gerenciar modelos versionados de consentimento e
instâncias individuais de consentimento, permitindo manifestação
granular, atualização e revogação rastreáveis por finalidade.</td>
<td>Participante</td>
<td><p>1. Versionar ConsentTemplate sem sobrescrever versões
anteriores.</p>
<p>2. Registrar cada manifestação como Consent identificado por
consentId.</p>
<p>3. Vincular as respostas à versão exata do termo.</p>
<p>4. Registrar data, evidência, hash, origem e signatário.</p>
<p>5. Preservar o histórico de concessão, atualização e revogação.</p>
<p>6. Bloquear uso incompatível com a decisão vigente.</p>
<p>7. Emitir evento canônico para o outbox.</p>
<p>8. Aplicar quarentena quando houver revogação relevante.</p></td>
</tr>
<tr>
<td><strong>RF011</strong></td>
<td>Interoperabilidade HL7 FHIR R4</td>
<td>O sistema deve importar e exportar dados por recursos HL7 FHIR R4,
convertendo-os entre o modelo canônico do BioAvanceD e representações de
interoperabilidade sem persistir recursos FHIR como coleções
operacionais.</td>
<td>Sistema</td>
<td><p>1. Validar estrutura, perfil e campos obrigatórios do
recurso.</p>
<p>2. Mapear Participant para FHIR Patient.</p>
<p>3. Mapear Specimen, Consent, Observation, DiagnosticReport e demais
recursos aplicáveis.</p>
<p>4. Rejeitar campos não canônicos ou recursos inválidos.</p>
<p>5. Registrar origem, versão e proveniência.</p>
<p>6. Utilizar staging e quarentena para importações que exijam
revisão.</p>
<p>7. Garantir que a conversão FHIR não produza escrita direta no
MongoDB ou no Neo4j.</p></td>
</tr>
<tr>
<td><strong>RF012</strong></td>
<td>Auditoria e integridade criptográfica</td>
<td>O sistema deve registrar eventos de auditoria append-only e aplicar
mecanismos criptográficos de verificação de integridade, incluindo
encadeamento de registros e consolidação periódica por raiz Merkle.</td>
<td>Sistema</td>
<td><p>1. Registrar ator, ação, recurso, data, IP, resultado e
correlação.</p>
<p>2. Calcular o hash canônico de cada evento.</p>
<p>3. Vincular o evento ao hash anterior quando utilizado encadeamento
sequencial.</p>
<p>4. Consolidar lotes de eventos em raiz Merkle verificável.</p>
<p>5. Impedir alteração ou exclusão dos eventos pela aplicação.</p>
<p>6. Detectar divergência ou adulteração.</p>
<p>7. Sanitizar payloads e evitar dados sensíveis desnecessários.</p>
<p>8. Canonicalizar deterministicamente objetos aninhados, arrays,
valores nulos e datas antes do hash; estruturas cíclicas ou tipos não
suportados devem ser rejeitados de forma explícita.</p>
<p>9. Controlar avisos repetitivos de serialização ou sanitização por
deduplicação ou limitação de frequência, sem suprimir eventos de
segurança distintos.</p></td>
</tr>
<tr>
<td><strong>RF013</strong></td>
<td>Backup e restauração</td>
<td>O sistema deve permitir ao Administrador configurar, executar,
acompanhar e validar rotinas de backup e restauração.</td>
<td>Administrador</td>
<td><p>1. Exibir estado, data e resultado das execuções.</p>
<p>2. Permitir execução manual autorizada.</p>
<p>3. Registrar checksum e evidência de conclusão.</p>
<p>4. Permitir teste controlado de restauração.</p>
<p>5. Auditar alterações da política de backup.</p>
<p>6. Aplicar frequência, retenção, criptografia, RPO e RTO definidos
nos requisitos não funcionais.</p></td>
</tr>
<tr>
<td><strong>RF014</strong></td>
<td>Políticas de segurança</td>
<td>O sistema deve permitir ao Administrador gerenciar políticas globais
de autenticação, senha, MFA, sessão, acesso, auditoria, privacidade e
retenção.</td>
<td>Administrador</td>
<td><p>1. Configurar timeout e duração máxima da sessão.</p>
<p>2. Configurar tentativas, bloqueios e regras de senha.</p>
<p>3. Definir obrigatoriedade de MFA.</p>
<p>4. Forçar redefinição de senha.</p>
<p>5. Versionar alterações de política.</p>
<p>6. Validar limites mínimos de segurança.</p>
<p>7. Registrar a alteração como AuditEvent crítico.</p>
<p>8. Revogar sessões quando a alteração exigir.</p></td>
</tr>
<tr>
<td><strong>RF015</strong></td>
<td>Alertas e notificações</td>
<td>O sistema deve gerar notificações multicanal a partir de eventos
críticos de segurança, telemetria, consentimento, qualidade e
governança.</td>
<td>Sistema</td>
<td><p>1. Criar notificação a partir de regra versionada.</p>
<p>2. Enviar pelos canais habilitados.</p>
<p>3. Registrar tentativas, falhas, entrega e confirmação.</p>
<p>4. Aplicar escalonamento quando necessário.</p>
<p>5. Não incluir dados sensíveis desnecessários.</p>
<p>6. Vincular a notificação ao evento que a originou.</p>
<p>7. Aplicar tempos máximos de entrega definidos nos requisitos não
funcionais.</p></td>
</tr>
<tr>
<td><strong>RF016</strong></td>
<td>Etiquetagem</td>
<td>O sistema deve gerar e imprimir etiquetas unitárias ou em lote
vinculadas ao identificador canônico do espécime.</td>
<td>Técnico</td>
<td><p>1. Utilizar specimenId e barcode únicos.</p>
<p>2. Suportar Code 128, DataMatrix ou QR conforme configuração.</p>
<p>3. Validar o layout da impressora.</p>
<p>4. Gerar lote após cadastro ou importação autorizada.</p>
<p>5. Impedir reutilização de identificadores.</p>
<p>6. Auditar geração e reimpressão.</p></td>
</tr>
<tr>
<td><strong>RF017</strong></td>
<td>Equipamentos e armazenamento</td>
<td>O sistema deve gerenciar equipamentos, dispositivos, sensores e a
topologia física de armazenamento dos espécimes.</td>
<td>Coordenador</td>
<td><p>1. Representar Freezer &gt; Prateleira &gt; Rack &gt; Caixa &gt;
Posição.</p>
<p>2. Impedir ocupação duplicada de uma posição.</p>
<p>3. Vincular StorageAssignment ao espécime.</p>
<p>4. Vincular sensor ou dispositivo ao equipamento.</p>
<p>5. Registrar instalação, movimentação e retirada.</p>
<p>6. Preservar o histórico das localizações.</p>
<p>7. Bloquear local indisponível, interditado ou fora de
condição.</p></td>
</tr>
<tr>
<td><strong>RF018</strong></td>
<td>Qualidade de biospecímenes - SPREC e RCS</td>
<td>O sistema deve registrar todas as variáveis pré-analíticas SPREC
incorporadas ao dicionário consolidado vigente e calcular uma avaliação
RCS versionada para qualificação operacional do espécime, sem utilizar
recortes reduzidos como modelo-alvo.</td>
<td>Sistema</td>
<td><p>1. Validar códigos, eixos, campos e versão SPREC de acordo com o
dicionário consolidado vigente.</p>
<p>2. Calcular penalidades pelos eixos aplicáveis.</p>
<p>3. Registrar biologicalPenalty, rcsScore, grau e rota de decisão.</p>
<p>4. Aplicar as faixas A, B, C, D e E da versão vigente.</p>
<p>5. Forçar grau E em falha de governança não compensável.</p>
<p>6. Tratar códigos desconhecidos ou Other como revisão ou falha, nunca
como penalidade zero silenciosa.</p>
<p>7. Manter o resultado calculado como somente leitura.</p>
<p>8. Registrar versão das regras, proveniência e trilha de cálculo.</p>
<p>9. Rejeitar qualquer implementação que represente somente um
subconjunto reduzido dos campos SPREC aprovados.</p></td>
</tr>
<tr>
<td><strong>RF019</strong></td>
<td>Quarentena lógica</td>
<td>O sistema deve aplicar quarentena lógica orientada a eventos quando
o espécime, lote ou local apresentar condição incompatível com uso,
processamento ou distribuição.</td>
<td>Sistema</td>
<td><p>1. Acionar por revogação de consentimento.</p>
<p>2. Acionar por excursão ambiental.</p>
<p>3. Acionar por falha de governança do RCS.</p>
<p>4. Acionar por não conformidade crítica.</p>
<p>5. Bloquear retirada, processamento, envio e disponibilização.</p>
<p>6. Registrar causa, evento originador e momento da quarentena.</p>
<p>7. Permitir liberação somente por ator autorizado e mediante
evidência.</p>
<p>8. Auditar a liberação e emitir evento de projeção.</p></td>
</tr>
<tr>
<td><strong>RF020</strong></td>
<td>Metadados institucionais e MIABIS</td>
<td>O sistema deve gerenciar organizações, redes, biobancos, coleções e
recursos de pesquisa, cobrindo todos os elementos MIABIS incorporados ao
dicionário consolidado vigente e mantendo perfil projetado para
interoperabilidade.</td>
<td>Coordenador</td>
<td><p>1. Cadastrar Organization, Network, Biobank, Collection e
entidades associativas previstas.</p>
<p>2. Manter identificadores, contatos, descrições, relações e
estado.</p>
<p>3. Registrar tipos de amostra, doenças, datasets e condições de
acesso conforme os campos canônicos.</p>
<p>4. Exportar o perfil MIABIS adotado a partir do modelo canônico.</p>
<p>5. Cobrir integralmente os elementos MIABIS incorporados ao
dicionário consolidado vigente.</p>
<p>6. Não declarar conformidade plena antes de validação formal
independente.</p></td>
</tr>
<tr>
<td><strong>RF021</strong></td>
<td>Estudos, protocolos e ética</td>
<td>O sistema deve gerenciar estudos, protocolos, versões, pesquisadores
responsáveis, centros participantes e aprovações éticas.</td>
<td>Coordenador</td>
<td><p>1. Gerar studyId e protocolId.</p>
<p>2. Versionar o protocolo.</p>
<p>3. Registrar CAAE e período de validade.</p>
<p>4. Vincular participante, consentimento, coleta e espécime ao estudo
aplicável.</p>
<p>5. Impedir operação com protocolo inativo ou incompatível.</p></td>
</tr>
<tr>
<td><strong>RF022</strong></td>
<td>Foundation Data Pipeline</td>
<td>O sistema deve executar o Foundation Data Pipeline como job one-shot
da Fase 1 para preparar integralmente a estrutura de dados, as
configurações fundacionais e os mecanismos de controle necessários às
cargas das Fases 2 e 3.</td>
<td>Sistema / DevOps</td>
<td><p>1. Ler e validar a versão vigente do dicionário consolidado,
incluindo os 929 elementos da versão 1.3.0.</p>
<p>2. Criar ou validar coleções, objetos embutidos, referências,
schemas, índices, restrições, configurações e estruturas de controle
para todos os elementos, sem exceções não registradas.</p>
<p>3. Executar após os health checks das persistências e antes da
liberação das APIs e workers dependentes.</p>
<p>4. Permanecer separado do startup da aplicação e não depender de
rotas de domínio.</p>
<p>5. Registrar cada execução em FoundationDataRun, com versões,
checksums, etapas, resultados e estado final.</p>
<p>6. Suportar validação de configuração, dry run, relatório de
cobertura, aplicação idempotente, verificação pós-execução e retomada
segura.</p>
<p>7. Preparar ReferenceDatasetRelease, ReferenceImportRun,
ReferenceImportIssue, TerminologyConcept, TerminologyRelation, staging,
quarentena, checkpoint e promoção de releases.</p>
<p>8. Não criar participantes, identidades, consentimentos, espécimes,
telemetria, arquivos ou workflows fictícios para satisfazer
cardinalidades.</p>
<p>9. Bloquear a prontidão das Fases 2 e 3 quando houver erro estrutural
fatal ou elemento sem tratamento definido.</p>
<p>10. Não utilizar perfis reduzidos de MIABIS, SPREC ou de qualquer
outro padrão como modelo-alvo.</p></td>
</tr>
<tr>
<td><strong>RF023</strong></td>
<td>Outbox e projeção Neo4j</td>
<td>O sistema deve registrar eventos de projeção no MongoDB e atualizar
o Neo4j exclusivamente por processamento assíncrono do outbox.</td>
<td>Sistema</td>
<td><p>1. Criar GraphProjectionOutboxEvent.</p>
<p>2. Registrar identificadores canônicos e versão do schema.</p>
<p>3. Calcular hash do payload.</p>
<p>4. Processar com idempotência.</p>
<p>5. Suportar lease, retry e dead letter.</p>
<p>6. Proibir escrita direta de domínio no Neo4j.</p>
<p>7. Não projetar dados civis de ParticipantIdentity.</p></td>
</tr>
<tr>
<td><strong>RF024</strong></td>
<td>Solicitações de acesso e distribuição</td>
<td>O sistema deve registrar solicitações de acesso a dados ou
espécimes, avaliar compatibilidade ética e registrar a decisão do comitê
responsável.</td>
<td>Pesquisador</td>
<td><p>1. Registrar solicitante, estudo, finalidade e itens
solicitados.</p>
<p>2. Avaliar consentimento, DUO e políticas de acesso.</p>
<p>3. Registrar decisão, justificativa e vigência.</p>
<p>4. Vincular aprovação à remessa ou disponibilização.</p>
<p>5. Bloquear acesso expirado, negado ou revogado.</p></td>
</tr>
<tr>
<td><strong>RF025</strong></td>
<td>Ensaios, reagentes e não conformidades</td>
<td>O sistema deve gerenciar ensaios, lotes de reagentes, equipamentos,
controles, não conformidades e ações corretivas.</td>
<td>Técnico</td>
<td><p>1. Vincular espécimes, protocolo, operador e laboratório.</p>
<p>2. Registrar lotes e validade de reagentes.</p>
<p>3. Registrar equipamentos utilizados.</p>
<p>4. Registrar controles do ensaio.</p>
<p>5. Abrir não conformidade e ação corretiva.</p>
<p>6. Preservar causa, ação, responsável e verificação de
eficácia.</p></td>
</tr>
<tr>
<td><strong>RF026</strong></td>
<td>Retenção e destinação</td>
<td>O sistema deve aplicar políticas de retenção e registrar ações de
destinação, descarte ou preservação legal.</td>
<td>Coordenador</td>
<td><p>1. Vincular registros a RetentionPolicy.</p>
<p>2. Aplicar legal hold quando necessário.</p>
<p>3. Registrar DispositionAction.</p>
<p>4. Registrar método, data, responsável e itens afetados.</p>
<p>5. Gerar evidência ou certificado.</p>
<p>6. Impedir destruição quando houver bloqueio ético ou legal.</p></td>
</tr>
<tr>
<td><strong>RF027</strong></td>
<td>Workflows e dados ômicos</td>
<td>O sistema deve registrar a execução reprodutível de workflows
computacionais e a proveniência de arquivos genômicos e
transcriptômicos.</td>
<td>Pesquisador</td>
<td><p>1. Registrar workflow, versão e imagem de container.</p>
<p>2. Registrar parâmetros e dependências.</p>
<p>3. Vincular arquivos de entrada e saída.</p>
<p>4. Registrar início, término, executor e estado.</p>
<p>5. Registrar referência genômica quando aplicável.</p>
<p>6. Registrar qualificação ômica específica ao ensaio.</p>
<p>7. Não incluir IA ou XAI nesta fase.</p></td>
</tr>
<tr>
<td><strong>RF028</strong></td>
<td>Importação de dados de referência</td>
<td>O sistema deve importar, validar, versionar e promover datasets,
ontologias, terminologias e catálogos externos por pipelines explícitos
da Fase 2, preservando licença, proveniência, release e
reprodutibilidade.</td>
<td>Administrador / Sistema</td>
<td><p>1. Registrar a fonte e a release em ReferenceDatasetRelease antes
da carga.</p>
<p>2. Suportar MONDO, HPO, ORPHA, CID, OMIM, HGNC, LOINC, UCUM, ATC,
DCB, DUO, Uberon, NCBI Taxonomy, EDAM e demais fontes aprovadas.</p>
<p>3. Preservar URI de origem, versão, data, licença, checksum, formato,
parserVersion e mappingVersion.</p>
<p>4. Executar download ou leitura, parsing em streaming, normalização,
staging, validação e promoção controlada.</p>
<p>5. Registrar cada tentativa em ReferenceImportRun e cada rejeição em
ReferenceImportIssue.</p>
<p>6. Persistir conceitos em TerminologyConcept e relações em
TerminologyRelation, sempre vinculados à release.</p>
<p>7. Suportar dry run, checkpoint, retomada, idempotência, quarentena,
verificação e rollback de release.</p>
<p>8. Considerar um dataset disponível somente quando houver release
ativa e validada.</p>
<p>9. Persistir primeiro no MongoDB e projetar no Neo4j exclusivamente
pelo outbox.</p>
<p>10. Impedir promoção quando licença, checksum, validação ou
proveniência estiverem ausentes ou inválidos.</p>
<p>11. Para fontes distribuídas em múltiplos endpoints, assets ou
partições, registrar o inventário consultado, as contagens esperadas e
obtidas e a justificativa de qualquer exclusão; cobertura parcial não
justificada bloqueia a promoção da release.</p></td>
</tr>
<tr>
<td><strong>RF029</strong></td>
<td>Ingestão operacional e científica</td>
<td>O sistema deve receber e persistir, na Fase 3, dados operacionais,
clínicos, laboratoriais, científicos e ômicos por APIs, arquivos,
integrações e streams autorizados, utilizando a estrutura e as
referências preparadas nas fases anteriores.</td>
<td>Sistema / Ator autorizado</td>
<td><p>1. Validar todo payload contra os contratos canônicos preparados
na Fase 1.</p>
<p>2. Rejeitar aliases, campos desconhecidos, referências inexistentes e
cardinalidades inválidas.</p>
<p>3. Exigir provenance, origem, timestamps, ator e finalidade conforme
o tipo de dado.</p>
<p>4. Utilizar somente códigos pertencentes a releases de referência
ativas ou registrar revisão controlada quando permitido.</p>
<p>5. Suportar ingestão idempotente e rastreável de participantes,
consentimentos, espécimes, dados clínicos, telemetria, arquivos,
datasets, ensaios, workflows e dados ômicos.</p>
<p>6. Encaminhar registros inválidos para staging ou quarentena, sem
correção silenciosa.</p>
<p>7. Armazenar binários no Object Storage, telemetria de alta
frequência no InfluxDB e documentos canônicos no MongoDB.</p>
<p>8. Gerar AuditEvent e GraphProjectionOutboxEvent quando
aplicável.</p>
<p>9. Não persistir dados civis em projeções Neo4j.</p>
<p>10. Não introduzir IA, Assistente Inteligente ou XAI no escopo
atual.</p></td>
</tr>
</tbody>
</table>

## Requisito funcional de projeto futuro separado

<table style="width:98%;">
<colgroup>
<col style="width: 6%" />
<col style="width: 11%" />
<col style="width: 30%" />
<col style="width: 9%" />
<col style="width: 40%" />
<col style="width: 0%" />
</colgroup>
<thead>
<tr>
<th><strong>ID</strong></th>
<th><strong>Módulo</strong></th>
<th><strong>Descrição</strong></th>
<th><strong>Ator</strong></th>
<th colspan="2"><strong>Critérios de aceitação</strong></th>
</tr>
</thead>
<tbody>
<tr>
<td><strong>RF-FUT-001</strong></td>
<td>Assistente inteligente</td>
<td>Em projeto futuro separado, o sistema poderá prover um Assistente
Inteligente para suporte operacional contextual e tutoria, sem acesso
indevido a dados sensíveis.</td>
<td>Usuário</td>
<td colspan="2"><p>1. Definir arquitetura, riscos, finalidade e base
legal em projeto específico.</p>
<p>2. Restringir respostas a dados e metadados expressamente
autorizados.</p>
<p>3. Registrar interações e decisões de segurança.</p>
<p>4. Não reutilizar este requisito como evidência de funcionalidade
implementada nas Fases 1, 2 ou 3.</p></td>
</tr>
<tr>
<td colspan="5"><p><strong>Regra de exclusão do escopo
atual</strong></p>
<blockquote>
<p>• O requisito RF-FUT-001 não pode ser usado como evidência de
funcionalidade implementada nas Fases 1, 2 ou 3.</p>
<p>• Sua promoção exige novo projeto, finalidade, base legal, avaliação
ética, modelo de dados, riscos, validação e documentação próprios.</p>
</blockquote></td>
<td></td>
</tr>
</tbody>
</table>

# APÊNDICE C - REQUISITOS NÃO FUNCIONAIS DA PLATAFORMA BIOAVANCED

Os requisitos não funcionais foram mantidos quando compatíveis e
ampliados nos pontos afetados pelo pipeline atual. O RNF031 consolida a
preparação integral da Fase 1 e o RNF032 formaliza a governança das
releases externas da Fase 2. Esta revisão também explicita controles de
CI, descoberta de testes, não regressão de cobertura, paridade de
configuração, transações reais, auditoria canônica, escopo de relatórios
e cobertura de fontes com múltiplos endpoints. Metas quantitativas devem
ser verificadas em ambiente de referência documentado.

<table style="width:91%;">
<colgroup>
<col style="width: 4%" />
<col style="width: 9%" />
<col style="width: 14%" />
<col style="width: 55%" />
<col style="width: 5%" />
</colgroup>
<thead>
<tr>
<th><strong>ID</strong></th>
<th><strong>Categoria</strong></th>
<th><strong>Requisito não funcional</strong></th>
<th><strong>Descrição e critérios de aceitação</strong></th>
<th><strong>Prioridade</strong></th>
</tr>
</thead>
<tbody>
<tr>
<td><strong>RNF001</strong></td>
<td>Desempenho</td>
<td>Tempo de resposta da interface</td>
<td><p>A interface deve responder às interações ordinárias do usuário em
até 2 segundos no percentil 95, considerando o ambiente de referência
documentado.</p>
<p>1. Cliques, navegação e abertura de formulários simples atendem ao
limite estabelecido.</p>
<p>2. Operações com duração superior a 500 ms exibem indicador de
processamento.</p>
<p>3. Downloads, importações extensas e indisponibilidade de serviços
externos são medidos separadamente.</p>
<p>4. O resultado é verificado por testes E2E e telemetria do
frontend.</p></td>
<td><strong>Alta</strong></td>
</tr>
<tr>
<td><strong>RNF002</strong></td>
<td>Desempenho</td>
<td>Latência na consulta de espécimes e participantes</td>
<td><p>Consultas simples pelos identificadores canônicos devem retornar
em até 3 segundos no percentil 95 com pelo menos 100.000 registros
operacionais no ambiente de referência.</p>
<p>1. As pesquisas utilizam specimenId, participantId, barcode ou
identificador indexado.</p>
<p>2. Listagens são paginadas e não realizam varredura integral da
coleção.</p>
<p>3. O plano de execução e os índices utilizados são registrados no
teste de carga.</p>
<p>4. Consultas gráficas complexas e relatórios analíticos são avaliados
por cenários próprios.</p></td>
<td><strong>Alta</strong></td>
</tr>
<tr>
<td><strong>RNF003</strong></td>
<td>Disponibilidade</td>
<td>Disponibilidade do serviço</td>
<td><p>A plataforma deve operar continuamente, com disponibilidade
mensal alvo de pelo menos 99,5%, desconsideradas janelas de manutenção
previamente comunicadas.</p>
<p>1. O tempo total de manutenção programada não excede 4 horas por
mês.</p>
<p>2. Indisponibilidades são registradas com início, término, causa e
impacto.</p>
<p>3. Serviços críticos possuem health checks e mecanismos de
reinicialização controlada.</p>
<p>4. A disponibilidade é calculada e publicada em relatório
operacional.</p></td>
<td><strong>Alta</strong></td>
</tr>
<tr>
<td><strong>RNF004</strong></td>
<td>Resiliência</td>
<td>Coleta de telemetria durante falhas de conectividade</td>
<td><p>O subsistema de monitoramento ambiental deve continuar capturando
leituras durante falhas temporárias de comunicação com o servidor
central.</p>
<p>1. O componente de borda mantém buffer durável com timestamp de
origem e identificador do dispositivo.</p>
<p>2. A sincronização posterior é idempotente e preserva a ordem
temporal possível.</p>
<p>3. Leituras já confirmadas não são duplicadas.</p>
<p>4. Nenhuma leitura confirmada pelo componente de borda é perdida por
falha transitória de rede.</p>
<p>5. Lacunas de coleta são identificadas e geram alerta
operacional.</p></td>
<td><strong>Crítica</strong></td>
</tr>
<tr>
<td><strong>RNF005</strong></td>
<td>Usabilidade</td>
<td>Curva de aprendizado</td>
<td><p>Usuários com conhecimento básico de informática devem executar as
operações essenciais após treinamento de até 4 horas.</p>
<p>1. Pelo menos 80% dos participantes do teste de usabilidade concluem
cadastro, consulta e movimentação sem erro crítico.</p>
<p>2. Mensagens de erro indicam o problema e a ação necessária.</p>
<p>3. A terminologia da interface é consistente com o domínio do
biobanco.</p>
<p>4. Operações irreversíveis exigem confirmação explícita.</p></td>
<td><strong>Alta</strong></td>
</tr>
<tr>
<td><strong>RNF006</strong></td>
<td>Suportabilidade</td>
<td>Documentação técnica e de usuário</td>
<td><p>A plataforma deve possuir documentação versionada e compatível
com a versão publicada do sistema.</p>
<p>1. Há guias para participantes autorizados, técnicos, coordenadores e
administradores.</p>
<p>2. Há documentação de instalação, configuração, backup, restauração,
APIs, eventos e troubleshooting.</p>
<p>3. O dicionário de dados e os contratos canônicos são referenciados
como fontes normativas.</p>
<p>4. Mudanças relevantes possuem notas de versão e instruções de
migração.</p>
<p>5. A documentação não contém segredos, credenciais ou dados pessoais
reais.</p>
<p>6. A documentação descreve o Foundation Data Pipeline, os gates das
fases, a gestão de releases de referência e a ingestão operacional.</p>
<p>7. A versão normativa do dicionário consolidado é identificada
explicitamente em cada release do sistema.</p></td>
<td><strong>Alta</strong></td>
</tr>
<tr>
<td><strong>RNF007</strong></td>
<td>Privacidade e LGPD</td>
<td>Segregação da identidade e pseudonimização</td>
<td><p>A identidade civil deve permanecer segregada do registro
científico pseudonimizado.</p>
<p>1. Participant utiliza participantId como identificador canônico de
pesquisa.</p>
<p>2. Nome, data exata de nascimento, contatos e identificadores civis
são mantidos em ParticipantIdentity sob controles reforçados.</p>
<p>3. ParticipantIdentity não é projetado para o Neo4j.</p>
<p>4. Logs, relatórios e exportações omitem ou pseudonimizam
identificadores diretos por padrão.</p>
<p>5. A reidentificação somente ocorre por fluxo autorizado, auditado e
vinculado a finalidade legítima.</p></td>
<td><strong>Crítica</strong></td>
</tr>
<tr>
<td><strong>RNF008</strong></td>
<td>Segurança</td>
<td>Autorização baseada em papéis, permissões e escopo</td>
<td><p>O controle de acesso deve ser aplicado no backend por Role,
Permission e atribuições com escopo.</p>
<p>1. A política padrão é negar o acesso quando não houver permissão
explícita.</p>
<p>2. Os papéis canônicos possuem códigos estáveis e rótulos
localizados.</p>
<p>3. A autorização considera vigência, organização, biobanco, coleção,
estudo ou recurso quando aplicável.</p>
<p>4. A ocultação de controles no frontend não substitui a validação do
backend.</p>
<p>5. Mudanças de papel ou escopo invalidam sessões ou permissões em
cache conforme a política.</p>
<p>6. Rate limits, bloqueios e demais controles de autenticação não
podem ser desativados ou relaxados apenas por NODE_ENV ou indicador
genérico de ambiente; exceções de teste devem usar perfil explícito,
isolado e incapaz de iniciar fora da suíte controlada.</p></td>
<td><strong>Crítica</strong></td>
</tr>
<tr>
<td><strong>RNF009</strong></td>
<td>Auditoria e rastreabilidade</td>
<td>Registro imutável e verificável de auditoria</td>
<td><p>Eventos críticos devem ser registrados em AuditEvent append-only,
pesquisável e verificável.</p>
<p>1. São auditados autenticação, acesso a dados sensíveis, alterações,
exportações, consentimento, custódia, qualidade, políticas e
administração.</p>
<p>2. Cada evento contém ator pseudonimizado, ação, recurso, resultado,
timestamps e correlação.</p>
<p>3. Payloads são sanitizados e não armazenam segredos ou dados
pessoais desnecessários.</p>
<p>4. A integridade é verificada por hash encadeado e/ou consolidação
por raiz Merkle.</p>
<p>5. A aplicação não permite edição ou exclusão dos eventos de
auditoria.</p></td>
<td><strong>Crítica</strong></td>
</tr>
<tr>
<td><strong>RNF010</strong></td>
<td>Confiabilidade</td>
<td>Backup, recuperação e continuidade</td>
<td><p>A plataforma deve adotar estratégia de backup 3-2-1, com cópias
criptografadas e restauração testada.</p>
<p>1. Há pelo menos três cópias, em duas tecnologias ou mídias, com uma
cópia fora do ambiente principal.</p>
<p>2. O RPO alvo dos dados operacionais é de até 24 horas.</p>
<p>3. O RTO alvo para recuperação completa é de até 12 horas.</p>
<p>4. A retenção mínima padrão é de 30 dias, ajustável por política e
exigência legal.</p>
<p>5. Testes de restauração são executados periodicamente e validados
por checksum.</p></td>
<td><strong>Crítica</strong></td>
</tr>
<tr>
<td><strong>RNF011</strong></td>
<td>Qualidade de dados</td>
<td>Integridade, validação e consistência dos registros</td>
<td><p>Metadados críticos e dados importados devem ser validados antes
da promoção ou persistência canônica e permanecer consistentes entre
entidades.</p>
<p>1. Identificadores canônicos são únicos e imutáveis.</p>
<p>2. Campos obrigatórios, tipos, cardinalidades e vocabulários são
validados por schema.</p>
<p>3. Referências inexistentes, posições duplicadas, relações órfãs e
transições inválidas são rejeitadas.</p>
<p>4. Importações inválidas são colocadas em staging ou quarentena, sem
correção silenciosa.</p>
<p>5. Conceitos e relações de terminologia permanecem vinculados à
ReferenceDatasetRelease correspondente.</p>
<p>6. Nenhuma release é ativada com erro fatal aberto.</p>
<p>7. Em teste controlado, a aceitação indevida de valores inválidos em
campos críticos deve ser inferior a 0,1%.</p></td>
<td><strong>Crítica</strong></td>
</tr>
<tr>
<td><strong>RNF012</strong></td>
<td>Conformidade</td>
<td>Apoio aos processos alinhados à ISO 20387</td>
<td><p>O sistema deve apoiar processos de competência, rastreabilidade,
qualidade e gestão de registros coerentes com os princípios aplicáveis
da ISO 20387.</p>
<p>1. A linhagem do participante ao espécime, processamento, localização
e destinação é recuperável.</p>
<p>2. Métodos, equipamentos, não conformidades e evidências possuem
histórico.</p>
<p>3. A documentação mantém matriz de rastreabilidade entre requisitos e
funcionalidades.</p>
<p>4. O sistema não declara certificação ou conformidade formal sem
avaliação institucional independente.</p></td>
<td><strong>Alta</strong></td>
</tr>
<tr>
<td><strong>RNF013</strong></td>
<td>Conformidade e segurança</td>
<td>Gestão de segurança alinhada à ISO/IEC 27001</td>
<td><p>A segurança da informação deve ser orientada por risco e por
controles compatíveis com os princípios da ISO/IEC 27001.</p>
<p>1. Ativos, riscos, responsáveis e tratamentos são documentados.</p>
<p>2. Há controles de acesso, gestão de incidentes, continuidade,
backup, registro e revisão periódica.</p>
<p>3. Exceções de segurança possuem aprovação, prazo e risco
residual.</p>
<p>4. O sistema não declara certificação ISO/IEC 27001 sem auditoria
formal da organização.</p></td>
<td><strong>Alta</strong></td>
</tr>
<tr>
<td><strong>RNF014</strong></td>
<td>Portabilidade</td>
<td>Conteinerização e reprodutibilidade de ambientes</td>
<td><p>Os componentes implantáveis devem ser empacotados em containers
versionados e reproduzíveis.</p>
<p>1. As imagens são construídas por arquivo declarativo e possuem
versão ou digest imutável.</p>
<p>2. Configurações são externas à imagem e segredos não são
incorporados ao artefato.</p>
<p>3. Containers possuem health checks, limites de recursos e execução
sem privilégios desnecessários.</p>
<p>4. Desenvolvimento, teste e produção utilizam a mesma família de
artefatos.</p>
<p>5. Kubernetes é opcional e não constitui dependência obrigatória da
arquitetura.</p>
<p>6. O Foundation Data Pipeline é empacotado como job ou container
one-shot versionado e possui condição de conclusão verificável.</p>
<p>7. A liberação de APIs e workers dependentes considera o resultado do
gate de prontidão da Fase 1.</p>
<p>8. O build em CI parte de checkout limpo, utiliza o lockfile e a
mesma base Linux dos containers; dependências nativas ou opcionais e
runners suportados são verificados para impedir divergência entre
desenvolvimento, container e CI.</p></td>
<td><strong>Alta</strong></td>
</tr>
<tr>
<td><strong>RNF015</strong></td>
<td>Observabilidade</td>
<td>Monitoramento de aplicação, infraestrutura e filas</td>
<td><p>A plataforma deve produzir métricas, logs e rastreamento
suficientes para detectar falhas e degradação.</p>
<p>1. São monitorados frontend, APIs, workers, MongoDB, Neo4j, InfluxDB,
Redis, Object Storage e integrações.</p>
<p>2. Há alertas para indisponibilidade, latência, erro, CPU, memória,
disco, fila acumulada e dead letter.</p>
<p>3. Eventos correlacionados compartilham traceId ou identificador
equivalente.</p>
<p>4. Prometheus, Grafana, Nagios ou ferramentas equivalentes podem ser
adotados conforme a implantação.</p>
<p>5. Logs observacionais permanecem separados do AuditEvent
normativo.</p>
<p>6. FoundationDataRun, ReferenceImportRun, ReferenceImportIssue,
promoção de releases e backlog de projeção possuem métricas e
alertas.</p>
<p>7. Falhas estruturais da Fase 1 e falhas fatais de importação da Fase
2 são distinguíveis de falhas operacionais da Fase 3.</p>
<p>8. Avisos observacionais repetitivos são deduplicados ou limitados
por frequência, preservando contadores e amostras suficientes para
diagnóstico sem inundar os logs.</p></td>
<td><strong>Alta</strong></td>
</tr>
<tr>
<td><strong>RNF016</strong></td>
<td>Escalabilidade</td>
<td>Escalabilidade independente da persistência poliglota</td>
<td><p>Cada tecnologia de persistência deve poder evoluir conforme seu
padrão de carga, sem criar fonte canônica concorrente.</p>
<p>1. MongoDB atende documentos operacionais e outbox.</p>
<p>2. Neo4j atende projeções de linhagem e governança.</p>
<p>3. InfluxDB atende telemetria de alta frequência.</p>
<p>4. Object Storage atende arquivos científicos e evidências.</p>
<p>5. Testes de capacidade documentam limites, índices, particionamento
e estratégia de expansão de cada componente.</p></td>
<td><strong>Alta</strong></td>
</tr>
<tr>
<td><strong>RNF017</strong></td>
<td>Qualidade de software</td>
<td>Automação de testes e gates de integração</td>
<td><p>A esteira de integração deve executar testes automatizados antes
da incorporação de mudanças.</p>
<p>1. Há testes unitários, integração, contrato, arquitetura, segurança
e E2E.</p>
<p>2. Playwright ou ferramenta equivalente cobre 100% das jornadas
críticas listadas na matriz de testes.</p>
<p>3. Falhas em lint, typecheck, schema, contrato ou jornada crítica
bloqueiam a integração.</p>
<p>4. Os testes utilizam dados sintéticos e não expõem informações
reais.</p>
<p>5. Cobertura numérica é monitorada, mas não substitui a cobertura de
risco e de cenários.</p>
<p>6. A CI verifica a cobertura integral do dicionário vigente pelo
Foundation Data Pipeline.</p>
<p>7. Testes de importação validam idempotência, checkpoint, quarentena,
promoção, rollback e reconciliação do outbox.</p>
<p>8. A CI descobre todos os arquivos de teste do repositório e falha
quando algum arquivo não é alcançado por nenhum comando executado.</p>
<p>9. A linha de base de cobertura numérica é versionada; regressão
bloqueia a integração, salvo alteração explicitamente justificada,
aprovada e acompanhada da atualização da matriz de riscos e
cenários.</p>
<p>10. O E2E com Playwright ou equivalente executa na CI contra a
composição real de containers, em ambiente limpo, e não somente por
execução manual ou mocks.</p></td>
<td><strong>Crítica</strong></td>
</tr>
<tr>
<td><strong>RNF018</strong></td>
<td>Validação</td>
<td>Validação em múltiplas camadas</td>
<td><p>Entradas devem ser validadas no frontend e novamente no backend a
partir dos contratos canônicos.</p>
<p>1. A validação ordinária da interface responde em até 1 segundo.</p>
<p>2. Bibliotecas como Zod, JSON Schema ou equivalentes podem ser
utilizadas.</p>
<p>3. O backend permanece autoritativo e rejeita propriedades
desconhecidas ou aliases não permitidos.</p>
<p>4. Payloads não canônicos retornam erro explícito, preferencialmente
HTTP 422.</p>
<p>5. Regras críticas não dependem exclusivamente da validação do
cliente.</p></td>
<td><strong>Crítica</strong></td>
</tr>
<tr>
<td><strong>RNF019</strong></td>
<td>Resiliência de eventos</td>
<td>Outbox durável, retries e reconciliação</td>
<td><p>Eventos destinados ao Neo4j devem ser persistidos em
GraphProjectionOutboxEvent antes do processamento assíncrono.</p>
<p>1. O processamento utiliza entrega pelo menos uma vez e consumidores
idempotentes.</p>
<p>2. Há lease, timeout, retries limitados, backoff e dead letter.</p>
<p>3. Nenhum evento confirmado no outbox é perdido por falha
transitória.</p>
<p>4. A reconciliação detecta projeções ausentes ou divergentes e
permite reprocessamento seguro.</p>
<p>5. Escritas diretas de domínio no Neo4j são proibidas.</p></td>
<td><strong>Crítica</strong></td>
</tr>
<tr>
<td><strong>RNF020</strong></td>
<td>Criptografia</td>
<td>Proteção criptográfica e gestão de segredos</td>
<td><p>Dados, credenciais e segredos devem ser protegidos durante
armazenamento, transmissão e processamento.</p>
<p>1. Comunicações externas utilizam TLS 1.2 ou superior.</p>
<p>2. Senhas são armazenadas somente por algoritmo de hash adaptativo
apropriado.</p>
<p>3. Tokens de recuperação e códigos sensíveis são armazenados por
hash; segredos MFA são cifrados.</p>
<p>4. ParticipantIdentity e outros campos críticos utilizam criptografia
em repouso ou por campo.</p>
<p>5. Segredos são fornecidos por mecanismo seguro e podem ser
rotacionados sem alteração de código.</p>
<p>6. Segredos e valores sensíveis não aparecem em logs.</p>
<p>7. .env.example, Compose, CI e runners de teste usam o mesmo conjunto
de chaves de configuração e uma única origem para cada segredo;
divergência, chave ausente ou segredo hardcoded bloqueia o
gate.</p></td>
<td><strong>Crítica</strong></td>
</tr>
<tr>
<td><strong>RNF021</strong></td>
<td>Segurança de sessão</td>
<td>Ciclo de vida seguro de sessões e tokens</td>
<td><p>Sessões autenticadas devem possuir duração limitada, revogação e
proteção contra reutilização indevida.</p>
<p>1. Access tokens são de curta duração e refresh tokens, quando
utilizados, possuem rotação.</p>
<p>2. Logout, inativação, troca de senha ou alteração crítica de papel
revogam as sessões afetadas.</p>
<p>3. Timeout por inatividade e duração máxima são configuráveis.</p>
<p>4. Tokens não são persistidos em texto claro no banco.</p>
<p>5. Cookies, quando utilizados, aplicam Secure, HttpOnly e SameSite
adequados.</p>
<p>6. O usuário pode consultar e encerrar suas sessões ativas.</p></td>
<td><strong>Crítica</strong></td>
</tr>
<tr>
<td><strong>RNF022</strong></td>
<td>Privacidade e retenção</td>
<td>Minimização, retenção e destinação de dados</td>
<td><p>A plataforma deve coletar e manter somente dados necessários às
finalidades documentadas.</p>
<p>1. Cada classe de dado possui finalidade, sensibilidade, prazo de
retenção e responsável.</p>
<p>2. Legal hold impede descarte quando houver obrigação ética,
científica ou legal.</p>
<p>3. Exclusões permitidas utilizam destinação controlada,
pseudonimização ou descarte verificável.</p>
<p>4. Contas vinculadas a auditoria são inativadas ou pseudonimizadas,
evitando exclusão física destrutiva.</p>
<p>5. Relatórios e ambientes de teste aplicam minimização e dados
sintéticos.</p></td>
<td><strong>Crítica</strong></td>
</tr>
<tr>
<td><strong>RNF023</strong></td>
<td>Evolução do modelo</td>
<td>Versionamento de schemas e migrações controladas</td>
<td><p>Mudanças no modelo de dados, APIs e eventos devem ser versionadas
e migráveis.</p>
<p>1. Documentos e eventos registram schemaVersion.</p>
<p>2. Alterações incompatíveis exigem nova versão de contrato e plano de
migração.</p>
<p>3. Migrações são idempotentes, observáveis e testadas com cópia ou
dados sintéticos.</p>
<p>4. Aliases legados não são aceitos silenciosamente em novos
contratos.</p>
<p>5. Dicionário, diagramas, schemas, backend, frontend e testes são
atualizados no mesmo ciclo de mudança.</p>
<p>6. Há estratégia documentada de rollback ou recuperação.</p>
<p>7. Alterações na Fase 1, nos importadores da Fase 2 ou nos contratos
da Fase 3 referenciam a mesma versão normativa do dicionário.</p>
<p>8. A adição de entidade ou campo ocorre primeiro no XLSX consolidado
e somente depois em schemas, código, diagramas e testes.</p></td>
<td><strong>Crítica</strong></td>
</tr>
<tr>
<td><strong>RNF024</strong></td>
<td>Interoperabilidade</td>
<td>FHIR R4 como fronteira sem efeitos colaterais</td>
<td><p>Conversões FHIR devem funcionar como transformação de
interoperabilidade e não como persistência paralela.</p>
<p>1. Recursos são validados contra estrutura e perfil adotados.</p>
<p>2. A conversão preserva identificadores canônicos, versão e
proveniência.</p>
<p>3. Funções de serialização não escrevem diretamente no MongoDB ou
Neo4j.</p>
<p>4. Recursos FHIR não são persistidos como coleções operacionais
canônicas.</p>
<p>5. Importações utilizam staging, validação e quarentena quando
necessário.</p></td>
<td><strong>Crítica</strong></td>
</tr>
<tr>
<td><strong>RNF025</strong></td>
<td>Temporalidade</td>
<td>Consistência de timestamps e sincronização de relógios</td>
<td><p>Eventos de consentimento, custódia, auditoria, telemetria e
processamento devem possuir temporalidade consistente e verificável.</p>
<p>1. Serviços e dispositivos sincronizam relógio por mecanismo
institucional, como NTP.</p>
<p>2. Timestamps canônicos são armazenados em UTC com informação
suficiente para apresentação local.</p>
<p>3. Telemetria distingue occurredAt, receivedAt e persistedAt quando
aplicável.</p>
<p>4. Desvios de relógio acima do limite configurado são detectados.</p>
<p>5. Ordenação temporal não depende exclusivamente da hora do
cliente.</p></td>
<td><strong>Alta</strong></td>
</tr>
<tr>
<td><strong>RNF026</strong></td>
<td>Desempenho de alertas</td>
<td>Latência e confiabilidade das notificações críticas</td>
<td><p>Alertas críticos devem ser emitidos com baixa latência e possuir
rastreabilidade de entrega.</p>
<p>1. Alertas de excursão ambiental e ataque de força bruta são
encaminhados em até 2 minutos no percentil 95 após a detecção, no
ambiente de referência.</p>
<p>2. Falhas de envio utilizam retry e escalonamento configuráveis.</p>
<p>3. Cada tentativa registra canal, horário, resultado e evento
originador.</p>
<p>4. A mensagem evita dados pessoais ou científicos
desnecessários.</p></td>
<td><strong>Alta</strong></td>
</tr>
<tr>
<td><strong>RNF027</strong></td>
<td>Acessibilidade e compatibilidade</td>
<td>Acesso inclusivo e compatibilidade de interface</td>
<td><p>A interface deve seguir princípios de acessibilidade compatíveis
com nível AA e operar nos navegadores suportados pela instituição.</p>
<p>1. Navegação essencial é possível por teclado.</p>
<p>2. Campos possuem rótulos, foco visível, contraste adequado e
mensagens associadas.</p>
<p>3. Componentes críticos são testados com tecnologias assistivas
representativas.</p>
<p>4. A aplicação suporta as duas versões estáveis mais recentes dos
navegadores definidos na matriz de suporte.</p>
<p>5. O layout permanece utilizável em resoluções institucionais
previstas.</p></td>
<td><strong>Média</strong></td>
</tr>
<tr>
<td><strong>RNF028</strong></td>
<td>Manutenibilidade</td>
<td>Modularidade, qualidade interna e governança arquitetural</td>
<td><p>O código deve manter separação de responsabilidades e limites
coerentes com os domínios do modelo.</p>
<p>1. Escritas canônicas, projeções, interoperabilidade e apresentação
permanecem em camadas distintas.</p>
<p>2. Não há dual write entre MongoDB e Neo4j.</p>
<p>3. Lint, typecheck, análise de dependências e testes de arquitetura
integram a CI.</p>
<p>4. Dependências críticas são atualizadas por processo controlado.</p>
<p>5. Dívidas técnicas e superfícies legadas possuem inventário,
prioridade e plano de remoção.</p>
<p>6. O gate modelo-código impede alterações que contradigam o
dicionário aprovado.</p>
<p>7. O gate modelo-código verifica que todos os elementos do dicionário
vigente possuem tratamento explícito no Foundation Data Pipeline.</p>
<p>8. Importadores de referência e ingestores operacionais não podem
criar campos, aliases ou entidades fora do modelo aprovado.</p></td>
<td><strong>Crítica</strong></td>
</tr>
<tr>
<td><strong>RNF029</strong></td>
<td>Segurança de arquivos</td>
<td>Integridade e proteção do Object Storage</td>
<td><p>Arquivos científicos e evidências devem ser armazenados fora dos
documentos operacionais, com integridade e acesso controlados.</p>
<p>1. O upload valida tamanho, MIME, extensão e política de formato.</p>
<p>2. Cada arquivo possui checksum SHA-256, tamanho, URI, versão e
proveniência.</p>
<p>3. O conteúdo é submetido a verificação de malware quando a
infraestrutura permitir.</p>
<p>4. Acesso ocorre por credencial temporária ou mecanismo equivalente,
com auditoria.</p>
<p>5. Criptografia, retenção e ciclo de vida seguem a classificação do
dado.</p>
<p>6. Binários grandes não são incorporados ao documento
MongoDB.</p></td>
<td><strong>Alta</strong></td>
</tr>
<tr>
<td><strong>RNF030</strong></td>
<td>Reprodutibilidade</td>
<td>Proveniência computacional de workflows e dados ômicos</td>
<td><p>Execuções computacionais devem ser reprodutíveis e rastreáveis
até entradas, parâmetros, ambiente e saídas.</p>
<p>1. WorkflowRun registra versão do workflow, imagem ou digest do
container, parâmetros e executor.</p>
<p>2. Entradas e saídas possuem identificador, versão e checksum.</p>
<p>3. Referências genômicas, bibliotecas e ferramentas são
versionadas.</p>
<p>4. Falhas, retomadas e derivações são registradas por evento.</p>
<p>5. A proveniência pode ser mapeada para PROV-O.</p></td>
<td><strong>Alta</strong></td>
</tr>
</tbody>
</table>

## Requisitos não funcionais específicos do pipeline

Os requisitos RNF031 e RNF032 são apresentados em formato expandido por
concentrarem os gates de prontidão das Fases 1 e 2.

**RNF031 - Preparação integral, versionada, idempotente e integrada à
implantação**

  ----------------------------------------------------------------------------
  **Categoria**   **Aplicação**        **Prioridade**   **Status**
  --------------- -------------------- ---------------- ----------------------
  Foundation Data F1 - Foundation      Crítica          Obrigatório para o
  Pipeline                                              gate da fase

  ----------------------------------------------------------------------------

A preparação estrutural do BioAvanceD deve ser realizada pelo Foundation
Data Pipeline, executado como etapa controlada da implantação dos
containers, separado do startup da aplicação e derivado integralmente da
versão vigente do dicionário consolidado.

> 1\. Preparar 100% dos elementos do dicionário vigente; na versão
> 1.3.0, isso corresponde a 929 elementos.
>
> 2\. Criar ou validar entidades, campos, objetos embutidos,
> referências, schemas, validadores, índices, coleções, configurações e
> estruturas de controle sem exceções não registradas.
>
> 3\. Tratar MIABIS, SPREC e os demais padrões conforme o levantamento
> integral incorporado ao dicionário, sem perfil reduzido como
> modelo-alvo.
>
> 4\. Executar como container ou job one-shot após os health checks das
> persistências e antes da liberação das APIs e workers dependentes.
>
> 5\. Permanecer tecnicamente separado do startup da aplicação; a API
> não pode criar silenciosamente estrutura ou dados ao iniciar.
>
> 6\. Ser versionado, reproduzível, idempotente e retomável, sem
> duplicação, corrupção ou perda de configuração válida.
>
> 7\. Registrar cada execução em FoundationDataRun com pipelineVersion,
> schemaVersion, dictionaryVersion, checksums, ambiente, implantação,
> tempos, etapas, resultados, validação, erros e estado final.
>
> 8\. Preparar ReferenceDatasetRelease, ReferenceImportRun,
> ReferenceImportIssue, TerminologyConcept, TerminologyRelation,
> staging, quarentena, checkpoint, promoção, índices de unicidade e
> suporte ao outbox.
>
> 9\. Disponibilizar validação de configuração, dry run, verificação de
> schemas e índices, comparação de versão, relatório de cobertura e
> verificação pós-execução.
>
> 10\. Demonstrar tratamento explícito para cada elemento: persistência,
> objeto embutido, referência, geração, cálculo, integração,
> armazenamento externo ou regra de não persistência.
>
> 11\. Não inserir participantes, identidades, consentimentos,
> espécimes, eventos clínicos, telemetria, arquivos ou workflows
> fictícios para satisfazer cardinalidades.
>
> 12\. Preparar a infraestrutura para a Fase 2, na qual datasets
> externos são importados com release, licença, checksum, proveniência,
> parser, mapeamento, execução, rejeições e promoção.
>
> 13\. Considerar um dataset disponível somente quando houver
> ReferenceDatasetRelease ativa e validada.
>
> 14\. Proibir escrita direta das cargas no Neo4j; o MongoDB permanece
> fonte operacional e o grafo é atualizado exclusivamente pelo outbox.
>
> 15\. Declarar o ambiente pronto para as Fases 2 e 3 somente quando o
> pipeline concluir com sucesso, os schemas e índices estiverem
> aplicados, não houver erro estrutural fatal e a cobertura indicar zero
> elemento sem tratamento.

**RNF032 - Proveniência, qualidade, promoção e rollback de releases
externas**

  ----------------------------------------------------------------------------
  **Categoria**   **Aplicação**        **Prioridade**   **Status**
  --------------- -------------------- ---------------- ----------------------
  Governança de   F2 - referências     Crítica          Obrigatório para o
  dados de                                              gate da fase
  referência                                            

  ----------------------------------------------------------------------------

As cargas da Fase 2 devem preservar a identidade, a proveniência e o
ciclo de vida de cada dataset externo, permitindo validação, ativação e
reversão controladas.

> 1\. Toda carga utiliza fonte oficial ou aprovada, versão identificável
> e licença registrada.
>
> 2\. O arquivo ou payload de origem possui checksum e é preservado no
> Object Storage quando aplicável.
>
> 3\. Parser, normalizador e mapeamento possuem versões explícitas.
>
> 4\. A importação utiliza staging, validação estrutural e semântica,
> quarentena e limiar de rejeição definido.
>
> 5\. Execuções são idempotentes, retomáveis por checkpoint e
> registradas em ReferenceImportRun.
>
> 6\. Rejeições são rastreadas em ReferenceImportIssue, sem descarte ou
> correção silenciosa.
>
> 7\. Conceitos e relações permanecem vinculados à
> ReferenceDatasetRelease de origem.
>
> 8\. A ativação de uma release é explícita e verificável; a release
> anterior permanece disponível para rollback.
>
> 9\. Promoção e rollback geram auditoria e eventos de outbox quando
> houver projeção semântica.
>
> 10\. O sistema não declara disponibilidade de um vocabulário apenas
> porque o schema suporta seus códigos.
>
> 11\. Para fontes com múltiplos endpoints, assets ou partições, a
> promoção exige manifesto de cobertura com cada origem consultada,
> contagens esperadas e obtidas e justificativa explícita para
> exclusões; cobertura parcial não justificada bloqueia a release.

# 4. Matriz de coerência do pipeline

A matriz destaca os requisitos que sustentam diretamente a separação
entre preparação estrutural, população de referências e ingestão
operacional. Ela não substitui a rastreabilidade completa no repositório
e nos testes.

  --------------------------------------------------------------------------------
  **Fluxo**     **Requisitos        **Requisitos não     **Evidência mínima**
                funcionais**        funcionais**         
  ------------- ------------------- -------------------- -------------------------
  Fase 1 -      RF022; RF021;       RNF014; RNF015;      FoundationDataRun
  Foundation    RF019; RF024        RNF017; RNF023;      concluído; relatório de
                                    RNF028; RNF031       cobertura; schemas e
                                                         índices; testes de
                                                         idempotência e prontidão.

  Fase 2 -      RF028; RF005; RF019 RNF011; RNF015;      ReferenceDatasetRelease
  Referências                       RNF019; RNF023;      ativa; ReferenceImportRun
                                    RNF032               concluído; issues
                                                         resolvidos; checksums e
                                                         licença; rollback
                                                         testado.

  Fase 3 -      RF029 e requisitos  RNF001-RNF030        Payloads validados;
  Operacional   funcionais          aplicáveis ao        referências ativas;
                aplicáveis de       domínio              AuditEvent; outbox;
                RF001-RF027                              proveniência; dados reais
                                                         ou sintéticos de teste,
                                                         nunca dados fictícios de
                                                         bootstrap.

  Transversal   RF011; RF012;       RNF003; RNF006;      Documentação, backup,
                RF013; RF023; RF024 RNF010;              segurança,
                                    RNF012-RNF020;       observabilidade, testes,
                                    RNF023; RNF025;      versionamento,
                                    RNF028               interoperabilidade e
                                                         reconciliação.
  --------------------------------------------------------------------------------

# 5. Regras finais de governança

> • Toda mudança de entidade, campo, cardinalidade, fase, terminologia
> ou persistência deve ser registrada primeiro no dicionário consolidado
> e no changelog.
>
> • O código existente não possui autoridade para reduzir o modelo-alvo;
> diferenças da branch main devem ser tratadas como gaps de
> implementação ou migração.
>
> • A disponibilidade de um vocabulário é comprovada por release ativa e
> validada, não apenas pela existência de campos capazes de armazenar
> seus códigos.
>
> • O Foundation Data Pipeline deve subir com a implantação como job
> controlado, mas não pode ser confundido com o startup interno da API.
>
> • As Fases 2 e 3 não podem criar entidades ou campos fora do modelo
> preparado na Fase 1.
>
> • IA, Assistente Inteligente e XAI permanecem fora deste documento,
> exceto como referência explícita de projeto futuro separado.
>
> • A série de requisitos funcionais encerra-se em RF029; qualquer
> referência a RF030 é inválida e deve bloquear a rastreabilidade até
> sua correção.

*Fonte: Elaborado pela autora (2025), revisado, reconciliado e
consolidado em 2026.*
