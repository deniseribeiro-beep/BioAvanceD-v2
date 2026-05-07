# Manifesto de Hash - Modelo para Registro

## Aviso

Este documento e um manifesto de preenchimento. Nenhum hash foi gerado nesta etapa.

## Finalidade

Registrar, em etapa posterior, os hashes dos artefatos submetidos ao Registro de Programa de Computador INPI.

## Campos Sugeridos

| Artefato | Algoritmo | Hash | Data de Geracao | Responsavel |
| --- | --- | --- | --- | --- |
| pacote-fonte | SHA-256 | A preencher | A preencher | A preencher |
| memorial-descritivo | SHA-256 | A preencher | A preencher | A preencher |
| especificacao-rcs-gov | SHA-256 | A preencher | A preencher | A preencher |
| inventario-arquivos | SHA-256 | A preencher | A preencher | A preencher |

## Regras de Preenchimento

- gerar hash somente sobre pacote sanitizado;
- nao incluir `.env`, tokens, senhas, chaves privadas ou dados pessoais reais;
- preservar seeds S1, S2, S3, pesos, thresholds A-E e governance rules;
- preservar documentacao RCS-GOV 1.0;
- registrar algoritmo e data de geracao.
