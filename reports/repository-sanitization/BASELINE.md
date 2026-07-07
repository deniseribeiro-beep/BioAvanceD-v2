# Baseline

Estado inicial:

- branch atual: `audit/intake-governance-i18n-orpha`
- worktree: limpo
- inventário consultado: `docs/inventory/BIOAVANCED_INVENTORY.md`

Comandos executados:

- `git branch --show-current`
- `git status --short`
- `Get-Content -Raw docs/inventory/BIOAVANCED_INVENTORY.md`
- `Get-Content -Raw package.json`
- `Get-Content -Raw api/backend/package.json`
- `Get-Content -Raw frontend/package.json`
- `Get-Content -Raw .env.docker.example`
- `Get-Content -Raw .env.test.example`
- `git ls-files -- 'letsencrypt/accounts/**' 'data-dump.json' 'frontend/test-results/**' 'test-results/**' 'coverage/**' '.last-run.json' 'reports/**'`
- `rg -n --hidden --glob '!node_modules/**' --glob '!academico/**' --glob '!orpha-data-raw/**' --glob '!frontend/public/import-templates/**' --glob '!docs/import/**' --glob '!*.lock' "password|passwd|secret|token|apiKey|privateKey|clientSecret|authorization|BEGIN PRIVATE KEY|BEGIN RSA PRIVATE KEY|BEGIN CERTIFICATE|private_key"`

Resultados:

- o inventário confirma a arquitetura principal: frontend React/Vite, backend Node/Express, MongoDB, Neo4j, InfluxDB e Redis;
- os scripts de raiz e de backend existem e cobrem build, testes, Compose, workers e auditoria;
- o `.env.docker.example` usa placeholders vazios ou valores claramente de desenvolvimento para segredos;
- o `.env.test.example` usa tokens e senhas sintéticas de teste;
- a busca textual não retornou segredos explícitos nos caminhos auditados nesta passada;
- `git ls-files` confirmou artefatos rastreados de saída/execução:
  - `data-dump.json`
  - `test-results/.last-run.json`
  - `frontend/test-results/.last-run.json`
  - `letsencrypt/accounts/acme-v02.api.letsencrypt.org/directory/3b961ec9dc1e03f89a0a3c942daff61d/private_key.json`

Falhas preexistentes:

- ainda não executei lint, typecheck, build ou testes;
- ainda não validei os consumidores dos artefatos rastreados;
- ainda não comparei o inventário com o grafo atual de imports/rotas/execução.

Módulos não executados e motivo:

- backend e frontend não foram iniciados porque esta foi apenas a passagem de baseline;
- Compose e suites de teste ficaram para a próxima etapa, após leitura de mais entradas e candidatos.

Limitações do ambiente:

- sem acesso a rede;
- sem leitura do inventário fora do repositório;
- sem execução de ações destrutivas nesta primeira passagem.
