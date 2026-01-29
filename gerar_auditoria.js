const fs = require('fs');
const path = require('path');

const ARQUIVO_SAIDA = 'AUDITORIA_CODIGO.txt';
const EXTENSOES_PERMITIDAS = ['.js', '.jsx', '.ts', '.tsx', '.css', '.html', '.json', '.md'];
const PASTAS_IGNORADAS = ['node_modules', '.git', '.vscode', 'dist', 'build', 'coverage', 'logs', 'uploads'];
const ARQUIVOS_IGNORADOS = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', ARQUIVO_SAIDA, 'gerar_auditoria.js'];

function percorrerDiretorio(dir) {
    let conteudoTotal = "";

    const arquivos = fs.readdirSync(dir);

    for (const arquivo of arquivos) {
        const caminhoCompleto = path.join(dir, arquivo);
        const stat = fs.statSync(caminhoCompleto);

        if (stat.isDirectory()) {
            if (!PASTAS_IGNORADAS.includes(arquivo)) {
                conteudoTotal += percorrerDiretorio(caminhoCompleto);
            }
        } else {
            const ext = path.extname(arquivo).toLowerCase();
            if (EXTENSOES_PERMITIDAS.includes(ext) && !ARQUIVOS_IGNORADOS.includes(arquivo)) {
                try {
                    const conteudo = fs.readFileSync(caminhoCompleto, 'utf-8');
                    conteudoTotal += `\n\n${'='.repeat(80)}\n`;
                    conteudoTotal += `ARQUIVO: ${caminhoCompleto}\n`;
                    conteudoTotal += `${'='.repeat(80)}\n`;
                    conteudoTotal += conteudo;
                    console.log(`Lendo: ${arquivo}`);
                } catch (err) {
                    console.error(`Erro ao ler ${arquivo}: ${err.message}`);
                }
            }
        }
    }
    return conteudoTotal;
}

try {
    console.log("Iniciando auditoria...");
    const header = `=== RELATÓRIO DE AUDITORIA DE CÓDIGO (Gerado via Node.js) ===\n\n`;
    const dados = percorrerDiretorio(__dirname);
    fs.writeFileSync(ARQUIVO_SAIDA, header + dados);
    console.log(`\n✅ Sucesso! Arquivo gerado: ${ARQUIVO_SAIDA}`);
} catch (error) {
    console.error("Erro fatal:", error);
}