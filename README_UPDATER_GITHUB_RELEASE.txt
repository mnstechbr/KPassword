KPassword - updater oficial Tauri + GitHub Releases

IMPORTANTE:
- A versão 0.2.0 que você já instalou provavelmente NÃO tem o updater oficial compilado.
- Então ela não consegue se atualizar sozinha para esta primeira versão com updater.
- Você precisa instalar manualmente a primeira versão com updater, sugerida aqui como v0.3.0.
- A partir dela, as próximas versões, como v0.3.1, podem ser atualizadas pelo botão "Verificar atualizações".

ETAPA 1 - aplicar updater no código

Troque SEU_USUARIO_GITHUB e SEU_REPO_GITHUB pelos nomes reais.

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-updater-github-release-pack*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }
Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

powershell -ExecutionPolicy Bypass -File ".\tools\setup-real-updater.ps1" -GitHubOwner "SEU_USUARIO_GITHUB" -GitHubRepo "SEU_REPO_GITHUB" -Version "0.3.0"

ETAPA 2 - gerar release local

powershell -ExecutionPolicy Bypass -File ".\tools\build-updater-release.ps1" -GitHubOwner "SEU_USUARIO_GITHUB" -GitHubRepo "SEU_REPO_GITHUB" -Version "0.3.0"

ETAPA 3 - subir para GitHub

Crie uma release com tag:
v0.3.0

Anexe os arquivos gerados em:
C:\Projetos\KPassword\dist-release\v0.3.0

Arquivos:
- KPassword-Setup-v0.3.0.exe
- KPassword-Setup-v0.3.0.exe.sig
- latest.json

ETAPA 4 - testar atualização automática

Para testar de verdade:
1. Instale manualmente o KPassword-Setup-v0.3.0.exe.
2. Faça alguma melhoria pequena.
3. Gere v0.3.1:
   powershell -ExecutionPolicy Bypass -File ".\tools\build-updater-release.ps1" -GitHubOwner "SEU_USUARIO_GITHUB" -GitHubRepo "SEU_REPO_GITHUB" -Version "0.3.1" -Notes "Teste de atualização automática."
4. Crie release tag v0.3.1 no GitHub.
5. Anexe os arquivos de dist-release\v0.3.1.
6. Abra o app instalado v0.3.0 e clique em "Verificar atualizações".

NÃO ENVIE PARA O GITHUB:
- C:\Users\<voce>\.tauri\kpassword.key

Guarde essa chave privada. Ela é necessária para assinar todas as próximas atualizações.
