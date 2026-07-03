# Arquitetura e persistência

O BioAvanceD utiliza arquitetura modular, poliglota e orientada a eventos.

## Responsabilidades dos mecanismos de dados

- **MongoDB:** documentos clínicos, operacionais, consentimentos, configurações e metadados flexíveis.
- **Neo4j:** relações de linhagem, consentimento, doença, fenótipo, biomarcadores, custódia, qualidade, incidentes e projetos.
- **InfluxDB:** séries temporais de telemetria e monitoramento ambiental.
- **Redis:** cache, filas, coordenação temporária e processamento assíncrono, conforme a configuração do sistema.

## Princípios

- cada armazenamento deve ser usado segundo sua responsabilidade;
- IDs estáveis devem permitir correlação entre os domínios;
- dados identificáveis não devem ser projetados desnecessariamente no grafo;
- operações entre bancos devem usar eventos, outbox, projetores idempotentes e mecanismos de recuperação;
- falhas parciais não podem produzir sucesso fictício;
- as versões de regras, esquemas e terminologias devem ser rastreáveis.

## Arquitetura orientada a eventos

Eventos relevantes incluem criação e movimentação de amostras, revogação de consentimento, incidentes de cadeia fria, alterações de qualidade e auditoria.
