KPassword v0.3.3 - Lixeira, validade da senha, dashboard e gerador avançado

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v033-seguranca-lixeira-validade-gerador*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

npm run build
npm run tauri dev

O que foi adicionado:
- Lixeira de credenciais
- Restaurar credencial excluída
- Excluir definitivamente
- Limpar lixeira
- Campo de validade da senha por credencial
- Aviso de senha vencida/próxima de vencer ao desbloquear
- Badges de validade na lista e nos detalhes
- Dashboard de segurança mais completo
- Gerador de senha avançado:
  - aleatória forte
  - memorável
  - PIN numérico
  - tamanho configurável
  - opções de minúsculas, maiúsculas, números, símbolos e evitar caracteres ambíguos
- Configurações de bloqueio e clipboard:
  - minutos de inatividade
  - limpar Ctrl+V após X segundos
  - intervalo de backup
  - bloquear por inatividade
  - bloquear ao minimizar
  - X manda para bandeja
  - notificação ao ir para bandeja
  - som ao ir para bandeja
- Versão ajustada para 0.3.3

Depois de validar visualmente:

cd C:\Projetos\KPassword
git add .
git commit -m "Adiciona lixeira validade de senha dashboard e gerador avancado"
git push

powershell -ExecutionPolicy Bypass -File ".\tools\fix-updater-v030-build.ps1" -Version "0.3.3"

Depois crie a release v0.3.3 no GitHub e anexe:
- KPassword-Setup-v0.3.3.exe
- KPassword-Setup-v0.3.3.exe.sig
- latest.json
