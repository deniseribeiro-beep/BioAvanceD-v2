# Arquitetura Tecnica - BioAvanceD v1.1.0

## Visao geral

BioAvanceD v1.1.0 e organizado em frontend React/TypeScript, backend Node.js/Express e infraestrutura Docker Compose com persistencia documental, grafo, cache/fila e series temporais. O motor metodologico preservado e RCS-GOV 1.0.

## Componentes

| Camada | Tecnologia/servico | Finalidade |
|---|---|---|
| Frontend | React, TypeScript, Vite | Interface operacional, Intake Wizard, pacientes, amostras, TCLE, FHIR, relatorios e administracao |
| Backend | Node.js, Express | APIs REST, regras de dominio, autenticacao, RBAC, RCS-GOV, auditoria e integracoes |
| Banco documental | MongoDB | Pacientes, amostras, consentimentos, staging, logs e configuracoes |
| Grafo | Neo4j | Rastreabilidade, linhagem, relacoes e sincronizacao Mongo -> Neo4j |
| Cache/fila | Redis | Filas, cache e tarefas auxiliares |
| Series temporais | InfluxDB | Telemetria, sensores e temperatura quando habilitados |
| Orquestracao | Docker Compose | Execucao local/VM dos servicos |
| E-mail | Resend | Envio de TCLE/e-consent |

## Modulos principais

- autenticacao e RBAC;
- pacientes e amostras;
- Intake Wizard;
- importacao FHIR em lote;
- staging e validacao antes do commit;
- TCLE/e-consent e Consent Builder;
- quarentena etica/operacional;
- RCS-GOV 1.0;
- Merkle/ledger e auditoria;
- armazenamento, sensores, IoT, telemetria e temperatura;
- incidentes, relatorios e backup;
- terminologias, Orphadata e HPO.

## VM e deploy

A implantacao de referencia usa Docker Compose em VM, com frontend e backend expostos apenas conforme politica de rede. Os bancos e servicos auxiliares devem permanecer protegidos por rede privada ou firewall. O CORS deve aceitar apenas origens configuradas, mantendo `CORS_ALLOW_ALL=false` como recomendacao.

## Integracoes e seguranca

Resend e a unica integracao externa permitida para e-mail. MQTT e opcional e deve permanecer desabilitado quando nao houver broker. Segredos, `.env` real, `.env.docker` real, tokens, chaves e dumps nao fazem parte do pacote de envio.
