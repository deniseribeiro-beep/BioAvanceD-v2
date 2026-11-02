# Protótipo BF — Intake Wizard

```mermaid
flowchart TD
  login[Login]
  dash[Dashboard]
  intake["/next/intake"]
  orpha[Busca_Orpha_OMIM_CID]
  partic[Participante_Consent]
  amostra[Amostra_MIABIS_Storage]
  rcs[RCS_se_SPREC]
  fim[Confirmacao]
  login --> dash --> intake --> orpha --> partic --> amostra --> rcs --> fim
```

**Telas conceituais (baixa fidelidade):**

1. Shell autenticado com nav destacando “Novo atendimento / Intake”.  
2. Painel de terminologia (Orpha → vínculos).  
3. Formulário participante + vínculo de TCLE.  
4. Formulário amostra (tipo/origem/protocolo) + posição.  
5. Resumo RCS (escopo: pré-analítico, não validade clínica).
