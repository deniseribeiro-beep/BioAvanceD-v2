# MANUAL_VERIFY — v2.1 labels & inventory lookup (G5, G6, P5.5)

Homolog base URL: `http://localhost:5173` (ou GCP homolog `:8080`).

## G5 — Busca única no inventário

| Step | Action | Expected |
|------|--------|----------|
| G5-1 | `/samples` → aba **Inventário** | Um campo de busca na lista |
| G5-2 | Pesquisar por barcode/ID; abrir **Armazenagem Física** | Aba 2 **sem** campo de busca duplicado; locator mostra chave da seleção/busca única |
| G5-3 | Sem seleção na aba 2 | Empty state orienta voltar ao inventário |

## P5.5 — Drawer de consulta rápida

| Step | Action | Expected |
|------|--------|----------|
| P55-1 | Inventário → **Consulta rápida** | Drawer lateral; mesmo valor do campo de busca |
| P55-2 | Pesquisar no drawer | Mesmos resultados que a lista (mesmo motor) |
| P55-3 | **Detalhe** / **Armazenagem** / **Etiqueta** | Navega para `/samples/:id`, aba armazenagem ou `/samples/:id/label` |

## G6 — Etiquetas Code128 + DataMatrix

| Step | Action | Expected |
|------|--------|----------|
| G6-1 | Inventário → selecionar amostras → imprimir etiquetas (lote) | Code128 **e** DataMatrix por amostra com barcode |
| G6-2 | Amostra sem barcode no lote | Mensagem de orientação (sem símbolos) |
| G6-3 | `/samples/:id/label` com barcode | Code128, DataMatrix, QR; botão **Print job (ZPL)** |
| G6-4 | `/samples/:id/label` sem barcode | Erro + texto de como gerar código |

## Hub — Retirada / Devolução

| Step | Action | Expected |
|------|--------|----------|
| WR-1 | `/samples` → **Retirada / Devolução** | Abre `/samples/withdrawal-return` |

## Scan → inventário

| Step | Action | Expected |
|------|--------|----------|
| SC-1 | Imprimir etiqueta (G6-1); escanear Code128 ou DataMatrix na busca do inventário | Amostra encontrada na lista ou no drawer |