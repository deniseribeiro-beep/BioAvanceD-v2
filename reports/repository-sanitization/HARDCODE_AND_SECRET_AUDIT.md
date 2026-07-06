# Hardcode and Secret Audit

| ID | Arquivo:linha | Tipo | Valor mascarado | Severidade | Consumidores | Decisão | Evidência | Status |
|---|---|---|---|---|---|---|---|---|
| HS-001 | `.env.docker.example` | ENVIRONMENT_CONFIG | placeholders vazios para segredos | P2 | runtime local e Compose | MANTER | arquivo de exemplo usa campos vazios ou dev-only; não há credencial real exposta na leitura | concluído |
| HS-002 | `.env.test.example` | TEST_FIXTURE | senhas e tokens sintéticos | P3 | testes | MANTER | valores são explicitamente sintéticos e de teste | concluído |
| HS-003 | `letsencrypt/accounts/.../private_key.json` | SECRET | chave privada ACME mascarada | P0 | processo de certificado local / histórico de deploy | REMOVER | arquivo rastreado em caminho de conta ACME; tratado como material sensível e removido do tracking local | concluído |
| HS-004 | `data-dump.json` | GENERATED_ARTIFACT | dump rastreado mascarado | P1 | desconhecido | REMOVER | `git ls-files` confirmou rastreamento; removido do tracking local após confirmação operacional do usuário | concluído |
| HS-005 | `test-results/.last-run.json` | GENERATED_ARTIFACT | marcador de última execução | P3 | testes locais | REMOVER | artefato típico de saída de teste; rastreado e removido do tracking local | concluído |
| HS-006 | `frontend/test-results/.last-run.json` | GENERATED_ARTIFACT | marcador de última execução | P3 | testes frontend | REMOVER | artefato típico de saída de teste; rastreado e removido do tracking local | concluído |

Observações:

- nenhuma chave completa foi copiada para o relatório;
- a linha `letsencrypt` foi removida do tracking local, mas rotação e revisão humana ainda são recomendadas se a chave tiver sido real;
- o dump foi removido do tracking local; se houver necessidade operacional legítima, o próximo passo é descobrir o processo gerador e recriá-lo sob controle.
