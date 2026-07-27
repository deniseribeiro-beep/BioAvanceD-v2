# 00_ESCOPO

BioAvanceD — Escopo do Dicionário de Dados Consolidado

Base canônica para a modelagem NoSQL do BioAvanceD. Versão 1.3.0 — revisão de 2026-07-22: Foundation Data Pipeline como preparação estrutural integral da Fase 1; Fases 2 e 3 destinadas à população controlada dos dados.


## 1. PROPÓSITO

**Diretriz:** Incluir somente dados que aumentem utilidade científica, rastreabilidade, interoperabilidade, qualidade, governança, proveniência, FAIR ou reutilização das amostras.

**Escopo atual:** Gestão de biobanco, compatibilidade projetada com MIABIS Core 3.0 e MIABIS individual, eConsent, participantes pseudonimizados, identidade protegida, amostras, alíquotas, linhagem, cadeia de custódia, SPREC/RCS, dados clínicos associados, doenças raras, fenótipos, exames, telemetria, identidade digital, RBAC, MFA, sessões, políticas de segurança, auditoria, controle de pipelines e projeção Neo4j por outbox. Não existem perfis 'MIABIS mínimo' ou 'SPREC mínimo'. IA/XAI permanecem fora do escopo atual.


## 2. REGRAS DE MODELAGEM

**Identidade:** Cada entidade possui UUID interno imutável; códigos externos são codificações associadas e nunca substituem a identidade interna.

**Versionamento:** Toda terminologia, regra, esquema, mapeamento, método e dataset deve registrar versão, data de recuperação e proveniência.

**Histórico:** Valores originais, harmonizados, corrigidos, calculados, inferidos e invalidados permanecem distinguíveis; não há sobrescrita silenciosa.

**Consentimento:** O uso do dado depende do estado atual do consentimento, da finalidade autorizada e das restrições computáveis.

**Qualidade:** SPREC descreve variáveis pré-analíticas; RCS realiza qualificação operacional local; QC específico avalia adequação ao ensaio.

**Persistência:** MongoDB: documentos operacionais canônicos e outbox; Neo4j: projeções derivadas exclusivamente pelo outbox; FHIR R4: serialização/interoperabilidade sem persistência operacional própria; InfluxDB: telemetria; Object Storage: evidências e arquivos científicos; Redis: cache/fila transitórios.


## 3. DECISÕES DE ADOÇÃO

**NÚCLEO:** Fonte ou elemento necessário no primeiro modelo canônico.

**COMPLEMENTAR:** Aumenta interoperabilidade ou valor científico, sem ser necessário para toda implantação.

**CONDICIONAL:** Adotar somente quando o tipo de coleção, estudo, licença ou infraestrutura justificar.

**FUTURO:** Previsto no roadmap, mas não deve ampliar o escopo da implementação atual.

**NÃO ADOTAR:** Fonte ou dado sem função canônica clara, redundante, comercial ou inadequado ao escopo.


## 4. OBSERVAÇÕES

**Referências:** A aba 05_REFERENCIAS contém apenas fontes selecionadas para fundamentar a dissertação, o artigo arquitetural e as decisões do dicionário.

**Licenças:** Links de acesso não significam autorização irrestrita de redistribuição. Confirmar licença e termos no momento de cada ingestão.

**Revisão humana:** Nenhuma equivalência, penalidade, classificação clínica ou promoção ao catálogo canônico deve ocorrer sem validação humana e governança.

**Identificadores de extensão:** ELM identifica o baseline original do dicionário; P1X identifica extensões da Fase 1 consolidadas no modelo unificado. Ambos são rastreáveis e não devem ser renumerados silenciosamente.


## 5. DECISÕES CANÔNICAS DA REVISÃO 1.3.0

**Participante:** Participant/participantId é o nome operacional canônico; corresponde funcionalmente a MIABIS Sample Donor. FHIR Patient é apenas projeção de interoperabilidade.

**Identidade protegida:** ParticipantIdentity separa nome, data exata, contato e identificadores diretos do registro científico pseudonimizado e não é projetado ao Neo4j.

**Consentimento:** ConsentTemplate e Consent são entidades distintas; o fluxo canônico exige consentId. Atualizações legadas por token/chave são lacunas de implementação.

**Projeção em grafo:** Toda escrita no Neo4j deriva de GraphProjectionOutboxEvent persistido no MongoDB.


## 6. FOUNDATION DATA PIPELINE E FASES DE POPULAÇÃO

**Fase 1 — Foundation Data Pipeline:** Prepara schemas, validators, coleções, índices, configurações, políticas e infraestrutura de ingestão para todos os 929 elementos canônicos, incluindo as seis entidades técnicas de controle e terminologia.

**Fase 2 — Dados de referência:** Popula releases versionadas de MONDO, HPO, ORPHA, CID, OMIM, HGNC, LOINC, UCUM, ATC, DCB, DUO, Uberon, NCBI Taxonomy, EDAM e demais fontes aprovadas.

**Fase 3 — Dados operacionais e científicos:** Popula participantes, identidades protegidas, consentimentos, amostras, eventos, telemetria, dados clínicos, ensaios, arquivos, datasets, workflows e dados ômicos.

**Proibição de perfis reduzidos:** MIABIS e SPREC devem ser tratados conforme o levantamento integral do dicionário. Implementações legadas reduzidas são gaps de migração e não definem o modelo-alvo.
