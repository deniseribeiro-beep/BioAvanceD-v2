# Script para encerrar processos usando a porta 3000
# Uso: powershell -ExecutionPolicy Bypass -File kill-port-3000.ps1

Write-Host "🔍 Verificando processos na porta 3000..." -ForegroundColor Yellow

$connections = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue

if ($connections) {
    Write-Host "⚠️ Encontrados processos usando a porta 3000:" -ForegroundColor Red
    foreach ($conn in $connections) {
        $process = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
        Write-Host "  PID: $($conn.OwningProcess) - Processo: $($process.ProcessName)" -ForegroundColor Yellow
        
        try {
            Stop-Process -Id $conn.OwningProcess -Force
            Write-Host "  ✅ Processo $($conn.OwningProcess) encerrado" -ForegroundColor Green
        } catch {
            Write-Host "  ❌ Erro ao encerrar processo $($conn.OwningProcess): $_" -ForegroundColor Red
        }
    }
    Start-Sleep -Seconds 2
} else {
    Write-Host "✅ Nenhum processo usando a porta 3000" -ForegroundColor Green
}

# Verifica novamente
$remaining = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
if ($remaining) {
    Write-Host "⚠️ Ainda há processos na porta 3000. Tentando encerrar todos os processos Node.js..." -ForegroundColor Yellow
    Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
} else {
    Write-Host "✅ Porta 3000 está livre!" -ForegroundColor Green
}

