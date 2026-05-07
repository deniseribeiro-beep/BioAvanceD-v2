# Memorial Descritivo - BioAvanceD-v2

## Identificacao do Programa

BioAvanceD e um sistema de software para gestao de biobanco, amostras biologicas, pacientes, consentimentos, rastreabilidade, controle de qualidade pre-analitica e apoio a auditoria tecnica.

O sistema e composto por backend JavaScript/Node.js, frontend React e ambiente Docker para execucao local ou em servidor Linux. O backend expoe APIs REST, aplica regras de dominio, persiste dados e coordena integridade. O frontend consome as APIs para operacao do fluxo de cadastro, consulta e acompanhamento.

## Finalidade

O programa tem por finalidade apoiar processos de biobanco com:

- cadastro e consulta de pacientes e amostras;
- registro de consentimentos;
- rastreabilidade de movimentacoes;
- classificacao metodologica RCS-GOV 1.0;
- integridade por trilhas auditaveis e Merkle;
- execucao reprodutivel em containers.

## Tecnologias

- JavaScript e Node.js no backend;
- React, TypeScript e Vite no frontend;
- MongoDB, Redis, Neo4j e InfluxDB em containers Docker;
- Docker Compose para orquestracao local;
- Resend como unica integracao externa permitida para envio de e-mails quando configurado.

## Metodologia RCS-GOV 1.0

A metodologia ativa de qualidade e a RCS-GOV 1.0, baseada na formula:

```text
RCS = 100 - Pbio
Pbio = soma das penalidades dos eixos da matriz
penalty_axis = weight x severity
```

O sistema aplica gate de governanca nao compensavel. Quando ocorre falha de governanca, a classificacao final e `E`, independentemente do score numerico.

As classificacoes finais sao `A`, `B`, `C`, `D` e `E`, calculadas por thresholds versionados e retornadas em `final_grade`.

## Dados Metodologicos

O sistema preserva seeds versionados para:

- catalogo SPREC de amostras fluidas derivado da tabela S1;
- catalogo SPREC de amostras solidas derivado da tabela S2;
- severidades intraeixo derivadas da tabela S3;
- pesos de eixos;
- thresholds A-E;
- regras de governanca;
- `calculation_trace` auditavel.

## Integridade e Auditoria

O BioAvanceD-v2 registra eventos e resultados com rastreabilidade, mantendo estrutura para trilhas de auditoria, hashes de integridade e mecanismos Merkle. O objetivo e permitir reproducao do calculo, verificacao de origem dos dados e deteccao de alteracoes indevidas.

## Sanitizacao

Este pacote documental nao inclui segredos reais, dados pessoais reais, tokens, chaves privadas, senhas, `.env` operacional ou URIs reais de banco. Arquivos de ambiente devem ser representados apenas por exemplos sem segredos.
