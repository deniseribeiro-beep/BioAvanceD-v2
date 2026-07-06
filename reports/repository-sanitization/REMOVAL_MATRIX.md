# Removal Matrix

| Item | Tipo | Evidência 1 | Evidência 2 | Evidência 3 | Consumidores | Risco | Decisão | Teste |
|---|---|---|---|---|---|---|---|---|
| `test-results/.last-run.json` | GENERATED_ARTIFACT | `git ls-files` mostra rastreado | artefato de execução de teste | padrão de saída reproduzível | testes locais | baixo | REMOVER | concluído |
| `frontend/test-results/.last-run.json` | GENERATED_ARTIFACT | `git ls-files` mostra rastreado | artefato de execução de teste | padrão de saída reproduzível | testes frontend | baixo | REMOVER | concluído |
| `data-dump.json` | GENERATED_ARTIFACT | `git ls-files` mostra rastreado | nome indica dump | removido após confirmação do usuário | desconhecido | médio | REMOVER | concluído |
| `letsencrypt/accounts/.../private_key.json` | SECRET | `git ls-files` mostra rastreado | localização típica de chave privada | material tratado como sensível e removido | certificado ACME/local | alto | REMOVER | concluído |

Itens não removidos nesta passagem:

- inventário técnico;
- artefatos acadêmicos e regulatórios protegidos;
- arquivos `.example` com placeholders sintéticos.
