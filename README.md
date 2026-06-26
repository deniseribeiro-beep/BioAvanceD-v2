# BioAvanceD

BioAvanceD é um protótipo de sistema médico-informacional para gestão digital de biobancos, desenvolvido para validar uma arquitetura poliglota, orientada a eventos e governada em tempo de execução para biospecímenes, consentimento, rastreabilidade, qualidade pré-analítica, cadeia fria e interoperabilidade semântica.

O projeto combina frontend React/Vite, backend Node.js/Express e persistência com MongoDB, Neo4j, InfluxDB e Redis.

## Escopo atual do protótipo

O protótipo atual tem foco em validação técnica e sistêmica com dados fictícios/sintéticos. Ele não deve subir com dados reais nem com dados operacionais pré-carregados.

Módulos centrais:

1. Cadastro e governança de pacientes/doadores.
2. Consentimento dinâmico e TCLE.
3. Intake clínico e cadastro integrado de amostras.
4. Governança pré-analítica RCS-GOV/SPREC/MIABIS.
5. Rastreabilidade e cadeia de custódia append-only.
6. Armazenamento físico, etiquetas e localização.
7. Equipamentos, sensores, políticas de temperatura e cadeia fria.
8. Quarentena lógica por consentimento, qualidade e incidente de cadeia fria.
9. Terminologias clínicas e semânticas: ORPHA, OMIM, CID, HPO, ATC e FHIR.
10. RBAC, auditoria, segurança e bootstrap controlado.

Módulos de inteligência artificial assistiva ou preditiva devem ser tratados como escopo futuro, exceto quando houver implementação e validação específicas.

## Stack

- Frontend: React, TypeScript, Vite.
- Backend: Node.js, Express.
- Banco documental: MongoDB.
- Grafo de linhagem e consentimento: Neo4j.
- Telemetria e séries temporais: InfluxDB.
- Cache, filas e eventos: Redis.
- Testes: Vitest, Supertest, Playwright e scripts de auditoria.

## Documentos acadêmicos e científicos

Documentos científicos, submissões, materiais de pesquisa, CEP, figuras e pacotes de registro INPI ficam em `academico/`.

Estrutura:

- `academico/artigo-joms/`: manuscrito e arquivos suplementares do artigo.
- `academico/rcs-submetido/`: materiais de submissão relacionados ao RCS.
- `academico/inpi/`: pacote, hash e documentação de registro INPI.
- `academico/projeto-pesquisa/`: documentos de projeto de pesquisa.
- `academico/cep/`: documentos relacionados ao CEP.
- `academico/figuras/`: figuras e materiais visuais acadêmicos.

O diretório `docs/` deve permanecer reservado para documentação técnica de operação, importação, deploy e desenvolvimento.

## Princípio de bootstrap limpo

O sistema deve subir em banco limpo com apenas dados estruturais e dados de referência essenciais.

O bootstrap essencial não deve criar por padrão:

- pacientes;
- amostras;
- consentimentos assinados;
- resultados;
- observações clínicas reais;
- biomarcadores reais;
- incidentes;
- sensores, freezers ou localizações preenchidas;
- usuário administrador com credencial fixa;
- dumps ou dados demo.

Dados operacionais devem ser criados pelo fluxo da aplicação ou por seeds sintéticos explicitamente marcados como `demo`.

## Dados essenciais esperados

Após o seed essencial, o banco deve conter apenas:

- coleções canônicas e índices mínimos;
- roles e permissões mínimas;
- dados de referência RCS-GOV;
- SPREC mínimo;
- MIABIS mínimo;
- HPO mínimo necessário;
- regras de validação clínica essenciais;
- bootstrap ATC mínimo;
- log técnico de inicialização, quando aplicável.

## Instalação local limpa

Para ter uma cópia igual à versão usada no ambiente CENAPAD, prefira clonar em uma pasta nova:

```bash
git clone https://github.com/deniseribeiro-beep/BioAvanceD-v2.git
cd BioAvanceD-v2
git checkout audit/intake-governance-i18n-orpha
```

Instale dependências:

```bash
npm install
npm --prefix api/backend install
npm --prefix frontend install
```

Configure variáveis de ambiente a partir dos exemplos disponíveis. Não versionar `.env`, chaves, tokens, certificados ou dumps.

## Variáveis principais

Preencha no ambiente local, `.env` ou `.env.docker`, conforme o modo de execução:

```env
MONGO_URI=
MONGO_DB=
JWT_SECRET=
JWT_REFRESH_SECRET=
ENCRYPTION_KEY=
ENCRYPTION_KEY_ID=
USER_ANON_SALT=
NEO4J_URI=
NEO4J_USERNAME=
NEO4J_PASSWORD=
REDIS_URL=
INFLUXDB_URL=
INFLUXDB_TOKEN=
INFLUXDB_ORG=
INFLUXDB_BUCKET=
FRONTEND_URL=
API_URL=
ALLOWED_ORIGINS=
```

`ENCRYPTION_KEY` é obrigatória para os testes de conformidade LGPD AES-256-GCM. Sem essa variável, `encryptValue()` retorna `null`, os campos PII não são movidos para os campos criptografados e `npm run test:ci` falha no `Compliance Gate - LGPD AES-256-GCM`. Use uma chave forte e específica por ambiente; não versionar essa chave.

Para auditoria local sem integrações externas:

```env
ALLOW_CLOUD_INTEGRATIONS=false
ALLOW_EXTERNAL_TERMINOLOGY_SYNC=false
ALLOW_EXTERNAL_HPO_LOOKUP=false
ALLOW_EXTERNAL_DRUG_LOOKUP=false
MQTT_ENABLED=false
```

## Subir ambiente Docker local

```bash
cp .env.docker.example .env.docker
docker compose --env-file .env.docker -f docker-compose.yml up --build backend frontend
```

Ou usando scripts da raiz:

```bash
npm run dev:up
npm run dev:logs
npm run dev:ps
npm run dev:down
```

Serviços esperados:

- Frontend: http://localhost:5173
- Backend API: http://localhost:3000
- MongoDB: localhost:27017
- Redis: localhost:6379
- Neo4j Browser: http://localhost:7474
- InfluxDB: http://localhost:8086

## Inicialização limpa do banco

Após os serviços estarem saudáveis, execute o seed essencial seguro:

```bash
npm --prefix api/backend run seed:essential
```

Em Docker:

```bash
docker compose --env-file .env.docker -f docker-compose.yml exec backend npm run seed:essential
```

Esse seed deve ser idempotente e não deve executar `deleteMany` em coleções operacionais. Ele também não deve criar pacientes, amostras, consentimentos, resultados, sensores, freezers, incidentes ou usuário administrador.

## Seed ORPHA inicial

ORPHA, CID-10, CID-11, SNOMED-CT e OMIM entram como dados de referência semântica para terminologias clínicas. Eles não são dados operacionais reais e não criam pacientes, amostras, consentimentos, resultados ou eventos de biobanco.

A documentação completa da pipeline está em `docs/orphanet-artifact-pipeline.md`. No CENAPAD, use o artefato validado e importe com checkpoint resumível:

```bash
MAX_SECONDS=240 ./with-mongo-window.sh node api/backend/scripts/orphanet-import-initial-seed.js \
  --artifact /home/lovelace/proj/proj1091/deniser/bioavanced-validation/cache/orphanet-2025-07-initial-seed \
  --batch 500 \
  --maxSeconds 220 \
  --checkpoint
```

Valide a importação ORPHA depois que a carga terminar:

```bash
MAX_SECONDS=180 ./with-mongo-window.sh node api/backend/scripts/orphanet-validate-imported-seed.js \
  --release 2025-07 \
  --artifact /home/lovelace/proj/proj1091/deniser/bioavanced-validation/cache/orphanet-2025-07-initial-seed
```

## Criar primeiro administrador com bootstrap seguro

O sistema não cria administrador por padrão. O primeiro administrador deve ser criado explicitamente após o banco estar inicializado.

Regras:

- só cria o primeiro administrador se a coleção `users` estiver vazia;
- se já existir qualquer usuário, o script encerra sem alteração;
- a credencial temporária vem de variável de ambiente;
- a credencial temporária não é impressa no console;
- o usuário é criado com `accessType: 4` e `roleName: "Administrador"`;
- o usuário é criado com `forceReset: true` para troca obrigatória no primeiro acesso;
- as variáveis de ambiente devem ser removidas após a execução.

### Linux ou CENAPAD

```bash
export BOOTSTRAP_ADMIN_NAME="Nome do Administrador"
export BOOTSTRAP_ADMIN_EMAIL="<email-institucional>"
export BOOTSTRAP_ADMIN_USERNAME="<usuario-admin-inicial>"
export BOOTSTRAP_ADMIN_TEMP_PASSWORD="<credencial-temporaria-forte-unica>"
export BOOTSTRAP_ADMIN_FORCE_RESET="true"

npm --prefix api/backend run admin:create-first

unset BOOTSTRAP_ADMIN_NAME
unset BOOTSTRAP_ADMIN_EMAIL
unset BOOTSTRAP_ADMIN_USERNAME
unset BOOTSTRAP_ADMIN_TEMP_PASSWORD
unset BOOTSTRAP_ADMIN_FORCE_RESET
```

### Windows PowerShell

```powershell
$env:BOOTSTRAP_ADMIN_NAME="Nome do Administrador"
$env:BOOTSTRAP_ADMIN_EMAIL="<email-institucional>"
$env:BOOTSTRAP_ADMIN_USERNAME="<usuario-admin-inicial>"
$env:BOOTSTRAP_ADMIN_TEMP_PASSWORD="<credencial-temporaria-forte-unica>"
$env:BOOTSTRAP_ADMIN_FORCE_RESET="true"

npm.cmd --prefix api/backend run admin:create-first

Remove-Item Env:\BOOTSTRAP_ADMIN_NAME
Remove-Item Env:\BOOTSTRAP_ADMIN_EMAIL
Remove-Item Env:\BOOTSTRAP_ADMIN_USERNAME
Remove-Item Env:\BOOTSTRAP_ADMIN_TEMP_PASSWORD
Remove-Item Env:\BOOTSTRAP_ADMIN_FORCE_RESET
```

Fluxos antigos de criação de administrador com credencial fixa não devem ser usados.

## Ordem recomendada para ambiente limpo

```bash
npm --prefix api/backend run seed:essential
npm --prefix api/backend run admin:create-first
npm --prefix api/backend run test:ci
npm run audit:full
```

## Deploy e validação no CENAPAD

No CENAPAD, use a branch limpa `audit/intake-governance-i18n-orpha` e atualize o repositório antes de subir os serviços. Ajuste o primeiro `cd` para a pasta real do clone.

```bash
cd /home/lovelace/proj/proj1091/deniser/bioavanced-validation/source/BioAvanceD-v2
git fetch origin
git checkout audit/intake-governance-i18n-orpha
git pull --ff-only origin audit/intake-governance-i18n-orpha
git rev-parse --short HEAD
git status --short --branch
```

Configure as variáveis de segurança do ambiente antes de executar seed, backend, testes ou auditoria. Elas podem estar no `api/backend/.env` ou exportadas no processo. Não versionar esses valores.

```bash
export ENCRYPTION_KEY="$(openssl rand -base64 48)"
export ENCRYPTION_KEY_ID="cenapad-validation"
export USER_ANON_SALT="$(openssl rand -base64 32)"
```

A ausência de `ENCRYPTION_KEY` faz o teste de compliance LGPD AES-256-GCM falhar com erros semelhantes a `expected 1.8 to be null` ou `expected null to be truthy`, pois os campos PII não são criptografados.

Para conferir rapidamente se a chave está visível para o processo Node, use aspas simples no Bash. Não use aspas duplas com `!process.env`, pois o Bash pode interpretar `!` como expansão de histórico.

```bash
node -e 'if (!process.env.ENCRYPTION_KEY) { throw new Error("ENCRYPTION_KEY ausente"); } console.log("ENCRYPTION_KEY configurada");'
```

### Node.js no CENAPAD

O Node do sistema em alguns nós do CENAPAD pode ser antigo, por exemplo `/usr/bin/node` com npm 6.x. Nesse caso, comandos como `vitest run` podem falhar com erro de módulo ESM, como `SyntaxError: Unexpected string` em `vitest.mjs`. Para validação técnica, use Node 22 via Podman.

```bash
node -v
npm -v
which node
```

Se o Node do host for antigo e não houver módulo `node/20+` disponível, rode a validação em container Node 22.

### Podman rootless no CENAPAD

No CENAPAD, não use `--userns=keep-id`, pois o usuário pode não ter faixas `/etc/subuid` e `/etc/subgid`. Esse modo pode falhar com `User namespaces enabled, but no user mapping found`.

As mensagens abaixo são esperadas no ambiente rootless/NFS e não indicam falha por si só:

```text
Network file system detected as backing store. Enforcing overlay option force_mask="700".
Additional gid=... is not present in the user namespace, skip setting it.
```

Se aparecerem erros de lock de volumes antigos, execute antes:

```bash
podman ps -a
podman system renumber
```

### Validação com Node 22 via Podman

Use este bloco a partir da raiz do repositório. Ele evita o Node antigo do host, não usa `--userns=keep-id` e não usa `:Z` no volume.

```bash
cd /home/lovelace/proj/proj1091/deniser/bioavanced-validation/source/BioAvanceD-v2

export ENCRYPTION_KEY="$(openssl rand -base64 48)"
export ENCRYPTION_KEY_ID="cenapad-validation"
export USER_ANON_SALT="$(openssl rand -base64 32)"

podman run --rm -it \
  -v "$PWD":/app \
  -w /app \
  -e ENCRYPTION_KEY \
  -e ENCRYPTION_KEY_ID \
  -e USER_ANON_SALT \
  docker.io/library/node:22-alpine \
  sh -lc '
    node -v &&
    npm -v &&
    npm --prefix api/backend install --no-audit --no-fund --package-lock=false &&
    npm --prefix frontend install --no-audit --no-fund --package-lock=false &&
    npm --prefix api/backend run test:ci &&
    npm --prefix frontend run typecheck &&
    npm run audit:full
  '
```

Não use `npm ci` no CENAPAD se o lockfile estiver fora de sincronia com `package.json`, pois o npm pode interromper com erro como `Missing: @emnapi/runtime... from lock file`. Para validação do protótipo no CENAPAD, use `npm install --package-lock=false` dentro do container Node 22. A correção definitiva do lockfile deve ser feita em ambiente de desenvolvimento e commitada separadamente.

Após subir MongoDB, Redis, InfluxDB, Neo4j, backend e frontend, a sequência funcional esperada é:

```bash
npm --prefix api/backend run seed:essential
npm --prefix api/backend run admin:create-first
npm --prefix api/backend run test:ci
npm --prefix frontend run typecheck
npm run audit:full
```

Se o primeiro administrador já existir, `admin:create-first` deve encerrar sem alteração. Para criar o primeiro admin em banco limpo, exporte temporariamente as variáveis abaixo antes do comando e remova-as em seguida:

```bash
export BOOTSTRAP_ADMIN_NAME="Nome do Administrador"
export BOOTSTRAP_ADMIN_EMAIL="<email-institucional>"
export BOOTSTRAP_ADMIN_USERNAME="<usuario-admin-inicial>"
export BOOTSTRAP_ADMIN_TEMP_PASSWORD="<credencial-temporaria-forte-unica>"
export BOOTSTRAP_ADMIN_FORCE_RESET="true"

npm --prefix api/backend run admin:create-first

unset BOOTSTRAP_ADMIN_NAME BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_USERNAME BOOTSTRAP_ADMIN_TEMP_PASSWORD BOOTSTRAP_ADMIN_FORCE_RESET
```

Ao final, salve evidências mínimas da execução:

```bash
mkdir -p ~/bioavanced-validation/evidence/$(date +%Y%m%d-%H%M%S)
EVIDENCE_DIR=$(ls -td ~/bioavanced-validation/evidence/* | head -1)

git rev-parse HEAD > "$EVIDENCE_DIR/git-commit.txt"
git status --short --branch > "$EVIDENCE_DIR/git-status.txt"
podman ps > "$EVIDENCE_DIR/podman-ps.txt" 2>/dev/null || true
cp reports/system-audit/audit-complete-*.txt "$EVIDENCE_DIR/" 2>/dev/null || true
cp reports/system-audit/audit-complete-*.json "$EVIDENCE_DIR/" 2>/dev/null || true

echo "$EVIDENCE_DIR"
```

Resultado esperado para considerar a validação aprovada:

```text
Backend test:ci: PASS
Frontend typecheck: PASS
Audit full: PASS
Seed essencial: executado sem dados operacionais
Admin bootstrap: criado apenas se users estava vazia, ou skipped se já havia usuário
```

## Testes

Backend:

```bash
npm --prefix api/backend run test:unit
npm --prefix api/backend run test:consent
npm --prefix api/backend run test:ci
```

Frontend:

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Auditoria completa:

```bash
npm run audit:full
```

## Incidentes de cadeia fria

Incidentes ativos de cadeia fria devem bloquear operacionalmente as amostras afetadas.

Fluxo esperado:

```text
telemetria fora da política
→ incidente COLD_CHAIN aberto ou atualizado
→ resolução do sensor/freezer/localização afetada
→ amostras vinculadas entram em QUARANTINE/BLOCKED
→ resolução do incidente não libera automaticamente as amostras
→ amostras permanecem como PENDING_REVIEW até avaliação pós-incidente
```

## Política de versionamento

Não versionar:

- `.env`, `.env.local`, `.env.docker` com segredos reais;
- chaves, certificados, tokens e dumps;
- `node_modules`;
- artefatos de build/cache;
- logs e relatórios temporários;
- volumes locais de bancos (`data/mongodb`, `data/neo4j`, `data/redis`, `data/influxdb`);
- CSV/XML grandes de terminologias externas;
- pacientes, amostras, consentimentos ou resultados reais;
- evidências locais de execução geradas fora do fluxo de documentação aprovado.

Versionar:

- código-fonte;
- testes automatizados;
- scripts auditáveis;
- configurações sem segredo;
- documentação técnica essencial;
- exemplos de ambiente;
- dados mínimos de referência explicitamente sanitizados, como `rcs-*.json` e seeds `.min.json`.

## Limpeza local para clone limpo

Para ter no computador uma cópia igual ao repositório remoto limpo, prefira clonar em uma nova pasta.

Se precisar limpar uma cópia existente, confira antes o que será removido:

```bash
git clean -fdxn
```

Depois de revisar a lista, remova arquivos não rastreados:

```bash
git clean -fdx
```

Para descartar alterações locais e voltar exatamente ao estado remoto da branch:

```bash
git fetch origin
git reset --hard origin/audit/intake-governance-i18n-orpha
git clean -fdx
```

Use esses comandos somente depois de salvar qualquer arquivo local que ainda precise manter.

## Integrações externas

Por padrão, o ambiente de auditoria deve permanecer local e sem cloud externa.

Desabilitado por padrão:

- storage externo;
- sincronização externa de terminologias;
- lookup externo HPO;
- lookup externo de drogas;
- MQTT externo.

Integrações externas devem ser habilitadas apenas por flags explícitas e com variáveis de ambiente fora do repositório.

## Alinhamento científico

O protótipo atual está alinhado ao escopo de validação técnica de arquitetura para biobancos digitais, com ênfase em:

- persistência poliglota;
- interoperabilidade FHIR/MIABIS/SPREC;
- governança de consentimento em tempo de execução;
- RCS-GOV para qualificação pré-analítica;
- cadeia de custódia verificável;
- monitoramento de cadeia fria e quarentena pós-incidente;
- uso exclusivo de dados fictícios/sintéticos nas fases de desenvolvimento e validação técnica.

Esse escopo é compatível com validação de protótipo e com o parecer ético quando restrito a dados sintéticos/fictícios. Qualquer uso futuro de dados reais deve seguir nova apreciação ética quando exigido pelo CEP.

## Licença

Projeto desenvolvido para fins acadêmicos, científicos e de demonstração técnica.
