# Memorial Descritivo - BioAvanceD v1.1.0

## 1. Identificacao do programa

- Nome: BioAvanceD
- Versao do software: BioAvanceD v1.1.0
- Motor metodologico: RCS-GOV 1.0
- Titulo sugerido: BioAvanceD - Sistema Especialista para Gestao, Rastreabilidade e Certificacao de Qualidade de Biospecimes com Ribeiro Classification Score
- Tipo de Programa: IA02 - Sistemas Especialistas
- Campo de Aplicacao: SD09 - Engenharia Biomedica
- Linguagens: JavaScript, TypeScript, Node.js, React
- Banco/infraestrutura: MongoDB, Neo4j, Redis, InfluxDB, Docker Compose
- Algoritmo de hash pretendido: SHA-512
- Hash real: pendente, a ser gerado apenas apos o ZIP oficial por `git archive`
- Branch futura de congelamento: `release/inpi-v1.1.0-rcs-gov`
- Tag futura: `v1.1.0-inpi-rcs-gov`

## 2. Finalidade

BioAvanceD e uma plataforma para gestao de biobancos, pacientes, amostras biologicas, consentimento eletronico, rastreabilidade, auditoria, interoperabilidade e certificacao de qualidade de biospecimes. O software apoia cadastro manual, importacao em lote, revisao tecnica, quarentena, emissao de etiquetas, controle de movimentacoes e liberacao de amostras conforme regras de governanca.

## 3. Diferencial tecnico

O diferencial tecnico do BioAvanceD e combinar operacao de biobanco com um sistema especialista deterministico de qualidade. O motor RCS-GOV 1.0 aplica o Ribeiro Classification Score, gate de governanca nao compensavel, classificacao A-E, calculo `RCS = 100 - Pbio`, pesos por eixos SPREC, rastreabilidade por `calculation_trace` e preservacao de `axis_penalties`.

## 4. Modulos principais

- autenticacao, sessoes e RBAC;
- pacientes;
- amostras;
- Intake Wizard;
- RCS-GOV 1.0;
- TCLE/e-consent;
- Consent Builder;
- importacao FHIR em lote;
- staging de importacao;
- quarentena etica e operacional;
- etiquetas;
- auditoria e logs;
- Merkle/integridade;
- armazenamento;
- sensores/IoT;
- telemetria e temperatura;
- incidentes;
- relatorios;
- terminologias, Orphadata e HPO;
- sincronizacao MongoDB para Neo4j;
- backup e suporte operacional.

## 5. Arquitetura

O sistema utiliza frontend React/TypeScript, backend Node.js/Express, MongoDB para documentos operacionais, Neo4j para grafo/rastreabilidade, Redis para filas/cache, InfluxDB para series temporais e Docker Compose para orquestracao. Resend e mantido como integracao externa permitida para envio de e-mails de TCLE.

## 6. RCS-GOV 1.0

RCS-GOV 1.0 e o motor metodologico preservado no congelamento do software BioAvanceD v1.1.0. A metodologia aplica:

- `RCS = 100 - Pbio`;
- penalidades por eixos SPREC;
- classificacao final A-E;
- gate de governanca nao compensavel;
- tratamento de unknown/not scored como contexto de governanca ou revisao, nunca como severidade zero;
- seeds S1/S2/S3 como base metodologica.

## 7. TCLE, FHIR e quarentena

O TCLE/e-consent permite vincular pacientes e amostras a termos de consentimento, com envio por e-mail quando configurado. A importacao FHIR usa FHIR R4 Bundle JSON como padrao principal, com staging antes da consolidacao. O Excel pode ser usado apenas como modelo auxiliar para conversao em JSON FHIR.

Amostras importadas ou cadastradas podem permanecer em quarentena etica/operacional ate assinatura do TCLE, validacao documental externa ou revisao por pessoa autorizada. Salvar ou consolidar uma amostra nao implica liberacao automatica para uso.

## 8. Rastreabilidade, Merkle e auditoria

BioAvanceD registra eventos auditaveis, cadeia de custodia, integridade por hash, estruturas Merkle/ledger quando aplicavel e logs de eventos relevantes. O objetivo e permitir verificacao da origem dos dados, reproducao de calculos e deteccao de alteracoes indevidas.

## 9. Seguranca e conformidade

O sistema considera LGPD, ISO 20387, autenticacao, RBAC, controle de acesso, criptografia, pseudonimizacao/anonimizacao quando aplicavel, trilhas de auditoria e exclusao de segredos do pacote oficial. O pacote de congelamento nao deve conter dados reais de pacientes, chaves, tokens, credenciais, dumps, logs sensiveis ou arquivos `.env` reais.

## 10. Escopo do congelamento

O novo congelamento pretendido e do software BioAvanceD v1.1.0, preservando o motor metodologico RCS-GOV 1.0. A tag futura sera `v1.1.0-inpi-rcs-gov`. O ZIP oficial e o hash SHA-512 serao gerados somente apos revisao e criacao da tag oficial.
