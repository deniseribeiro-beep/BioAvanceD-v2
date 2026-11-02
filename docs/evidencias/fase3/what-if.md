# Análise what-if — Fase 3 lab

| # | Cenário | O que ocorreu / simulação | Resultado | Implicação |
|---|---|---|---|---|
| W1 | Mongo sem replica set | `createSample` falhou: “Transação Mongo indisponível” | BLPP usou `lab-direct`; depois lab promoveu a `rs0`+keyFile (`compose.lab-rs.yml`) | Gap **mitigado** 2026-11-02; service-path RF006 exercitável |
| W2 | Interrupção mid-run | `--stop-after-chunk 0` (N=4) | 50% persistido; `--resume` completou sem duplicar chunk 0 | Recuperação sem zerar |
| W3 | Re-seed mesmo seed | Corpus N=1000 seed 4242 após PoC 100 | 100 `sourceRecordId` reutilizados; +900 novos | Idempotência operacional |
| W4 | Conflict upsert consent template | `$set`+`$setOnInsert` no mesmo path `active` | Corrigido no BLPP; rerun OK | Evidência de falha→fix no artefato |
| W5 | Pico N=1000 na VM com F2 carregada | Stack healthy; 41 s | Sem OOM observado | Capacidade OK para N tese |
| W6 | N=10 000 | lab-direct **505 s**; service seed 9002 **1882 s** (`ok: true`) | Ambos executados | Teto de escala fechado nos dois modos |
| W7 | SSH/sessão agente cai | Seed sob tmux + `progress.json` | Retomável com `--resume` | Política anti-abandono |
| W8 | Falha E2E/CI | Separado do corpus | Não exige re-seed 1000/10k | Trilhas distintas |

## Achado principal

**W1** foi o what-if mais material: o lab em compose.dev **não** exercitava RF006 até haver replica set. Mitigações aplicadas: (a) `lab-direct` para população/LGPD/Identity; (b) promoção a `replSet rs0` + re-seed N=10 000 `--apply-mode service` (runId `blpp-9002-10000-1793583172977`).
