# Validação com serviços reais

O ambiente de teste usa somente a pilha isolada definida em `docker-compose.test.yml`. Testes de integração e Playwright não devem interceptar HTTP, fabricar autenticação nem substituir bancos ou drivers.

## Preparação

Copie `.env.test.example` para `.env.test` e substitua todas as credenciais de exemplo. Os registros carregados pelo seed recebem `synthetic: true`, chaves determinísticas e a origem `BIOAVANCED_SYNTHETIC_TEST_V1`.

## Sequência de validação

```powershell
npm.cmd run audit:zero-mocks
npm.cmd run test:stack:config
npm.cmd run test:stack:build
npm.cmd run test:stack:up
npm.cmd run test:stack:reset
npm.cmd run test:stack:seed
npm.cmd run test:stack:backend
npm.cmd run test:stack:e2e
npm.cmd run test:stack:cleanup
npm.cmd run test:stack:down
```

Se uma etapa falhar, colete antes da desmontagem:

```powershell
docker compose --env-file .env.test -f docker-compose.test.yml ps
docker compose --env-file .env.test -f docker-compose.test.yml logs --no-color
```

Finalize sempre com `test:stack:down`, que remove containers, rede e volumes exclusivos do ambiente de teste.

Integrações externas permanecem desabilitadas explicitamente. SMTP e MQTT são representados por servidores locais reais; nenhuma resposta de sucesso é sintetizada pela aplicação ou pelo navegador.
