# 2026-11-26: In-app Runbook + Terms/Privacy (G13)

## The question

Should `/admin/dicionario` remain the daily hub, and how do product Terms/Privacy relate to research TCLE?

## Decided

`[decision]`, coordinator, 2026-11-26:

1. Daily menu hub = **Runbook / Central de processos** (`/runbook`), curated from `docs/user-guides` + `docs/operations`.
2. **Terms of use** + **Privacy/use policy** at `/legal/terms` and `/legal/privacy` with versioned acceptance on tenant onboarding (**≠** research TCLE).
3. Acceptance record: `userId`, `tenantId`, `docType` (`terms`|`privacy`), `docVersion`, `timestamp`, `ip`, `userAgent`.
4. Admin can publish a new doc version → users must re-accept.
5. `/admin/dicionario` redirects to `/runbook` (optional Admin-only “documentação técnica” later). Excel dictionary + `/dictionary/*` APIs remain the ELM/intake engine — **not** the UI hub.
6. Visibility: all authenticated roles see Runbook index; Admin manages legal versions.

## Consequences

- Replace `DataDictionaryPage` hub behavior with Runbook + legal pages.
- Gate post-login when acceptance pending.
