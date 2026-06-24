# Memorial Descritivo - BioAvanceD v1.1.0

## 1. Identificacao do programa

- Nome do programa: BioAvanceD
- Versao do software: BioAvanceD v1.1.0
- Motor metodologico: RCS-GOV 1.0
- Titulo sugerido: BioAvanceD - Sistema Especialista para Gestao, Rastreabilidade e Certificacao de Qualidade de Biospecimes com Ribeiro Classification Score
- Natureza: Programa de computador / sistema especialista biomedico
- Tipo de Programa: IA02 - Sistemas Especialistas
- Campo de Aplicacao: SD09 - Engenharia Biomedica
- Linguagens: JavaScript, TypeScript, Node.js, React
- Banco de dados/infraestrutura: MongoDB, Neo4j, Redis, InfluxDB, Docker Compose
- Algoritmo de hash pretendido: SHA-512
- Resumo digital: gerado externamente apos o empacotamento oficial da tag

## 2. Finalidade

O BioAvanceD e uma plataforma para gestao de biobancos, pacientes, amostras biologicas, rastreabilidade, TCLE/e-consent, auditoria, importacao FHIR, interoperabilidade e certificacao de qualidade de biospecimes. O sistema organiza o ciclo operacional de recebimento, cadastro, avaliacao, armazenamento, rastreamento, liberacao e auditoria de amostras, com suporte a fluxo manual via Intake Wizard e a importacao em lote por padrao FHIR.

## 3. Diferencial tecnico

O diferencial tecnico do BioAvanceD esta na integracao entre gestao operacional de biobanco e um motor deterministico de classificacao RCS-GOV 1.0/1.1, baseado no Ribeiro Classification Score. O sistema incorpora gate de governanca nao compensavel, classificacao A-E, calculo RCS = 100 - Pbio, uso de eixos SPREC por matriz e seeds S1/S2/S3 como base metodologica. Tambem inclui rastreabilidade com Merkle/ledger, quarentena logica, sincronizacao MongoDB -> Neo4j, importacao FHIR por staging, TCLE dinamico, integracao Resend para envio de e-mails e arquitetura Docker para implantacao.

## 4. Metodologia principal

A metodologia principal e o modelo governance-aware heuristic penalty model para gestao de qualidade de biospecimes em biobancos. O modelo combina:

- gate de governanca nao compensavel;
- escore biologico-operacional por eixos SPREC;
- certificacao A-E;
- rastreabilidade do calculo por `calculation_trace`;
- preservacao de `axis_penalties`;
- tratamento de valores desconhecidos, ausentes ou invalidos como contexto de governanca/not scored, nunca como severidade zero.

## 5. Regras de calculo RCS-GOV

- RCS = 100 - Pbio.
- Pbio = soma dos pesos maximos por eixo multiplicados pela severidade intraeixo.
- Fluid:
  - Ppre = 30;
  - Pcent1 = 15;
  - Pcent2 = 10;
  - Ppost = 20;
  - Pstore = 25.
- Solid:
  - Pwarm = 25;
  - Pcold = 25;
  - Pfix = 15;
  - PfixTime = 20;
  - Pstore = 15.
- Grade A se RCS >= 90.
- Grade B se 80 <= RCS < 90.
- Grade C se 65 <= RCS < 80.
- Grade D se 50 <= RCS < 65.
- Grade E se RCS < 50 ou Ggov = 0.
- Falha critica de governanca roteia diretamente para Grade E.

## 6. Modulos atuais do sistema

- autenticacao;
- RBAC;
- pacientes;
- amostras;
- Intake Wizard;
- RCS-GOV;
- importacao inteligente FHIR;
- staging de importacao;
- TCLE/e-consent;
- Consent Builder;
- envio de TCLE por e-mail;
- quarentena etica/operacional;
- etiquetas;
- auditoria;
- Merkle/integridade;
- armazenamento;
- sensores/IoT;
- telemetria;
- temperatura;
- relatorios;
- incidentes;
- terminologias;
- Orphadata/HPO;
- MongoDB;
- Neo4j;
- Redis;
- InfluxDB;
- Docker/VM.

## 7. Fluxo de importacao FHIR atualizado

O uso diario preferencial e feito pelo Intake Wizard. A importacao FHIR e destinada a lotes de transferencia e pesquisadores, usando FHIR R4 Bundle JSON como padrao principal. O Excel e apenas modelo auxiliar e deve ser convertido para JSON FHIR antes do staging.

Dados importados passam por staging, validacao e revisao antes da consolidacao. O fluxo permite identificar erros por campo, pendencias de TCLE e registros prontos para commit. Amostras podem ser salvas em quarentena, o TCLE pode ser enviado por e-mail e amostras permanecem bloqueadas ate assinatura do TCLE ou anexacao/validacao documental por coordenador/administrador. Salvar amostra nao significa liberar para uso.

## 8. Quarentena etica e consentimento

Estados documentados:

- PENDING_CONSENT;
- TCLE_SENT;
- SIGNED;
- EXTERNAL_ATTACHED;
- WAIVED_TRANSFER, se aplicavel;
- QUARANTINED;
- RELEASED;
- NEEDS_REVIEW;
- BLOCKED;
- AVAILABLE.

Amostras transferidas de outro biobanco podem exigir documentacao externa e validacao por pessoa autorizada. O sistema separa cadastro/consolidacao da liberacao operacional, permitindo quarentena etica ou operacional ate que a documentacao esteja adequada.

## 9. Rastreabilidade e integridade

O BioAvanceD registra cadeia de custodia, eventos auditaveis, Merkle Tree, auditoria append-only e logs de eventos relevantes. Hash SHA-256 pode ser utilizado para cadeia interna de integridade quando aplicavel. O hash SHA-512 sera usado para o resumo digital do pacote oficial do INPI, apos geracao do ZIP por `git archive`.

## 10. Seguranca e conformidade

O sistema foi projetado considerando LGPD, ISO 20387, RBAC, autenticacao, controle de acesso, criptografia, trilhas de auditoria, pseudonimizacao/anonimizacao quando aplicavel, nao uso de dados reais em testes e exclusao de segredos do pacote de registro.

## 11. Arquitetura tecnica

- Frontend React/TypeScript.
- Backend Node.js/Express.
- MongoDB para documentos.
- Neo4j para grafo/rastreabilidade.
- Redis para filas/cache.
- InfluxDB para series temporais.
- Docker Compose para orquestracao.
- Resend como unica integracao externa de e-mail mantida.

## 12. Validacao

Validacoes de referencia:

- property-based checks;
- testes unitarios;
- testes de integracao;
- testes E2E;
- smoke test da VM;
- validacao de CORS;
- validacao de health check;
- validacao de RCS-GOV;
- validacao de Merkle/integridade;
- validacao do fluxo FHIR/staging/quarentena, se implementado.

## 13. Escopo do congelamento

A versao anterior `v1.0.0-inpi-rcs-gov` foi substituida antes da submissao efetiva por invalidacao operacional do pacote anterior. A nova versao oficial pretendida para submissao e `v1.1.0-inpi-rcs-gov`. A tag nova ainda sera criada apos revisao documental. O hash SHA-512 sera gerado apos o ZIP oficial por `git archive`.

## 14. Exclusoes do pacote

O pacote INPI nao deve conter:

- `.git`;
- `node_modules`;
- `dist`;
- `build`;
- `coverage`;
- `playwright-report`;
- `test-results`;
- `.env`;
- `.env.docker` real;
- logs;
- uploads;
- backups;
- dumps de banco;
- secrets;
- tokens;
- chaves privadas.

## 15. Dados para formulario INPI/NIT

- Titulo: BioAvanceD - Sistema Especialista para Gestao, Rastreabilidade e Certificacao de Qualidade de Biospecimes com Ribeiro Classification Score
- Versao do software: BioAvanceD v1.1.0
- Motor metodologico: RCS-GOV 1.0
- Linguagem: JavaScript, TypeScript, Node.js, React
- Tipo de Programa: IA02 - Sistemas Especialistas
- Campo de Aplicacao: SD09 - Engenharia Biomedica
- Algoritmo Hash: SHA-512
- Hash SHA-512: preencher apos geracao do ZIP oficial
- Observacao: data de criacao/publicacao a confirmar com NIT
