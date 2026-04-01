# Arquitetura de Software – BioAvanceD

## 1. Visão Geral

BioAvanceD é uma plataforma completa para gestão de amostras biológicas, pacientes, resultados laboratoriais, equipamentos, sensores, políticas e logs, com foco em rastreabilidade, automação, conformidade (LGPD, ISO 20387) e integração biomédica. O sistema cobre todo o ciclo de vida das amostras, desde o cadastro até a destruição, com trilha de auditoria imutável e automações clínicas.

---

## 2. Arquitetura do Backend

### 2.1. Tecnologias
- **Node.js** (Express)
- **MongoDB** (persistência principal)
- **Neo4j** (relações clínicas e consentimento)
- **Redis** (filas, cache, IoT)
- **Socket.IO** (notificações e telemetria)
- **AJV/Zod** (validação de schemas)
- **JWT + MFA** (autenticação e segurança)
- **BullMQ** (automações e jobs assíncronos)
- **PDFKit, CSV, ExcelJS** (relatórios)

### 2.2. Módulos e Serviços
- **Autenticação e RBAC**: JWT, múltiplo fator, controle de sessão, roles e permissões.
- **Gestão de Usuários**: CRUD, reset de senha, MFA, logs de acesso.
- **Pacientes**: Cadastro, edição, importação em massa, integração com dicionários biomédicos (HPO, Orphanet, OMIM).
- **Amostras**: Cadastro, movimentação, destruição, controle de localização física (freezer, caixa, rack), geração de etiquetas (barcode/datamatrix), controle de volume e alíquotas.
- **Consentimento LGPD**: Controle granular, histórico de versões, integração com Neo4j, aceite/revogação, logs de consentimento.
- **Resultados**: Importação (CSV, FHIR), vinculação a pacientes/amostras, exportação, validação automática.
- **Equipamentos e Sensores**: Cadastro, monitoramento de temperatura, alertas automáticos, logs de anomalias.
- **Políticas**: Definição de limites, regras de qualidade, automação de bloqueios.
- **Logs/Auditoria**: Registro imutável de todas as operações CRUD, trilha de auditoria detalhada (quem, quando, o quê, antes/depois).
- **Backup/Restore**: Rotinas automáticas, retenção, restauração, teste de integridade.
- **Relatórios/Dashboards**: Geração dinâmica, filtros avançados, exportação PDF/CSV.
- **Importação/Exportação**: FHIR, CSV, ZIP, jobs assíncronos, validação e logs de erro.
- **Monitoramento IoT**: Coleta de telemetria, alertas em tempo real, integração com sensores físicos.
- **Automação de Qualidade (MIABIS)**: Cálculo automático de status de qualidade de amostras.

### 2.3. Integrações Externas
- **Ontologias Biomédicas**: HPO, Orphanet, OMIM (busca, validação, autocomplete).
- **Sistemas de Notificação**: E-mail, SMS (para alertas e MFA).
- **APIs FHIR**: Importação/exportação de bundles clínicos.

### 2.4. Validações e Rastreabilidade
- **Schemas AJV/Zod**: Validação de payloads em todos os endpoints.
- **Auditoria Global**: Middleware registra toda alteração, incluindo payloads antes/depois, usuário, IP, timestamp.
- **Consentimento**: Toda ação de aceite/revogação é registrada com hash e versão.
- **Logs de Importação**: Erros, warnings e status de cada linha/processo.

### 2.5. Exemplos de Endpoints
- `POST /api/patients` – Cadastro de paciente
- `GET /api/samples/:id` – Consulta de amostra
- `POST /api/samples/:id/move` – Movimentação física
- `POST /api/consent/:patientId/accept` – Aceite de consentimento
- `GET /api/hpo/search?q=termo` – Busca HPO
- `POST /api/import-fhir` – Importação FHIR
- `GET /api/logs?entity=sample` – Consulta de logs
- `POST /api/backup` – Geração de backup

### 2.6. Fluxos e Automações
- **Importação FHIR/CSV**: Validação, persistência, logs de erro, atualização de status.
- **Movimentação de Amostras**: Atualiza localização, gera log, dispara alerta se volume crítico.
- **Monitoramento IoT**: Recebe telemetria, gera alerta se temperatura fora do range, registra evento.
- **Backup Automático**: Executa rotina diária, envia notificação em caso de falha.

---

## 3. Arquitetura do Frontend

### 3.1. Tecnologias
- **React 18** (SPA)
- **TypeScript**
- **Vite** (build)
- **React Router** (navegação)
- **Context API** (estado global)
- **Zod** (validação de formulários)
- **Axios** (API)
- **Playwright/Vitest** (testes E2E/unitários)

### 3.2. Módulos e Telas
- **Login/MFA**: Autenticação, setup MFA, recuperação de senha.
- **Dashboard**: KPIs, alertas, status de sensores, visão geral.
- **Pacientes**: CRUD, importação, busca, integração com dicionários biomédicos.
- **Amostras**: Wizard clínico, movimentação, etiquetas, controle de localização, destruição.
- **Resultados**: Importação, visualização, exportação, vinculação a pacientes/amostras.
- **Equipamentos/Sensores**: Cadastro, monitoramento, alertas.
- **Políticas**: Definição e edição de limites, bloqueios automáticos.
- **Logs/Auditoria**: Consulta detalhada, filtros avançados, visualização de payloads.
- **Consentimento LGPD**: Visualização, aceite/revogação, histórico.
- **Backup/Restore**: Execução, listagem, restauração.
- **Relatórios**: Filtros dinâmicos, exportação, visualização detalhada.
- **Gestão de Usuários**: CRUD, permissões, reset de senha.

### 3.3. Fluxos de Dados
1. **Usuário interage com UI** (ex: cadastro de amostra)
2. **Validação local** (Zod)
3. **Envio para API** (Axios)
4. **Validação backend + persistência**
5. **Resposta e feedback visual**
6. **Atualização de estado/contexto**

### 3.4. Validações e Usabilidade
- **Validação em tempo real**: Feedback imediato, bloqueio de envio inválido.
- **UX Preventivo**: Confirmação de ações críticas, bloqueio de duplo clique.
- **Acessibilidade**: Navegação por teclado, contraste, labels.
- **Design Responsivo**: Desktop/mobile.

### 3.5. Automação e Testes
- **Testes E2E**: Playwright cobre fluxos críticos (cadastro, movimentação, importação, consentimento).
- **Testes Unitários**: Vitest cobre hooks, componentes e lógica de negócio.
- **Feedback Visual**: Loaders, skeletons, toasts.

---

## 4. Exemplos de Fluxos e Automações

### 4.1. Cadastro e Movimentação de Amostras
- Usuário cadastra amostra → Validação local → Envio para API → Persistência → Geração de etiqueta → Log de criação.
- Movimentação física: Usuário move amostra → API atualiza localização → Log de movimentação → Alerta se volume crítico.

### 4.2. Importação de Dados Clínicos
- Usuário importa CSV/FHIR → Backend valida cada linha → Persiste dados válidos → Gera logs de erro/warning → Atualiza status de importação.

### 4.3. Consentimento LGPD
- Paciente acessa tela de consentimento → Visualiza política vigente → Aceita/revoga → API registra ação com hash, versão e log.

### 4.4. Monitoramento IoT
- Sensores enviam telemetria → Backend processa e armazena → Frontend exibe gráficos em tempo real → Alerta visual/sonoro se anomalia.

### 4.5. Backup e Restore
- Usuário executa backup → Backend gera arquivo, registra log, retorna status → Restore executa validações e restaura dados.

---

## 5. Rastreabilidade e Compliance
- **Trilha de Auditoria**: Todas as operações CRUD, movimentações, consentimentos e importações são logadas com detalhes (quem, quando, o quê, antes/depois).
- **Compliance**: Atende LGPD, ISO 20387, MIABIS, com controles de consentimento, logs imutáveis e automação de políticas.
