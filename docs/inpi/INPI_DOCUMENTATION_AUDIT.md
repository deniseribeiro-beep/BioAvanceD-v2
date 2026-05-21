# Auditoria da Documentacao INPI - BioAvanceD v1.1.0

## Escopo

Auditoria documental para o novo congelamento do software BioAvanceD v1.1.0, preservando o motor metodologico RCS-GOV 1.0. Nenhum ZIP, hash ou tag foi gerado nesta etapa.

| Arquivo | Acao | Motivo |
|---|---|---|
| INPI_MEMORIAL_DESCRITIVO.md | atualizar/manter | Documento principal para NIT/INPI; consolidado com versao BioAvanceD v1.1.0, motor RCS-GOV 1.0, arquitetura, seguranca, TCLE, FHIR, quarentena, Merkle, LGPD e ISO 20387. |
| RCS_GOV_1_0_SPEC.md | atualizar/manter | Documento metodologico ouro; preservado como RCS-GOV 1.0 e acrescido de nota de uso pela versao de software v1.1.0. |
| ARQUITETURA_TECNICA.md | atualizar/manter | Documento tecnico de arquitetura; consolidado com frontend, backend, bancos, Docker Compose, Resend, VM e modulos principais. |
| DECLARACAO_SANITIZACAO.md | atualizar/manter | Documento necessario para declarar exclusoes do pacote e ausencia de segredos/dados reais. |
| MANIFESTO_HASH.md | atualizar/manter | Documento necessario para registrar ZIP pretendido, tag futura, SHA-512 pendente e comando de hash. |
| INVENTARIO_ARQUIVOS_REGISTRO.md | atualizar/manter | Inventario resumido do pacote, pastas incluidas/excluidas, modulos e ausencia de segredos. |
| RESUMO_REGISTRO_INPI_V1_1_0.md | criar/manter | Resumo curto para formulario/NIT com titulo, versao, linguagem, tipo, campo, hash pendente e descricao. |
| PLANO_CONGELAMENTO_INPI_V1_1_0.md | criar/manter | Checklist operacional de congelamento, tag, ZIP, hash e envio ao NIT. |
| CHANGELOG_INPI_V1_1_0.md | criar/manter | Mudancas desde o pacote anterior e contexto de invalidacao antes da submissao efetiva. |
| INPI_SUBMISSION_PACKAGE_README.md | criar/manter | Lista exata dos documentos e artefatos que devem compor o envio ao NIT/INPI. |
| GUIA_EXECUCAO_DOCKER.md | mover para archive | Documento operacional util, mas nao necessario no pacote final de envio; conteudo essencial consolidado em arquitetura/inventario. |
| INPI_REGISTRATION_SUMMARY_RCS_GOV_1_1.md | mover para archive | Duplicava o resumo oficial e tinha nomenclatura alternativa que podia confundir a versao do software com a versao do motor metodologico. |
| MEMORIAL_DESCRITIVO_BIOAVANCED_RCS_GOV_1_1.md | mover para archive | Duplicava o memorial oficial e tinha nomenclatura alternativa que podia confundir a versao do software com a versao do motor metodologico. |
| TECHNICAL_MANIFEST_RCS_GOV_1_1.md | mover para archive | Duplicava arquitetura/inventario e tinha nomenclatura alternativa nao necessaria para envio. |

## Resultado

Documentacao final mantida enxuta e coerente em `docs/inpi`. Duplicatas e documentos auxiliares foram preservados em `docs/inpi/archive`, sem exclusao direta.
