# Declaracao de Sanitizacao

## Declaracao

O pacote documental e tecnico preparado para o Registro de Programa de Computador INPI do BioAvanceD deve ser sanitizado antes de submissao.

## Itens Removidos ou Excluidos

Devem ser excluidos do pacote:

- arquivos `.env` reais;
- tokens;
- API keys;
- senhas;
- JWT secrets reais;
- chaves privadas;
- URIs reais de banco;
- IPs sensiveis;
- dumps de banco;
- dados reais de pacientes;
- dados reais de amostras;
- dados reais de usuarios;
- logs operacionais com dados sensiveis.

## Itens Preservados

Devem ser preservados:

- codigo-fonte do BioAvanceD-v2;
- documentacao tecnica;
- RCS-GOV 1.0;
- seeds S1, S2 e S3;
- pesos dos eixos;
- thresholds A-E;
- governance rules;
- `calculation_trace`;
- mecanismos de Merkle e integridade;
- configuracoes Docker sem segredos reais.

## Integracoes

Integracoes cloud externas devem permanecer removidas, desabilitadas ou controladas por flags locais. Resend e a unica integracao externa permitida no escopo documentado, usada para e-mail quando configurada.

## Qualidade Metodologica

A metodologia ativa de qualidade e RCS-GOV 1.0. A classificacao final usa `final_grade` A-E, gate de governanca nao compensavel e calculo auditavel por eixo.

## Confirmacao

Este documento nao contem segredos reais, dados pessoais reais ou credenciais operacionais.
