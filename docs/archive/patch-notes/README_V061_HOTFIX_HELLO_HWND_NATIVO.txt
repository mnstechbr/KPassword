KPassword v0.6.1 - hotfix Windows Hello com foco nativo HWND

Corrige tentativa anterior:
- O prompt do Windows Hello continuava piscando na barra de tarefas.

Ajuste novo:
- Agora o backend Rust localiza a janela real do KPassword pelo HWND do Windows.
- Antes de chamar o Windows Hello, ele usa APIs nativas do Windows:
  - ShowWindow
  - SetForegroundWindow
  - BringWindowToTop
  - SetActiveWindow
  - SetFocus
  - SetWindowPos temporariamente TOPMOST
  - AttachThreadInput
  - AllowSetForegroundWindow
- Isso é mais forte do que tentar foco apenas pelo frontend/Tauri.

Não altera:
- App.tsx
- App.css
- Dashboard
- Cofre
- Criptografia
- TOTP
- Multi-cofres
- Backup
- Updater
- Idiomas

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v061-hotfix-hello-hwnd-nativo*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

npm run build
npm run tauri dev

Teste:
1. Bloqueie o cofre
2. Clique em Desbloquear com Windows Hello
3. Verifique se o prompt aparece na frente
4. Teste ativar/desativar Windows Hello em Segurança & backup

Se ainda piscar na barra de tarefas:
A API UserConsentVerifier do Windows está ignorando o foco do app. O próximo caminho seria abandonar essa chamada e usar uma abordagem diferente de autenticação local, ou manter Windows Hello funcional mesmo exigindo clique no prompt.
