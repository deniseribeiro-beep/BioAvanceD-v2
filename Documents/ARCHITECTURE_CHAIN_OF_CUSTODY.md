# Localização de Amostras e Gestão do Ciclo de Vida (Chain of Custody)

## Erro Comum em ERPs Genéricos
- Tratar freezers, caixas e racks como "instalações" (Facilities) separadas da amostra é um erro clássico.
- Em LIMS/Biobanco, o freezer não é apenas um imóvel: ele é a extensão do tubo.
- A localização faz parte do próprio objeto amostra. O técnico precisa:
  - Visualizar a localização ao olhar a amostra.
  - Movê-la fisicamente e registrar a movimentação.
  - Retirar volume (alíquota) ou devolver, tudo rastreado.

## Gestão do Ciclo de Vida (Chain of Custody)
- Cada movimentação, retirada, devolução ou alteração de status da amostra deve ser registrada.
- O ciclo de vida completo da amostra é o coração da rastreabilidade (ISO 20387).
- O sistema deve permitir:
  - Visualizar histórico completo de localizações e manipulações.
  - Auditar quem, quando e onde cada ação foi feita.
  - Integrar localização física e status lógico (quarentena, disponível, etc).

## Recomendação de Arquitetura
- Modelar a localização como parte do documento/objeto da amostra (MongoDB/Neo4j).
- Implementar ledger de movimentações (SampleMovementLedger) para rastreabilidade.
- Garantir que toda ação relevante (movimentação, retirada, devolução, destruição) seja registrada e auditável.

