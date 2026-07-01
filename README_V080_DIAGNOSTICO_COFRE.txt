KPassword v0.8.0 - Diagnóstico do Cofre

Adiciona:
- Diagnóstico local do cofre na tela Analítico.
- Pontuação de saúde de 0 a 100.
- Alertas de senhas fracas, reutilizadas, antigas, vencidas e próximas do vencimento.
- Alerta de credenciais sem TOTP/2FA.
- Alerta de credenciais incompletas.
- Filtro no Cofre ao clicar nos cards do diagnóstico.
- Diagnóstico individual no detalhe da credencial.
- Versão ajustada para 0.8.0.

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v080-diagnostico-cofre*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

npm run build
npm run tauri dev

Depois de validar:

git status --short
git add .
git commit -m "Adiciona diagnostico do cofre"
git push
powershell -ExecutionPolicy Bypass -File ".\tools\fix-updater-v030-build.ps1" -Version "0.8.0"
explorer ".\dist-release\v0.8.0"
