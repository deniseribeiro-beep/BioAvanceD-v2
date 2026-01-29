import os

# ================= CONFIGURAÇÕES =================
# Diretório raiz para varredura ('.' significa a pasta atual)
DIRETORIO_RAIZ = '.'

# Nome do arquivo final gerado
ARQUIVO_SAIDA = 'AUDITORIA_CODIGO.txt'

# Extensões de arquivos que queremos ler (Adicionei .json para configs, mas removi lockfiles abaixo)
EXTENSOES_PERMITIDAS = {'.js', '.jsx', '.ts', '.tsx', '.css', '.html', '.json', '.md'}

# Pastas que o script DEVE PULAR (para não travar ou criar arquivos gigantes)
PASTAS_IGNORADAS = {
    'node_modules', 
    '.git', 
    '.vscode', 
    '.idea', 
    'dist', 
    'build', 
    'coverage', 
    '__pycache__',
    'logs',      # Logs de execução não são código
    'uploads'    # Arquivos de upload não são código
}

# Arquivos específicos para ignorar (mesmo que tenham a extensão permitida)
ARQUIVOS_IGNORADOS = {
    'package-lock.json', 
    'yarn.lock', 
    'pnpm-lock.yaml',
    'AUDITORIA_CODIGO.txt', # Não ler o próprio arquivo que está sendo gerado
    'gerar_auditoria.py'    # Não precisa ler este script
}
# =================================================

def juntar_codigo():
    print(f"Iniciando varredura em: {os.path.abspath(DIRETORIO_RAIZ)}")
    print("Gerando relatório... aguarde.")
    
    arquivos_processados = 0
    
    try:
        with open(ARQUIVO_SAIDA, 'w', encoding='utf-8') as outfile:
            # Cabeçalho do Relatório
            outfile.write(f"================================================================\n")
            outfile.write(f"RELATÓRIO DE AUDITORIA DE CÓDIGO FONTE - BIOAVANCED\n")
            outfile.write(f"Gerado para análise de Patente e Dissertação de Mestrado\n")
            outfile.write(f"================================================================\n\n")

            # Caminha por todas as pastas e subpastas
            for root, dirs, files in os.walk(DIRETORIO_RAIZ):
                # Modifica a lista 'dirs' in-place para impedir que o walk entre nas pastas ignoradas
                dirs[:] = [d for d in dirs if d not in PASTAS_IGNORADAS]
                
                for file in files:
                    ext = os.path.splitext(file)[1].lower()
                    
                    # Verifica se é um arquivo de código válido e não está na lista negra
                    if ext in EXTENSOES_PERMITIDAS and file not in ARQUIVOS_IGNORADOS:
                        caminho_completo = os.path.join(root, file)
                        
                        # Escreve o separador e o nome do arquivo
                        outfile.write(f"\n\n{'='*80}\n")
                        outfile.write(f"ARQUIVO: {caminho_completo}\n")
                        outfile.write(f"{'='*80}\n")
                        
                        try:
                            with open(caminho_completo, 'r', encoding='utf-8', errors='ignore') as infile:
                                conteudo = infile.read()
                                outfile.write(conteudo)
                                arquivos_processados += 1
                        except Exception as e:
                            outfile.write(f"\n[ERRO AO LER O ARQUIVO: {e}]\n")

        print(f"\n✅ SUCESSO! Relatório gerado em: {ARQUIVO_SAIDA}")
        print(f"📊 Total de arquivos processados: {arquivos_processados}")
        print("Agora faça o upload deste arquivo no chat do Gemini.")

    except Exception as e:
        print(f"\n❌ Erro crítico ao criar o arquivo de auditoria: {e}")

if __name__ == '__main__':
    juntar_codigo()