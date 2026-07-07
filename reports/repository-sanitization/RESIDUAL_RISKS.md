# Residual Risks

- possível chave privada ACME rastreada em `letsencrypt/accounts/.../private_key.json`;
- a raiz do repositório ainda tem um script de build que não bate com a localização real do app frontend;
- ausência de execução de lint, build e testes nesta passagem;
- possível duplicação de caminhos ainda não auditada;
- legado e compatibilidade ainda não mapeados em profundidade.

Próximo passo:

- ampliar a auditoria para consumidores, rotas, jobs e testes antes de remover qualquer coisa.
