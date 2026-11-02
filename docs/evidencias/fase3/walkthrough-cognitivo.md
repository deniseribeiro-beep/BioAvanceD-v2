# Walkthrough cognitivo — UI lab BioAvanceD (F3.5 / item 2.2)

**Método:** especialista simula usuário (operador de biobanco) em 7 passos no fluxo planejado/implementado.  
**Ambiente:** VM lab (`frontend` HTTP 200 em `:5173`, API 200).  
**Papel simulado:** Coordenador / Técnico autenticado.  
**Nota:** não é prototipagem pré-código; é walkthrough sobre UI de alta fidelidade já implantada no lab.

## Roteiro e achados

| Passo | Ação do usuário | Expectativa | Observação / fricção | Severidade |
|---:|---|---|---|---|
| 1 | Abrir app lab (`/`) e autenticar (login + MFA se first-login) | Entrar no shell autenticado | MFA first-login existe no produto; lab precisa admin seedado | Baixa se admin ok |
| 2 | Ir ao **Intake Wizard** (cadastro de amostra — rota v2 intake; “Nova Amostra” removida do menu legado) | Encontrar wizard sem caçar rotas órfãs | Depende de descoberta na navegação v2; risco de aprendizado se nav não destacar Intake | Média |
| 3 | Buscar doença rara / Orpha e ver vínculos OMIM/CID | Resolver códigos active (F2) | Wizard Orpha depende de releases active; F2 populou ORPHA/HPO/etc. | Baixa se refs active |
| 4 | Criar/selecionar participante + consentimento | Bloqueio sem consentimento ativo | Consistente com RF010/RF029; BLPP já provou consent ACTIVE no backend | — |
| 5 | Registrar espécime (tipo/origem/protocolo MIABIS) + posição de storage | Sucesso só com box/sensor operacional | **Mitigado 2026-11-02:** Mongo `rs0`+keyFile; seed service N=10k OK | Baixa (ops resolvido) |
| 6 | Abrir `/import/lgpd` e entender CSV pacientes/amostras | Importar lote com headers do projeto | UI capturada; quarentena vazia (sem rejeições) | Baixa |
| 7 | Consultar lista + liberação/RCS | Inventário + withdraw/return + governance graph | Exercício `BR-2026-10107`; capturas `fase3/ui/` | — |
| 8 | Custody / quality / reports / admin | Cobertura UI 100% | Índice em `ui/README.md` | — |

## Síntese de usabilidade

1. O fluxo canônico de amostra é o **Intake Wizard** (não há “Nova Amostra” legada).  
2. Import LGPD é a superfície natural para lotes BLPP (CSV/XLSX).  
3. Barreira Mongo RS **fechada** no lab; residual de usabilidade: detalhe de amostra dependia da janela de 50 (corrigido com fallback API); rota `withdrawal-return` era capturada por `:id` (corrigido).

## Evidência de ambiente

- Tunnel `127.0.0.1:5173` + admin autenticado (2026-11-02).  
- Figuras: `docs/evidencias/fase3/ui/`; fluxo RCS/liberação: `ui-rcs-liberacao.md`.
