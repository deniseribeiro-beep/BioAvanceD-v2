# Plano de Congelamento INPI - BioAvanceD v1.1.0

## Identificacao

- Software: BioAvanceD v1.1.0
- Motor metodologico: RCS-GOV 1.0
- Branch atual de trabalho/deploy: `deploy/google-vm-post-inpi`
- Branch futura de congelamento: `release/inpi-v1.1.0-rcs-gov`
- Tag futura: `v1.1.0-inpi-rcs-gov`
- Algoritmo hash pretendido: SHA-512

## Checklist operacional

1. Revisar docs.
2. Commitar documentacao.
3. Criar branch `release/inpi-v1.1.0-rcs-gov`.
4. Criar tag `v1.1.0-inpi-rcs-gov`.
5. Gerar ZIP por `git archive`.
6. Gerar SHA-512.
7. Guardar evidencias de commit, branch, tag, comando de ZIP e hash.
8. Enviar ao NIT.
9. Nao alterar tag/ZIP/hash apos geracao.

## Restricoes

- Nao criar hash antes do ZIP oficial.
- Nao usar hash ficticio.
- Nao alterar a tag antiga `v1.0.0-inpi-rcs-gov`.
- Nao incluir segredos, `.env` real, `.env.docker` real, logs, uploads, backups ou dumps.
