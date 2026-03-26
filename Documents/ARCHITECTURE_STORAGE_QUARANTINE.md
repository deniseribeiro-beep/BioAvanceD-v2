# Conceito: Quarentena Lógica vs. Identificação Física

## Resumo do Fluxo Correto

1. **Recepção e Etiquetagem Imediata**
   - Ao importar o arquivo, o sistema gera o ID pseudonimizado da amostra, aloca a posição física e imprime a etiqueta DataMatrix 2D imediatamente.
   - A etiqueta contém apenas o ID da amostra (ex: BIO-2026-XYZ), sem dados do paciente.
   - O técnico cola a etiqueta no tubo no momento da entrada.

2. **Armazenamento de Quarentena**
   - O sistema instrui: "Guarde o tubo BIO-2026-XYZ no Freezer de Quarentena, Caixa Q-1, Posição A1".
   - O tubo é armazenado fisicamente, mas o status no banco (MongoDB/Neo4j) é `QUARANTINED`.

3. **Trava Sistêmica (Quarentena Lógica)**
   - Mesmo etiquetada e armazenada, a amostra só pode ser usada após aceite do TCLE.
   - Se um pesquisador tentar acessar a amostra (via leitura do DataMatrix), o sistema bloqueia e exibe: "Acesso Negado: Amostra aguardando aceite do TCLE".

4. **Liberação**
   - Quando o paciente aceita o TCLE, o status da amostra muda para `AVAILABLE`.

5. **Fila de Transferência (Opcional)**
   - O sistema exibe um painel para o técnico transferir amostras liberadas do Freezer de Quarentena para o Freezer Principal.

## Regras para o Agente
- A etiqueta deve ser impressa imediatamente na entrada, independentemente do status do TCLE.
- O status lógico de quarentena é garantido no banco e nas APIs de acesso.
- O bloqueio de uso é feito via status, não via retenção de etiqueta.
- O painel de transferência pode ser implementado para facilitar a movimentação física após liberação.
