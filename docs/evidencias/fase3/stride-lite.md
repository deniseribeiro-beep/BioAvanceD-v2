# Modelagem de ameaças STRIDE lite — lab BioAvanceD (ex ante operacional)

| ID | Categoria | Ameaça | Impacto | Mitigação atual | Residual |
|---|---|---|---|---|---|
| S1 | Spoofing | Credencial admin lab / SSH key | Controle total do stack | Chave SSH; auth API JWT/MFA no produto | Rotação de chaves; MFA ops |
| S2 | Spoofing | Token de API em UI | Impersonação de operador | Sessão autenticada; MFA first-login no produto | Exposição :5173 na internet se firewall aberto |
| T1 | Tampering | Alteração de amostras/pacientes no Mongo | Integridade científica | Serviços + validação; lab com `rs0` + path service exercitado | Backups; object-store |
| T2 | Tampering | Progress/seed files no container | Relatório falso de N | `sourceRecordId` + contagem Mongo independente | Assinar memos |
| R1 | Repudiation | Negar criação de lote BLPP | Contabilidade de evidência | Markers + logs + runId | Audit chain witness (TSA) não ligada ao BLPP |
| I1 | Information disclosure | PII em Neo4j | Violação LGPD | Desenho Identity segregada; BLPP não projeta nome | Confirmar zero PII com query Neo4j pontual |
| I2 | Information disclosure | FS local de arquivos científicos | Vazamento | Object store (#1321 MinIO) planejado | FS ainda default em alguns fluxos |
| I3 | Information disclosure | Ports 5173/3000 | Superfície externa | Firewall GCP; UI responde só se liberada | Manter deny-by-default |
| D1 | DoS | Seed N grande / outbox | Indisponibilidade lab | Chunk + resume; N=1000 leve | Limitar concorrência promotes |
| D2 | DoS | OOM Mongo/Node | Queda stack | Monitor docker stats; N=1000 OK | Alertas |
| E1 | Elevation | Executar seed no backend container | Privilegios de app | Acesso SSH restrito | Separar job de seed com RBAC |
| E2 | Elevation | Import LGPD sem escopo org | Cross-tenant | organizationScope no produto (#1353) | Garantir seed não relaxa checks em service-path |

## Conclusão

Arquitetura **não é ingênua** a ameaças de privacidade e integridade; o maior residual de lab é **operacional** (SSH, ports) e **object-store** ainda parcial. Mongo standalone foi mitigado (`rs0`); validação sintética N=1000/10000 (lab-direct e service) já realizada.
