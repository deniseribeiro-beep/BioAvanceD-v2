# Manifesto de Hash - BioAvanceD v1.1.0

## Artefato pretendido

- Nome do ZIP: `BioAvanceD_v1.1.0_INPI.zip`
- Tag futura: `v1.1.0-inpi-rcs-gov`
- Branch futura de congelamento: `release/inpi-v1.1.0-rcs-gov`
- Algoritmo: SHA-512
- Hash: PENDENTE - gerar apos ZIP oficial por `git archive`

## Comando PowerShell

```powershell
Get-FileHash .\BioAvanceD_v1.1.0_INPI.zip -Algorithm SHA512
```

## Regras

- A geracao do ZIP oficial permanece pendente para etapa posterior.
- O hash SHA-512 deve ser calculado apenas apos o ZIP oficial.
- Nao editar o ZIP depois do hash.
- Nao alterar a tag depois do hash.
- Se qualquer arquivo mudar, gerar novo ZIP e novo hash em novo ciclo controlado.
- Nao incluir `.env`, `.env.docker` real, segredos, tokens, chaves, logs, uploads, backups, dumps ou dependencias geradas.
